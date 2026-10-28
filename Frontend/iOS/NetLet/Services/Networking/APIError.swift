import Foundation

/// Every way a call to the server can fail, as one type a screen can draw.
///
/// The server answers a refusal with a message key from the shop's dictionary
/// (`auth.badCredentials`, `checkout.needPhone`), so the app says it in the
/// shopper's own language; anything that is not a key is described by its
/// code instead of being shown raw.
enum APIError: Error, Equatable, Sendable {
    /// The server refused: its tRPC code (`UNAUTHORIZED`, `BAD_REQUEST`…), its message and the HTTP status.
    case server(code: String, message: String, status: Int)
    case offline
    case timedOut
    case cancelled
    case transport(String)
    case decoding(String)
    case unexpected(status: Int)

    var isUnauthorized: Bool {
        if case .server(let code, _, _) = self { return code == "UNAUTHORIZED" }
        return false
    }

    var serverMessage: String? {
        if case .server(_, let message, _) = self { return message }
        return nil
    }

    /// Whether a read that failed this way is worth asking once more — the
    /// web client's rule: never a refusal (a 4xx says the same thing twice)
    /// nor an answer that did not read, which would not read the second time
    /// either; anything else, the server's own trouble or the connection's, once.
    var worthAnotherTry: Bool {
        switch self {
        case .server(_, _, let status), .unexpected(let status):
            return status >= 500
        case .offline, .timedOut, .transport:
            return true
        case .cancelled, .decoding:
            return false
        }
    }

    /// Any error, as one of these. A cancelled request is its own case, so a
    /// screen that moved on does not draw an error for a request it abandoned.
    static func from(_ error: Error) -> APIError {
        if let error = error as? APIError { return error }
        if error is CancellationError { return .cancelled }
        if let error = error as? URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                return .offline
            case .timedOut:
                return .timedOut
            case .cancelled:
                return .cancelled
            default:
                return .transport(error.localizedDescription)
            }
        }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .transport(error.localizedDescription)
    }

    /// The dictionary key for this failure, for `LanguageSettings.t`.
    func messageKey(knownKey: (String) -> Bool) -> String {
        switch self {
        case .server(let code, let message, _):
            if knownKey(message) { return message }
            switch code {
            case "UNAUTHORIZED": return "ios.error.signIn"
            case "FORBIDDEN": return "ios.error.forbidden"
            case "NOT_FOUND": return "ios.error.notFound"
            case "TOO_MANY_REQUESTS": return "ios.error.tooMany"
            case "BAD_REQUEST": return "error.invalidInput"
            default: return "error.serverProblem"
            }
        case .offline: return "ios.error.offline"
        case .timedOut: return "ios.error.timedOut"
        case .cancelled, .transport, .unexpected: return "ios.error.network"
        case .decoding: return "ios.error.update"
        }
    }
}
