import Foundation
import Observation

/// Sign in, create account and reset — the web's `AuthForm`, one form in three modes.
///
/// Create account proves the address before anything exists: the details go
/// first and a six-digit code is emailed; the account is made only when the
/// code comes back with them. The password typed with the code is the one kept.
///
/// Signing in is by the password or by a one-time code emailed to the
/// account, the shopper's choice and remembered on the phone — the web's
/// `MethodChoice` (`auth.codeStart`, `auth.codeSignIn`).
@Observable
@MainActor
final class AuthViewModel {
    enum Mode: Equatable {
        case signIn, register, reset
    }

    /// How "Sign in" proves who is asking.
    enum SignInMethod: String, Equatable {
        case password, code
    }

    /// Where the form is. The code step and the "check your email" page
    /// replace the form rather than sitting under it.
    enum Step: Equatable {
        case form
        case code(email: String, password: String, name: String?, fromRegister: Bool)
        /// The one-time code emailed for signing in, said the same way
        /// whether or not the address has an account.
        case signInCode(email: String)
        case resetSent(email: String)
    }

    var mode: Mode = .signIn {
        didSet { if mode != oldValue { modeChanged() } }
    }

    /// The password or a one-time code, kept on the phone so the next
    /// sign-in starts on the way chosen last.
    var method: SignInMethod = .password {
        didSet {
            guard method != oldValue else { return }
            if remembersMethod { defaults.set(method.rawValue, forKey: Self.methodKey) }
            refusal = nil
            submitted = false
        }
    }

    /// Off for the screenshots' preset, so one picture does not choose the
    /// way every later picture of the form opens on.
    var remembersMethod = true

    private(set) var step: Step = .form
    var name = ""
    var email = ""
    var password = ""
    var code = ""
    /// Google's "I'm not a robot" token, good once.
    var captchaToken: String?
    private(set) var captchaSiteKey: String?
    /// Moves on each time a token is spent, which draws a fresh box.
    private(set) var captchaGeneration = 0

    /// Set once Submit is pressed: errors arrive with Submit and leave with the fix.
    private(set) var submitted = false
    private(set) var working = false
    /// What the server said, with the next step it offers.
    private(set) var refusal: String?
    /// Seconds until "Send it again" may be pressed.
    private(set) var resendWait = 0
    private(set) var resentTo: String?

    /// Sign in with Apple is offered while the server says Supabase has it on.
    private(set) var appleOffered = false
    /// Google's client id for the app, while the server offers Google.
    private(set) var googleClientId: String?
    /// "Continue with phone number", while the server can text a code.
    private(set) var phoneOffered = false
    private var appleAsked = false
    private let apple = AppleSignIn()
    private let google = GoogleSignIn()

    private let account: AccountServicing
    private let defaults: UserDefaults
    private var countdown: Task<Void, Never>?
    static let resendWaitSeconds = 30
    /// A sign-in code waits a minute between mails, Supabase's own interval
    /// for one address (`RESEND_WAIT_SECONDS`).
    static let signInCodeWaitSeconds = 60
    static let methodKey = "netlet.signInMethod"

    init(account: AccountServicing, defaults: UserDefaults = .standard) {
        self.account = account
        self.defaults = defaults
        method = defaults.string(forKey: Self.methodKey).flatMap(SignInMethod.init(rawValue:)) ?? .password
    }

    /// Signing in by an emailed code rather than the password.
    var usesCode: Bool { mode == .signIn && method == .code }

    var emailProblem: String? { Validation.emailProblem(email) }

    var passwordProblem: String? {
        switch mode {
        case .reset: return nil
        case .signIn: return usesCode || !password.isEmpty ? nil : "auth.passwordRequired"
        case .register: return Validation.newPasswordProblem(password)
        }
    }

    var captchaProblem: String? {
        mode == .register && captchaSiteKey != nil && captchaToken == nil ? "auth.captchaRequired" : nil
    }

    var codeProblem: String? {
        let digits = Validation.normaliseCode(code)
        if digits.isEmpty { return "auth.codeRequired" }
        return digits.count == 6 ? nil : "auth.codeShape"
    }

    /// A wrong password offers the reset; a taken address offers signing in with it.
    var offersReset: Bool { refusal == "auth.invalidCredentials" }
    /// A code that proved an inbox whose account signs in with a password
    /// NetLet keeps: the password is the way in.
    var offersPassword: Bool { refusal == "auth.codeUsePassword" }
    var offersSignIn: Bool {
        refusal == "auth.emailTaken" || ((refusal == "auth.appleEmailTaken" || refusal == "auth.googleEmailTaken") && mode == .register)
    }

    func prepare() async {
        if !appleAsked {
            appleAsked = true
            let ways = try? await account.signInWays()
            appleOffered = ways?.apple.app ?? false
            googleClientId = ways?.google?.ios
            phoneOffered = ways?.phone ?? false
        }
        guard mode == .register, captchaSiteKey == nil else { return }
        captchaSiteKey = (try? await account.signupOptions())?.captchaSiteKey
    }

    /// "Continue with Apple": the system's sheet, then the server — one door
    /// for signing in and for a new account, since Apple's sheet does not tell
    /// them apart. Closing the sheet says nothing.
    func signInWithApple() async -> User? {
        refusal = nil
        let answer: (AppleProof, AppleName)?
        do {
            answer = try await apple.ask()
        } catch {
            refusal = "auth.appleWindowFailed"
            return nil
        }
        guard let answer else { return nil }
        let (proof, name) = answer
        working = true
        defer { working = false }
        do {
            return try await account.appleSignIn(proof, name: name)
        } catch {
            refusal = key(for: APIError.from(error))
            return nil
        }
    }

