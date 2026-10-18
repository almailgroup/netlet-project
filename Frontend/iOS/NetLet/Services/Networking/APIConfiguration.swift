import Foundation

/// Where the NetLet server is.
///
/// The address is a build setting (`NETLET_API_BASE_URL` in
/// `Frontend/iOS/Config/Shared.xcconfig`, written into Info.plist), and a
/// launch argument overrides it for development — `-NetLetAPIBaseURL
/// http://localhost:5001` points a simulator at a server on the same Mac.
struct APIConfiguration: Sendable {
    static let fallback = URL(string: "https://netlet-project.vercel.app")!

    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    static func current(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> APIConfiguration {
        let candidates = [
            defaults.string(forKey: "NetLetAPIBaseURL"),
            bundle.object(forInfoDictionaryKey: "NetLetAPIBaseURL") as? String,
        ]
        for candidate in candidates {
            if let text = candidate?.trimmingCharacters(in: .whitespaces), !text.isEmpty,
               let url = URL(string: text), url.scheme == "https" || url.scheme == "http", url.host != nil {
                return APIConfiguration(baseURL: url)
            }
        }
        return APIConfiguration(baseURL: fallback)
    }

    /// A path on the server: `/api/trpc/auth.me`, `/api/media`.
    func url(path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL.appendingPathComponent(path)
    }

    /// A picture's address. The catalogue sends uploaded and bundled pictures
    /// as paths on the site (`/media/…`, `/departments/grocery.webp`) and a
    /// seller's own as full https addresses; both become a URL here.
    func resolve(_ reference: String?) -> URL? {
        guard let reference = reference?.trimmingCharacters(in: .whitespaces), !reference.isEmpty else { return nil }
        if reference.hasPrefix("http://") || reference.hasPrefix("https://") { return URL(string: reference) }
        guard reference.hasPrefix("/") else { return nil }
        return URL(string: reference, relativeTo: baseURL)?.absoluteURL
    }
}
