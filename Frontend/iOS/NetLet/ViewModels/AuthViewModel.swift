import Foundation
import Observation

/// Sign in, create account and reset — the web's `AuthForm`, one form in three modes.
///
/// Create account proves the address before anything exists: the details go
/// first and a six-digit code is emailed; the account is made only when the
/// code comes back with them. The password typed with the code is the one kept.
@Observable
@MainActor
final class AuthViewModel {
    enum Mode: Equatable {
        case signIn, register, reset
    }

    /// Where the form is. The code step and the "check your email" page
    /// replace the form rather than sitting under it.
    enum Step: Equatable {
        case form
        case code(email: String, password: String, name: String?, fromRegister: Bool)
        case resetSent(email: String)
    }

    var mode: Mode = .signIn {
        didSet { if mode != oldValue { modeChanged() } }
    }

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

    private let account: AccountServicing
    private var countdown: Task<Void, Never>?
    static let resendWaitSeconds = 30

    init(account: AccountServicing) {
        self.account = account
    }

    var emailProblem: String? { Validation.emailProblem(email) }

    var passwordProblem: String? {
        switch mode {
        case .reset: return nil
        case .signIn: return password.isEmpty ? "auth.passwordRequired" : nil
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
    var offersSignIn: Bool { refusal == "auth.emailTaken" }

    func prepare() async {
        guard mode == .register, captchaSiteKey == nil else { return }
        captchaSiteKey = (try? await account.signupOptions())?.captchaSiteKey
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
        guard case .code(let address, let typedPassword, let typedName, _) = step else { return nil }
        submitted = true
        refusal = nil
        guard codeProblem == nil else { return nil }
        working = true
        defer { working = false }
        do {
            return try await account.verify(email: address, password: typedPassword, code: Validation.normaliseCode(code), name: typedName)
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
        case .resetSent(let address):
            try? await account.requestPasswordReset(email: address)
        case .form:
            return
        }
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

    private func startCountdown() {
        countdown?.cancel()
        resendWait = Self.resendWaitSeconds
        countdown = Task { [weak self] in
            while let self, self.resendWait > 0 {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                self.resendWait -= 1
            }
        }
    }

    private func key(for error: APIError) -> String {
        error.messageKey(knownKey: Phrasebook.shared.has)
    }
}
