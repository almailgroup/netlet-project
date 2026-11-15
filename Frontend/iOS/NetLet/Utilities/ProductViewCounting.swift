import Foundation

/// Counting a product page's opening for its store (`Shared/commerce/productViews.ts`,
/// migration 0084) — the web's `lib/productViews.ts`. The channel is the app,
/// the source is the page the product was opened from, and the phone keeps the
/// day's list of products it has counted, so the server is told only "a view,
/// and the first today" and never who or which phone.

/// Where the next product page comes from: the kind of the last shop page that
/// appeared (`ShopPage`'s `viewSource`), or — for a press that opens a product
/// over the page under it, the search sheet or NetLet AI — the hint that press
/// left, good for `ViewCounting.hintSeconds`. Read once by the product page as
/// its model is made, which is before its own page has appeared.
final class ViewSources {
    private(set) var current = "other"
    private var hint: (source: String, at: Date)?

    func appeared(_ kind: String) { current = kind }

    func note(_ source: String, now: Date = Date()) { hint = (source, now) }

    func take(now: Date = Date()) -> String {
        defer { hint = nil }
        if let hint, now.timeIntervalSince(hint.at) < ViewCounting.hintSeconds { return hint.source }
        return current
    }
}

enum ViewCounting {
    /// The web's `SOURCE_HINT_MS`.
    static let hintSeconds: TimeInterval = 10
    static let key = "netlet.viewsCounted"
    /// More than anybody opens in a day; past it the oldest are forgotten.
    static let mostKept = 400

    struct Counted: Codable, Equatable {
        let day: String
        let ids: [String]
    }

    /// Whether `id` is new on `day`, and the list with it added — the web's `countToday`.
    static func countToday(_ held: Counted?, id: String, day: String) -> (first: Bool, next: Counted) {
        let list = held?.day == day ? held?.ids ?? [] : []
        if list.contains(id) { return (false, Counted(day: day, ids: list)) }
        return (true, Counted(day: day, ids: Array((list + [id]).suffix(mostKept))))
    }

    /// The Kuwaiti day a moment falls on, `yyyy-MM-dd`.
    static func kuwaitDay(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        return formatter.string(from: date)
    }

    /// The day's list read, `id` marked in it, and whether it was new.
    static func markCounted(_ id: String, defaults: UserDefaults = .standard, now: Date = Date()) -> Bool {
        let held = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Counted.self, from: $0) }
        let (first, next) = countToday(held, id: id, day: kuwaitDay(now))
        if first, let data = try? JSONEncoder().encode(next) { defaults.set(data, forKey: key) }
        return first
    }
}

extension AppModel.Tab {
    /// The source a page on this tab stands for when it names none of its own.
    var viewSource: String {
        switch self {
        case .home: "home"
        case .categories, .deals: "browse"
        case .account, .cart: "account"
        }
    }
}
