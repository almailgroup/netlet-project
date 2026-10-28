import Foundation
import ImageIO
import UIKit

/// Every remote picture the app draws: fetched once, shrunk to the size it is
/// drawn at, and kept.
///
/// **It replaced `AsyncImage`, which showed one product's photo and none of
/// the rest.** The live catalogue's photos are mostly a seller's own, on a slow
/// server sending originals of 100 KB to 1.4 MB with no cache headers; one was
/// on Shopify's CDN, 38 KB and fast. `AsyncImage` cancels its load whenever the
/// card it sits in is laid out afresh — and since the tab bar began stepping
/// aside on a scroll, every scroll lays the page out afresh — and a cancelled
/// load is a failure it never retries. So the fast photo arrived before the
/// first scroll and the slow ones never did.
///
/// What it does instead, each for that reason:
/// - **A load belongs to the picture, not to the view.** One task per address
///   and size, shared by every view asking; a view going away stops waiting
///   for it and nothing else, so a photo half-fetched when a card scrolled off
///   is there when it scrolls back.
/// - **A dropped or slow answer is tried again**, twice, after a pause.
/// - **A picture is decoded at the size it is drawn at** (ImageIO's thumbnail,
///   off the main thread), so a 1.4 MB original is a few hundred kilobytes of
///   pixels rather than tens of megabytes, and scrolling a grid of them stays
///   smooth.
/// - **Kept twice**: the decoded picture in memory while the app runs, and the
///   bytes on disk across launches, so a photo seen once appears at once.
actor ImagePipeline {
    static let shared = ImagePipeline()

    /// How a picture's bytes are fetched: the network, or a test's stand-in.
    typealias Fetch = @Sendable (URL) async throws -> (Data, URLResponse)

    private let fetch: Fetch
    private let disk: URLCache?
    private let pauses: [Duration]
    private var running: [String: Task<UIImage?, Never>] = [:]
    /// Addresses that failed every try, and when — asked again only after a while.
    private var refused: [String: ContinuousClock.Instant] = [:]
    let memory = ImageMemory()

    init(fetch: Fetch? = nil, disk: URLCache? = ImagePipeline.makeDisk(), pauses: [Duration] = [.milliseconds(600), .seconds(2)]) {
        self.disk = disk
        self.pauses = pauses
        if let fetch {
            self.fetch = fetch
        } else {
            let session = ImagePipeline.makeSession()
            self.fetch = { url in try await session.data(from: url) }
        }
    }

    /// The bytes on disk: a cache of its own, so the catalogue's photos never
    /// push the API's answers out, or the other way round.
    static func makeDisk() -> URLCache {
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("NetLetImages")
        return URLCache(memoryCapacity: 8 * 1024 * 1024, diskCapacity: 300 * 1024 * 1024, directory: directory)
    }

    /// A session for pictures alone: no cookies (a photo needs no session, and
    /// a seller's server has no business with NetLet's), six at once to a
    /// host, and patient with a slow one.
    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpMaximumConnectionsPerHost = 6
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 90
        return URLSession(configuration: configuration)
    }

    /// The size a picture is decoded at, in pixels along its longer side: the
    /// box it fills at the screen's scale, with room for a photo that is not
    /// square to fill it, rounded up to a few steps so neighbouring boxes share
    /// one copy.
    static func pixels(for size: CGSize, scale: CGFloat) -> Int {
        let wanted = max(size.width, size.height) * scale * 1.25
        for step in [256, 512, 768, 1024, 1536, 2048, 3072] where wanted <= CGFloat(step) { return step }
        return 3072
    }

    static func key(_ url: URL, pixels: Int) -> String { "\(pixels)|\(url.absoluteString)" }

    /// The size a product card's photo is decoded at, for fetching ahead of one.
    static func cardPixels(scale: CGFloat) -> Int {
        pixels(for: CGSize(width: 180, height: 225), scale: max(scale, 2))
    }

    /// The picture at that size, if one has been decoded already — what a view
    /// draws on its first frame, so a photo seen before never flashes empty.
    nonisolated func cached(_ url: URL, pixels: Int) -> UIImage? {
        memory.image(for: Self.key(url, pixels: pixels))
    }

    /// The picture at whatever size it was last decoded — what a product page
    /// draws on its first frame from the card that opened it, while its own
    /// sharper copy is made.
    nonisolated func anySize(_ url: URL) -> UIImage? {
        memory.latest(for: url.absoluteString)
    }

    /// The picture, fetched and decoded if it has to be; nil when it cannot be had.
    func image(_ url: URL, pixels: Int) async -> UIImage? {
        let key = Self.key(url, pixels: pixels)
        if let hit = memory.image(for: key) { return hit }
        if let task = running[key] { return await task.value }
        if let when = refused[key], ContinuousClock.now - when < .seconds(30) { return nil }

        let task = Task<UIImage?, Never> { [fetch, disk, pauses] in
            guard let data = await Self.bytes(url, fetch: fetch, disk: disk, pauses: pauses) else { return nil }
            return Self.decode(data, pixels: pixels)
        }
        running[key] = task
        let image = await task.value
        running[key] = nil
        if let image {
            memory.keep(image, for: key, url: url.absoluteString)
            refused[key] = nil
        } else {
            refused[key] = .now
        }
        return image
    }

    /// Fetches the catalogue's photos ahead of the shelves that draw them, at
    /// the size a card draws them, a few at a time.
    func prefetch(_ urls: [URL], pixels: Int) async {
        await withTaskGroup(of: Void.self) { group in
            var waiting = urls[...]
            for _ in 0..<min(4, urls.count) {
                guard let url = waiting.popFirst() else { break }
                group.addTask { _ = await self.image(url, pixels: pixels) }
            }
            while await group.next() != nil {
                guard let url = waiting.popFirst() else { continue }
                group.addTask { _ = await self.image(url, pixels: pixels) }
            }
        }
    }

    /// The bytes, from the disk if they are there, else the network — tried
    /// again after each pause when the answer was a dropped connection, a time
    /// out or the server's own trouble. A 404 is final.
    private static func bytes(_ url: URL, fetch: Fetch, disk: URLCache?, pauses: [Duration]) async -> Data? {
        let request = URLRequest(url: url)
        if let stored = disk?.cachedResponse(for: request), !stored.data.isEmpty { return stored.data }
        for attempt in 0...pauses.count {
            do {
                let (data, response) = try await fetch(url)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 200
                if (200..<300).contains(status), !data.isEmpty {
                    disk?.storeCachedResponse(CachedURLResponse(response: response, data: data), for: request)
                    return data
                }
                guard status == 408 || status == 429 || status >= 500 else { return nil }
            } catch {
                guard isWorthAnotherTry(error) else { return nil }
            }
            guard attempt < pauses.count else { break }
            try? await Task.sleep(for: pauses[attempt])
        }
        return nil
    }

    private static func isWorthAnotherTry(_ error: Error) -> Bool {
        guard let failure = error as? URLError else { return false }
        switch failure.code {
        case .timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .secureConnectionFailed, .cannotLoadFromNetwork, .cancelled:
            return true
        default:
            return false
        }
    }

    /// Decoded at the size it is drawn at, its orientation applied, ready to
    /// draw — or nil for bytes that are not a picture.
    static func decode(_ data: Data, pixels: Int) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        if let source = CGImageSourceCreateWithData(data as CFData, options) {
            let thumbnail = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: pixels,
            ] as CFDictionary
            if let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnail) {
                return UIImage(cgImage: image)
            }
        }
        guard let image = UIImage(data: data) else { return nil }
        return image.preparingForDisplay() ?? image
    }
}

/// The decoded pictures, by address and size, while the app runs — bounded by
/// their pixels, so the system can take them back when it needs the memory.
final class ImageMemory: @unchecked Sendable {
    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 120 * 1024 * 1024
        return cache
    }()

    /// The last copy decoded of each address, whatever its size.
    private let latest: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 400
        return cache
    }()

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func latest(for url: String) -> UIImage? { latest.object(forKey: url as NSString) }

    func keep(_ image: UIImage, for key: String, url: String) {
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
        latest.setObject(image, forKey: url as NSString)
    }
}
