import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// What Google hands back, as the server takes it (`auth.googleSignIn`, and
/// `auth.deleteAccount`'s `google`): the identity token and the nonce it was
/// made for — raw here, hashed in what Google signed.
struct GoogleProof: Encodable, Sendable, Equatable {
    let idToken: String
    let nonce: String
}

/// Sign in with Google through the system's own sign-in sheet — the web's
/// `lib/googleSignIn.ts`, without Google's SDK.
///
/// `ASWebAuthenticationSession` opens Google's own page in the system's secure
/// browser (shared with Safari, so a phone already signed in to Google picks an
/// account in a press), asks for a code with PKCE for the app's iOS client id,
/// and is called back on the client id's reversed scheme, which the session
/// catches itself — nothing to register in the app. The code is traded for an
/// identity token at Google's token endpoint, which an iOS client may do with
/// no secret. A fresh nonce for every ask, handed to Google as its SHA-256 and
/// to the server raw, as Apple's is. Null when the person closed the sheet.
///
/// Not a main-actor class, so a view or a view model can make one as a stored
/// property's initial value; what touches the sheet is.
final class GoogleSignIn: NSObject, @unchecked Sendable {
    enum Failure: Error { case notAClient, didNotStart, refused }

    /// Kept alive while the sheet is up.
    private var session: ASWebAuthenticationSession?

    /// `com.googleusercontent.apps.<id>` from `<id>.apps.googleusercontent.com`:
    /// the scheme Google calls an iOS client back on.
    static func scheme(for clientId: String) -> String? {
        let suffix = ".apps.googleusercontent.com"
        guard clientId.hasSuffix(suffix), clientId.count > suffix.count else { return nil }
        return "com.googleusercontent.apps." + clientId.dropLast(suffix.count)
    }

    static func base64url(_ data: some Sequence<UInt8>) -> String {
        Data(data).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// A form body, every value percent-encoded as a form's are.
    static func form(_ fields: [(String, String)]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields
            .map { "\($0.0)=\($0.1.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&")
    }

    @MainActor
    func ask(clientId: String, language: String) async throws -> GoogleProof? {
        guard let scheme = Self.scheme(for: clientId) else { throw Failure.notAClient }
        let redirect = "\(scheme):/oauth2redirect"
        let nonce = AppleSignIn.randomNonce()
        let verifier = AppleSignIn.randomNonce() + AppleSignIn.randomNonce()
        let challenge = Self.base64url(SHA256.hash(data: Data(verifier.utf8)))
        let state = AppleSignIn.randomNonce()

        var parts = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        parts.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "nonce", value: AppleSignIn.sha256(nonce)),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "select_account"),
            URLQueryItem(name: "hl", value: language),
        ]
        guard let address = parts.url else { throw Failure.notAClient }

        let callback: URL? = try await withCheckedThrowingContinuation { continuation in
            let answered = Answered()
            let session = ASWebAuthenticationSession(url: address, callbackURLScheme: scheme) { url, error in
                guard answered.first() else { return }
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(returning: nil)
                } else if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: url)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start(), answered.first() {
                continuation.resume(throwing: Failure.didNotStart)
            }
        }
        session = nil
        guard let callback else { return nil }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if value("error") == "access_denied" { return nil }
        guard value("state") == state, let code = value("code") else { throw Failure.refused }

        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(Self.form([
            ("client_id", clientId),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect),
        ]).utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let token = (try? JSONDecoder().decode(TokenAnswer.self, from: data))?.id_token
        else { throw Failure.refused }
        return GoogleProof(idToken: token, nonce: nonce)
    }

    private struct TokenAnswer: Decodable {
        let id_token: String?
    }

    /// The sheet answers once, whichever of its two ways it ends.
    private final class Answered: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false

        func first() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if done { return false }
            done = true
            return true
        }
    }
}

extension GoogleSignIn: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }
}
