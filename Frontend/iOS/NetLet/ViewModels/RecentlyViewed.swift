import Foundation
import Observation

/// What this phone looked at lately — the home page's "Previously viewed"
/// shelf, the web's `lib/recentlyViewed.ts` rule for rule, on the owner's
/// word ("products that customers have recently browsed, allowing them to
/// easily revisit items without searching again").
///
/// Kept on the phone and never sent to be stored, the recent searches' rule;
/// the one place the ids leave the phone is with a request for the shopper's
/// picks (`recommendations.forMe`), where they are the weakest signal and are
/// read and dropped. The product page records an opening by the product's id,
/// newest first and once; the shelf reads the products back by id, so the
/// cards carry today's price and photo. Nothing older than `days` is offered
/// back, and at most `most` are kept.
@Observable
@MainActor
final class RecentlyViewed {
    struct Entry: Codable, Equatable, Sendable {
        let id: String
        let at: Date
    }

    nonisolated static let key = "netlet.recentlyViewed"
    /// The most kept, and the most a request for picks carries (`MAX_VIEWED`).
    nonisolated static let most = 24
    /// Older than this, an opening is forgotten (`VIEWED_DAYS`).
    nonisolated static let days = 90.0
    /// Longer than any product id; the storefront's is a number or a demo handle.
    nonisolated static let longestId = 191

    private(set) var entries: [Entry]
    private let defaults: UserDefaults
    private let now: () -> Date

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = { Date() }) {
        self.defaults = defaults
        self.now = now
        let stored = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([Entry].self, from: $0) } ?? []
        entries = Self.fresh(stored, now: now())
    }

    /// The ids alone, newest first — what the shelf asks for and a request for picks carries.
    var ids: [String] { entries.map(\.id) }

    func remember(_ id: String) {
        entries = Self.with(entries, id: id, at: now())
        defaults.set(try? JSONEncoder().encode(entries), forKey: Self.key)
    }

    /// Takes one product off — the browsing history's own remove (`forgetViewed`).
    func forget(_ id: String) {
        entries = Self.without(entries, id: id)
        if entries.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else {
            defaults.set(try? JSONEncoder().encode(entries), forKey: Self.key)
        }
    }

    func clear() {
        entries = []
        defaults.removeObject(forKey: Self.key)
    }

    /// The list without one product (`withoutViewed`).
    nonisolated static func without(_ list: [Entry], id: String) -> [Entry] {
        list.filter { $0.id != id }
    }

    /// The list with `id` put first, once (`withViewed`).
    nonisolated static func with(_ list: [Entry], id: String, at: Date) -> [Entry] {
        guard !id.isEmpty, id.count <= longestId else { return list }
        return Array(([Entry(id: id, at: at)] + list.filter { $0.id != id }).prefix(most))
    }

    /// The entries still worth offering: well formed, newest first, inside the window (`freshViewed`).
    nonisolated static func fresh(_ list: [Entry], now: Date) -> [Entry] {
        let floor = now.addingTimeInterval(-days * 24 * 60 * 60)
        var seen = Set<String>()
        return Array(
            list.filter { !$0.id.isEmpty && $0.id.count <= longestId && $0.at >= floor }
                .sorted { $0.at > $1.at }
                .filter { seen.insert($0.id).inserted }
                .prefix(most)
        )
    }
}