    /// "Continue with Google": the system's sign-in sheet onto Google's page,
    /// then the server. Closing the sheet says nothing.
    func signInWithGoogle(language: String) async -> User? {
        guard let clientId = googleClientId else { return nil }
        refusal = nil
        let proof: GoogleProof?
        do {
            proof = try await google.ask(clientId: clientId, language: language)
        } catch {
            refusal = "auth.googleWindowFailed"
            return nil
        }
        guard let proof else { return nil }
        working = true
        defer { working = false }
        do {
            return try await account.googleSignIn(proof)
        } catch {
            refusal = key(for: APIError.from(error))
            return nil
        }
    }

    /// Submit. Answers the account when the shopper is now signed in.
    func submit() async -> User? {
        submitted = true
        refusal = nil
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard emailProblem == nil, passwordProblem == nil, captchaProblem == nil else { return nil }
        working = true
        defer { working = false }
        switch mode {
        case .signIn where usesCode:
            do {
                try await account.codeStart(email: address)
            } catch {
                // The answer is the same for every address; only the throttle,
                // or a phone that could not reach NetLet, is said.
                let failure = APIError.from(error)
                if failure.serverMessage == nil || failure.serverMessage == "auth.tooManyAttempts" {
                    refusal = key(for: failure)
                    return nil
                }
            }
            code = ""
            submitted = false
            resentTo = nil
            step = .signInCode(email: address.lowercased())
            startCountdown(seconds: Self.signInCodeWaitSeconds)
            return nil
        case .signIn:
            do {
                return try await account.signIn(email: address, password: password)
            } catch {
                let failure = APIError.from(error)
                if failure.serverMessage == "auth.emailNotConfirmed" {
                    // The right password and a code that never came back: a fresh code, and the step that takes it.
                    step = .code(email: address, password: password, name: nil, fromRegister: false)
                    try? await account.resendCode(email: address)
                    startCountdown()
                    return nil
                }
                refusal = key(for: failure)
                return nil
            }
        case .register:
            let typedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            defer {
                captchaToken = nil
                captchaGeneration += 1
            }
            do {
                switch try await account.register(email: address, password: password, name: typedName.isEmpty ? nil : typedName, captcha: captchaToken) {
                case .verify(let sentTo):
                    step = .code(email: sentTo, password: password, name: typedName.isEmpty ? nil : typedName, fromRegister: true)
                    startCountdown()
                    return nil
                case .signedIn(let user):
                    return user
                }
            } catch {
                refusal = key(for: APIError.from(error))
                return nil
            }
        case .reset:
            do {
                try await account.requestPasswordReset(email: address)
                step = .resetSent(email: address)
                startCountdown()
            } catch {
                // The reply must not vary by address; only the throttle is said.
                let failure = APIError.from(error)
                if failure.serverMessage == "auth.tooManyAttempts" { refusal = "auth.tooManyAttempts" } else {
                    step = .resetSent(email: address)
                    startCountdown()
                }
            }
            return nil
        }
    }

    /// The code step's Confirm.
    func confirm() async -> User? {
        submitted = true
        refusal = nil
        guard codeProblem == nil else { return nil }
        let digits = Validation.normaliseCode(code)
        working = true
        defer { working = false }
        do {
            switch step {
            case .code(let address, let typedPassword, let typedName, _):
                return try await account.verify(email: address, password: typedPassword, code: digits, name: typedName)
            case .signInCode(let address):
                return try await account.codeSignIn(email: address, code: digits)
            case .form, .resetSent:
                return nil
            }
        } catch {
            refusal = key(for: APIError.from(error))
            return nil
        }
    }

    func resend() async {
        guard resendWait == 0 else { return }
        refusal = nil
        switch step {
        case .code(let address, _, _, _):
            do {
                try await account.resendCode(email: address)
                resentTo = address
            } catch {
                refusal = key(for: APIError.from(error))
            }
        case .signInCode(let address):
            do {
                try await account.codeStart(email: address)
                resentTo = address
            } catch {
                let failure = APIError.from(error)
                if failure.serverMessage == nil || failure.serverMessage == "auth.tooManyAttempts" {
                    refusal = key(for: failure)
                    return
                }
                resentTo = address
            }
            startCountdown(seconds: Self.signInCodeWaitSeconds)
            return
        case .resetSent(let address):
            try? await account.requestPasswordReset(email: address)
        case .form:
            return
        }
        startCountdown()
    }

    /// "Use my password instead": back to the form with the password box.
    func usePassword() {
        method = .password
        backToForm()
    }

    /// The reset's code signed into a sign-up still waiting on its own code:
    /// the code step takes it from here, the server having sent one.
    func waitForSignUpCode(email address: String, password typed: String) {
        code = ""
        submitted = false
        refusal = nil
        step = .code(email: address, password: typed, name: nil, fromRegister: false)
        startCountdown()
    }

    /// "Use a different email": back to the form, with what was typed.
    func backToForm() {
        step = .form
        code = ""
        submitted = false
        refusal = nil
        resentTo = nil
    }

    private func modeChanged() {
        password = ""
        code = ""
        submitted = false
        refusal = nil
        step = .form
        captchaToken = nil
    }

    private func startCountdown(seconds: Int? = nil) {
        countdown?.cancel()
        resendWait = seconds ?? Self.resendWaitSeconds
        countdown = Task { [weak self] in
            while true {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self, self.resendWait > 0 else { return }
                self.resendWait -= 1
            }
        }
    }

    private func key(for error: APIError) -> String {
        error.messageKey(knownKey: Phrasebook.shared.has)
    }
}
