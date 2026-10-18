import Foundation

/// Sends one request and hands back the bytes. The seam the tests and the demo
/// mode replace, so everything above it runs without a network.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// The real network.
///
/// The session is NetLet's httpOnly cookie, kept by the system's cookie store
/// the way a browser keeps it — the app never reads or holds a token itself.
/// Every request gives up after 25 seconds, the web client's ceiling, so a
/// stalled server shows as a failure with Try again rather than a spinner
/// that never ends.
struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    init(session: URLSession = URLSessionTransport.makeSession()) {
        self.session = session
    }

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 25
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .useProtocolCachePolicy
        return URLSession(configuration: configuration)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("Not an HTTP response") }
        return (data, http)
    }
}
