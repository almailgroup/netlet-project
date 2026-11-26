import Foundation

/// Answers every call from responses recorded off a real NetLet server, bundled
/// as `demo.<procedure>.json` — the iOS twin of the web's demo build.
///
/// It is what the UI tests and the screenshots run against, so they show the
/// app's real screens with nothing on the network, and it is switched on with
/// the launch argument `-NetLetDemo YES`. A procedure with no recording answers
/// the server's own "not found", so a screen draws its failure state rather
/// than inventing data.
///
/// A `variant` picks `demo.<procedure>.<variant>.json` where one exists —
/// `shopper` is the same shop with somebody signed in.
struct DemoTransport: HTTPTransport {
    let bundle: Bundle
    let variant: String?

    init(bundle: Bundle = .main, variant: String? = nil) {
        self.bundle = bundle
        self.variant = variant
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url ?? URL(string: "https://demo.invalid")!
        let path = url.path
        let procedure = path.hasPrefix("/api/trpc/") ? String(path.dropFirst("/api/trpc/".count)) : path
        // The refurbished section asks the same procedures as the new shop
        // with `condition: "refurbished"`; it is answered from its own
        // recording or not at all, never from the new shop's.
        #if DEBUG
        // `-NetLetDemoOffline auth.me` (procedures, comma-separated) fails
        // them as a phone with no connection would — for the UI tests of
        // what the app says when a read could not be made.
        if let offline = UserDefaults.standard.string(forKey: "NetLetDemoOffline"),
           offline.split(separator: ",").contains(where: { $0.trimmingCharacters(in: .whitespaces) == procedure }) {
            throw URLError(.notConnectedToInternet)
        }
        #endif
        let input = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "input" }?.value ?? ""
        let data: Data
        if input.contains(#""condition":"refurbished""#) {
            data = bundle.resource("demo.\(procedure).refurbished", "json")
        } else {
            let specific = variant.map { bundle.resource("demo.\(procedure).\($0)", "json") } ?? Data()
            data = specific.isEmpty ? bundle.resource("demo.\(procedure)", "json") : specific
        }
        let status = data.isEmpty ? 404 : 200
        let body = data.isEmpty
            ? Data(#"{"error":{"json":{"message":"ios.error.notFound","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404}}}}"#.utf8)
            : data
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        return (body, response)
    }
}
