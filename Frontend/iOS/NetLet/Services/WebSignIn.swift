import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// What Google or Microsoft hands back, as the server takes it
/// (`auth.googleSignIn`, `auth.microsoftSignIn`, and `auth.deleteAccount`'s
/// `google` and `microsoft`): the identity token and the nonce it was made
/// for — raw here, hashed in what the provider signed.
struct IdTokenProof: Encodable, Sendable, Equatable {
    let idToken: String
    let nonce: String
}

/// Sign in with Google or Microsoft through the system's own sign-in sheet —
/// the web's `lib/popupSignIn.ts`, without either provider's SDK.
///
/// `ASWebAuthenticationSession` opens the provider's own page in the system's
/// secure browser (shared with Safari, so a phone already signed in picks an
/// account in a press), asks for a code with PKCE for the app's client id, and
/// is called back on a scheme the session catches itself — nothing to register
/// in the app: Google's is the client id reversed, Microsoft's the
/// `msauth.<bundle id>` its iOS platform gives. The code is traded for an
/// identity token at the provider's token endpoint, which a native client may
/// do with no secret. A fresh nonce for every ask, handed to the provider as
/// its SHA-256 and to the server raw, as Apple's is. Null when the person
/// closed the sheet.
///
/// Not a main-actor class, so a view or a view model can make one as a stored
/// property's initial value; what touches the sheet is.
final class WebSignIn: NSObject, @unchecked Sendable {
    enum Provider { case google, microsoft }
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

    /// `msauth.<bundle id>`: the scheme Microsoft's iOS platform calls back on,
    /// at `msauth.<bundle id>://auth`.
    static func microsoftScheme(bundle: String) -> String { "msauth." + bundle }

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

    /// Where each provider's pages are, and what it is called back on.
    private struct Endpoints {
        let authorize: String
        let token: String
        let scheme: String
        let redirect: String
        let extra: [URLQueryItem]
        /// Microsoft wants the scopes again when the code is traded.
        let tokenScope: Bool
    }

    private static func endpoints(_ provider: Provider, clientId: String, language: String) -> Endpoints? {
        switch provider {
        case .google:
            guard let scheme = scheme(for: clientId) else { return nil }
            return Endpoints(
                authorize: "https://accounts.google.com/o/oauth2/v2/auth",
                token: "https://oauth2.googleapis.com/token",
                scheme: scheme,
                redirect: "\(scheme):/oauth2redirect",
                extra: [URLQueryItem(name: "hl", value: language)],
                tokenScope: false
            )
        case .microsoft:
            // The `common` endpoint: personal accounts (Outlook, Hotmail) and
            // work or school ones alike.
            let scheme = microsoftScheme(bundle: Bundle.main.bundleIdentifier ?? "com.netlet.marketplace")
            return Endpoints(
                authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                scheme: scheme,
                redirect: "\(scheme)://auth",
                extra: [
                    URLQueryItem(name: "response_mode", value: "query"),
                    URLQueryItem(name: "ui_locales", value: language),
                ],
                tokenScope: true
            )
        }
    }

    @MainActor
    func ask(_ provider: Provider, clientId: String, language: String) async throws -> IdTokenProof? {
        guard let endpoints = Self.endpoints(provider, clientId: clientId, language: language) else { throw Failure.notAClient }
        let scope = "openid email profile"
        let nonce = AppleSignIn.randomNonce()
        let verifier = AppleSignIn.randomNonce() + AppleSignIn.randomNonce()
        let challenge = Self.base64url(SHA256.hash(data: Data(verifier.utf8)))
        let state = AppleSignIn.randomNonce()

        var parts = URLComponents(string: endpoints.authorize)!
        parts.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: endpoints.redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "nonce", value: AppleSignIn.sha256(nonce)),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ] + endpoints.extra
        guard let address = parts.url else { throw Failure.notAClient }

        let callback: URL? = try await withCheckedThrowingContinuation { continuation in
            let answered = Answered()
            let session = ASWebAuthenticationSession(url: address, callbackURLScheme: endpoints.scheme) { url, error in
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

        var request = URLRequest(url: URL(string: endpoints.token)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var fields = [
            ("client_id", clientId),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", endpoints.redirect),
        ]
        if endpoints.tokenScope { fields.append(("scope", scope)) }
        request.httpBody = Data(Self.form(fields).utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let token = (try? JSONDecoder().decode(TokenAnswer.self, from: data))?.id_token
        else { throw Failure.refused }
        return IdTokenProof(idToken: token, nonce: nonce)
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

extension WebSignIn: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }
}
