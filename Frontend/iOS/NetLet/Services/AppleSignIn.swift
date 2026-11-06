import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// What Apple's sheet hands back, as the server takes it (`auth.appleSignIn`,
/// and `auth.deleteAccount`'s `apple`): the identity token, the nonce it was
/// made for — raw here, hashed in what Apple signed — and the one-time code,
/// which the server spends unlinking the Apple ID when an account is deleted.
struct AppleProof: Encodable, Sendable, Equatable {
    let idToken: String
    let nonce: String
    var code: String?
}

/// The person's name, which Apple gives the first time an Apple ID meets
/// NetLet and never again.
struct AppleName: Sendable, Equatable {
    var first: String?
    var last: String?
}

/// Sign in with Apple through the system's own sheet — the web's
/// `lib/appleSignIn.ts`.
///
/// A fresh nonce for every ask, handed to Apple as its SHA-256 and to the
/// server raw, so a token lifted from another sign-in carries a hash nothing
/// here made. Null when the person closed the sheet: that is not a failure,
/// and nothing is said.
///
/// Not a main-actor class, so a view or a view model can make one as a
/// stored property's initial value — which Swift 5 mode evaluates off the main
/// actor; what touches the sheet is.
final class AppleSignIn: NSObject, @unchecked Sendable {
    enum Failure: Error { case noToken, failed }

    private var continuation: CheckedContinuation<(AppleProof, AppleName)?, Error>?
    private var nonce = ""
    /// Kept alive while the sheet is up; the system holds it weakly.
    private var controller: ASAuthorizationController?

    @MainActor
    func ask(name: Bool = true) async throws -> (AppleProof, AppleName)? {
        nonce = Self.randomNonce()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = name ? [.fullName, .email] : []
        request.nonce = Self.sha256(nonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    @MainActor
    private func finish(_ result: Result<(AppleProof, AppleName)?, Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }

    /// 32 bytes from the system's own generator, which is cryptographically
    /// secure on Apple's platforms.
    static func randomNonce() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &generator)) }.joined()
    }

    static func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension AppleSignIn: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let token = credential?.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let code = credential?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        let given = credential?.fullName?.givenName
        let family = credential?.fullName?.familyName
        MainActor.assumeIsolated {
            guard let token else { return finish(.failure(Failure.noToken)) }
            let trimmed = { (value: String?) -> String? in
                let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return text.isEmpty ? nil : text
            }
            finish(.success((AppleProof(idToken: token, nonce: nonce, code: code), AppleName(first: trimmed(given), last: trimmed(family)))))
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let canceled = (error as? ASAuthorizationError)?.code == .canceled
        MainActor.assumeIsolated {
            finish(canceled ? .success(nil) : .failure(Failure.failed))
        }
    }
}

extension AppleSignIn: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }
}
