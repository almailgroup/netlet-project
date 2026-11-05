import Foundation
import Observation

/// A new password from the six-digit code in the reset mail — the web's
/// `ResetByCode`, on the owner's word ("password recovery using a
/// verification code sent to the registered email"). Sign-in's reset ends
/// here, and so does "Your profile"'s "Forgot your current password?": the
/// code and the new password on one screen, so nobody has to leave for the
/// mail's link and come back.
///
/// The new password is held to the floor every new password is; saving signs
/// in (`auth.resetWithCode`), and a sign-up whose code never came back is sent
/// to its own code step from here too.
@Observable
@MainActor
final class ResetByCodeModel {
    enum Outcome: Equatable {
        case signedIn(User)
        /// A sign-up still waiting on its code: that step takes it from here.
        case verify(email: String, password: String)
    }

    let email: String
    var code = ""
    var password = ""
    /// Set once Save is pressed: errors arrive with Save and leave with the fix.
    private(set) var tried = false
    private(set) var working = false
    /// What the server said: a wrong code, the same password, one too weak.
    private(set) var refusal: String?
    private let account: AccountServicing

    init(email: String, account: AccountServicing) {
        self.email = email
        self.account = account
    }

    var codeProblem: String? {
        let digits = Validation.normaliseCode(code)
        if digits.isEmpty { return "auth.codeRequired" }
        return digits.count == 6 ? nil : "auth.codeShape"
    }

    var passwordProblem: String? { Validation.newPasswordProblem(password) }

    /// Whether the refusal is about the code, so the code box takes focus.
    var refusalIsCode: Bool { refusal == "auth.codeWrong" || refusal == "auth.codeShape" }

    func codeChanged() { if refusalIsCode { refusal = nil } }
    func passwordChanged() { if refusal != nil && !refusalIsCode { refusal = nil } }

    func finish() async -> Outcome? {
        tried = true
        refusal = nil
        guard codeProblem == nil, passwordProblem == nil else { return nil }
        working = true
        defer { working = false }
        do {
            switch try await account.resetWithCode(email: email, code: Validation.normaliseCode(code), password: password) {
            case .signedIn(let user): return .signedIn(user)
            case .verify(let address): return .verify(email: address, password: password)
            }
        } catch {
            refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            return nil
        }
    }
}
