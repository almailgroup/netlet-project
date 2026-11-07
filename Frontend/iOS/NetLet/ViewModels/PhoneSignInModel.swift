import Foundation
import Observation

/// "Continue with phone number" — the web's `PhoneSignIn`: a Kuwaiti mobile,
/// a six-digit code by text, and the account exists; then, for an account
/// the code just made, an optional email, proven by a code emailed to it.
///
/// `verify` answers the account when nothing more is asked, and nil while the
/// email step follows — the session already exists on the server then, so the
/// email step's procedures are a signed-in shopper's; the view hands the
/// account to `AppModel.signedIn` only once that step is added or skipped,
/// or the Profile tab would swap the step away for the account page.
@Observable
@MainActor
final class PhoneSignInModel {
    enum Step: Equatable {
        case number
        case code(phone: String)
        case email
        case emailCode(email: String)
    }

    private(set) var step: Step = .number
    var typed = ""
    var code = ""
    var email = ""
    var emailCode = ""
    private(set) var submitted = false
    private(set) var working = false
    private(set) var refusal: String?
    private(set) var resendWait = 0
    /// The account the code signed into, held while the email step is up.
    private(set) var signedIn: User?

    private let account: AccountServicing
    private var countdown: Task<Void, Never>?
    static let resendWaitSeconds = 30

    /// `startAt: .email` is "Your profile"'s card, for an account already
    /// signed in that skipped the step.
    init(account: AccountServicing, startAt: Step = .number) {
        self.account = account
        self.step = startAt
    }

    var numberProblem: String? { PhoneNumber.signInProblem(typed) }
    var emailProblem: String? { Validation.emailProblem(email) }

    func sendCode() async {
        submitted = true
        guard numberProblem == nil, let phone = PhoneNumber.kuwaitMobile(typed) else { return }
        working = true
        defer { working = false }
        do {
            try await account.phoneStart(phone)
            refusal = nil
            code = ""
            submitted = false
            step = .code(phone: phone)
            startCountdown()
        } catch {
            refusal = key(for: APIError.from(error))
        }
    }

    func resend() async {
        switch step {
        case .code(let phone):
            do { try await account.phoneStart(phone); refusal = nil; startCountdown() } catch { refusal = key(for: APIError.from(error)) }
        case .emailCode(let address):
            do { try await account.addEmailStart(address); refusal = nil; startCountdown() } catch { refusal = key(for: APIError.from(error)) }
        default:
            break
        }
    }

    /// The account when signing in is done; nil while the email step follows
    /// or the code was refused.
    func verify() async -> User? {
        guard case .code(let phone) = step else { return nil }
        let digits = Validation.normaliseCode(code)
        guard digits.count == 6 else { submitted = true; return nil }
        working = true
        defer { working = false }
        do {
            let answer = try await account.phoneVerify(phone: phone, code: digits)
            refusal = nil
            if answer.needsEmail {
                signedIn = answer.user
                submitted = false
                step = .email
                return nil
            }
            return answer.user
        } catch {
            refusal = key(for: APIError.from(error))
            return nil
        }
    }

    func sendEmailCode() async {
        submitted = true
        guard emailProblem == nil else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        working = true
        defer { working = false }
        do {
            try await account.addEmailStart(address)
            refusal = nil
            emailCode = ""
            submitted = false
            step = .emailCode(email: address)
            startCountdown()
        } catch {
            refusal = key(for: APIError.from(error))
        }
    }

    /// The account with its new address, or nil while the code is refused.
    func verifyEmail() async -> User? {
        guard case .emailCode(let address) = step else { return nil }
        let digits = Validation.normaliseCode(emailCode)
        guard digits.count == 6 else { submitted = true; return nil }
        working = true
        defer { working = false }
        do {
            let user = try await account.addEmailVerify(email: address, code: digits)
            refusal = nil
            return user
        } catch {
            refusal = key(for: APIError.from(error))
            return nil
        }
    }

    func differentNumber() {
        step = .number
        submitted = false
        refusal = nil
    }

    func differentEmail() {
        step = .email
        submitted = false
        refusal = nil
    }

    private func startCountdown() {
        countdown?.cancel()
        resendWait = Self.resendWaitSeconds
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
