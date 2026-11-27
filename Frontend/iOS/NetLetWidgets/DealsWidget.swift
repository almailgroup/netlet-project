import ImageIO
import SwiftUI
import UIKit
import WidgetKit

/// Today's deals on the home screen: the deepest savings NetLet has now —
/// one, three or four by the widget's size — each opening its product in the
/// app. Deals are public, so the extension asks NetLet itself
/// (`commerce.products.list`), and a saving is only what the server sends
/// as one: it drops a was-price a store's discount permit does not cover.
struct DealsWidget: Widget {
    var body: some WidgetConfiguration {
        let words = WidgetWords.current()
        return StaticConfiguration(kind: "NetLetDeals", provider: DealsProvider()) { entry in
            DealsWidgetFace(entry: entry)
        }
        .configurationDisplayName(words.t("home.heroDeals"))
        .description(words.t("ios.widget.dealsNote"))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct DealsEntry: TimelineEntry {
    let date: Date
    let content: DealsWidgetContent
}

private struct DealsWidgetFace: View {
    let entry: DealsEntry
    @Environment(\.widgetFamily) private var family

    private var size: HomeWidgetSize { HomeWidgetSize(family) }

    var body: some View {
        DealsWidgetView(content: entry.content, size: size)
            .widgetURL(size == .small ? entry.content.deals.first.map { WidgetLink.product($0.handle) } ?? WidgetLink.deals : WidgetLink.deals)
            .containerBackground(for: .widget) { DealsWidgetGround() }
    }
}

struct DealsProvider: TimelineProvider {
    func placeholder(in context: Context) -> DealsEntry {
        DealsEntry(date: Date(), content: DealsLoader.empty(WidgetWords.current()))
    }

    func getSnapshot(in context: Context, completion: @escaping (DealsEntry) -> Void) {
        let size = HomeWidgetSize(context.family)
        Task {
            let loaded = await DealsLoader.load(size: size)
            completion(DealsEntry(date: Date(), content: loaded.content))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DealsEntry>) -> Void) {
        let size = HomeWidgetSize(context.family)
        Task {
            let loaded = await DealsLoader.load(size: size)
            // Prices move through the day; a failed read tries again sooner.
            let next = Date().addingTimeInterval(loaded.read ? 3 * 3600 : 30 * 60)
            completion(Timeline(entries: [DealsEntry(date: Date(), content: loaded.content)], policy: .after(next)))
        }
    }
}

extension HomeWidgetSize {
    init(_ family: WidgetFamily) {
        switch family {
        case .systemSmall: self = .small
        case .systemLarge, .systemExtraLarge: self = .large
        default: self = .medium
        }
    }
}

/// Reads the catalogue, keeps what is on offer, deepest saving first, and
/// fetches each one's first photo small enough for a widget's memory.
enum DealsLoader {
    /// How many products are read to find the deals among.
    static let reading = 60
    /// A photo's longest side, in pixels: twice a large widget's tile.
    static let photoPixels: CGFloat = 240

    static func empty(_ words: WidgetWords) -> DealsWidgetContent {
        DealsWidgetContent(
            title: words.t("home.heroDeals"),
            deals: [],
            seeAll: words.t("home.viewAll"),
            emptyTitle: words.t("browse.noDeals"),
            emptyNote: words.t("browse.noDealsNote"),
            rightToLeft: words.rightToLeft
        )
    }

    static func load(size: HomeWidgetSize) async -> (content: DealsWidgetContent, read: Bool) {
        let words = WidgetWords.current()
        var content = empty(words)
        guard let listed = await catalogue(language: words.language) else {
            content.emptyTitle = words.t("ios.widget.dealsUnread")
            content.emptyNote = words.t("ios.widget.dealsUnreadNote")
            return (content, false)
        }
        let chosen = Array(DealPicker.deals(in: listed).prefix(DealsWidgetContent.count(for: size)))
        let photos = await withTaskGroup(of: (Int, UIImage?).self) { group in
            for (index, deal) in chosen.enumerated() {
                group.addTask { (index, await photo(deal.photo)) }
            }
            var found: [Int: UIImage] = [:]
            for await (index, image) in group where image != nil { found[index] = image }
            return found
        }
        let rightToLeft = words.rightToLeft
        content.deals = chosen.enumerated().map { index, deal in
            DealsWidgetContent.Deal(
                handle: deal.handle,
                title: deal.title,
                price: price(deal.priceFils, rightToLeft: rightToLeft),
                was: price(deal.wasFils, rightToLeft: rightToLeft),
                percent: deal.percent,
                photo: photos[index]
            )
        }
        return (content, true)
    }

    // MARK: Reading the catalogue

    private struct Answer: Decodable {
        let result: Result
        struct Result: Decodable { let data: Payload }
        struct Payload: Decodable { let json: [DealPicker.Listed] }
    }

    static var base: URL {
        if let text = Bundle.main.object(forInfoDictionaryKey: "NetLetAPIBaseURL") as? String,
           let url = URL(string: text.trimmingCharacters(in: .whitespaces)), url.scheme == "https" || url.scheme == "http", url.host != nil {
            return url
        }
        return URL(string: "https://netlet.net")!
    }

    private static func catalogue(language: String) async -> [DealPicker.Listed]? {
        let input = #"{"json":{"first":\#(reading),"locale":"\#(language == "ar" ? "ar" : "en")"}}"#
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        guard let encoded = input.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: "/api/trpc/commerce.products.list?input=\(encoded)", relativeTo: base) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 12)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let answer = try? JSONDecoder().decode(Answer.self, from: data) else { return nil }
        return answer.result.data.json
    }

    /// A photo by its address — a path on the site or a full https one —
    /// decoded straight to the widget's size, never whole.
    private static func photo(_ reference: String?) async -> UIImage? {
        guard let reference, !reference.isEmpty, let url = URL(string: reference, relativeTo: base)?.absoluteURL else { return nil }
        guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 10)),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: photoPixels,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    // MARK: Money, the app's `Money.formatted`

    /// The currency's own three decimals, a whole amount drawn clean, in Latin
    /// digits on both pages — what the app's cards write.
    static func price(_ fils: Int, rightToLeft: Bool) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: rightToLeft ? "ar_KW@numbers=latn" : "en_US")
        formatter.currencyCode = "KWD"
        let digits = fils % 1000 == 0 ? 0 : 3
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        let value = NSDecimalNumber(mantissa: UInt64(abs(fils)), exponent: -3, isNegative: fils < 0)
        return formatter.string(from: value) ?? "KWD \(fils / 1000)"
    }
}
