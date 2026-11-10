import Foundation
import Observation

/// "Notify me when back in stock" — the web's `useStockReminder`: one
/// reminder per product, the shopper's own, on every sold-out product the app
/// draws (its page, its card, the preview, Saved, Frequently bought).
///
/// It is the follow row's `backInStock` and nothing else — a reminder no
/// longer turns price-drop notices on as well (`followFlags`) — and the
/// server tells the shopper the moment the product can be bought again, in
/// the inbox and by email where the shop sends email and the account has it
/// on (`customer.follows.reach`), which the toast names so it never promises
/// an email that will not come. Held once for the whole app, so a grid of
/// sold-out cards reads the account's reminders once and every card agrees.
@Observable
@MainActor
final class StockReminders {
    /// A guest who pressed Notify me is signing in; the reminder is set once
    /// the session exists, and forgotten if they close sign-in instead.
    struct Pending: Equatable, Sendable {
        let productId: String
        let title: String
    }

    /// Products with a reminder on.
    private(set) var ids: Set<String> = []
    /// Being saved.
    private(set) var working: Set<String> = []
    /// Whether a reminder is emailed as well as sent to the inbox.
    private(set) var byEmail = false
    var afterSignIn: Pending?
    private var loaded = false
    private let api: APICalling

    init(api: APICalling) {
        self.api = api
    }

    func isOn(_ productId: String) -> Bool { ids.contains(productId) }

    /// The account's reminders and how they arrive, once per sign-in.
    func load() async {
        guard !loaded else { return }
        loaded = true
        guard let follows = try? await api.call(API.follows) else {
            loaded = false
            return
        }
        ids = Set(follows.filter(\.backInStock).map(\.productId))
        byEmail = (try? await api.call(API.followReach))?.email ?? false
    }

    /// Turns it on or off; throws what the server refused with.
    func set(_ productId: String, on: Bool) async throws {
        working.insert(productId)
        defer { working.remove(productId) }
        _ = try await api.call(API.setFollow, .init(productId: productId, priceDrop: nil, backInStock: on))
        if on { ids.insert(productId) } else { ids.remove(productId) }
    }

    /// The last account's reminders are not the next one's.
    func signedOut() {
        ids = []
        working = []
        byEmail = false
        loaded = false
        afterSignIn = nil
    }
}

extension AppModel {
    /// A press on Notify me: on or off for somebody signed in; a guest signs
    /// in first, and the reminder is set once they have.
    func pressReminder(productId: String, title: String) {
        guard session.isSignedIn else {
            reminders.afterSignIn = .init(productId: productId, title: title)
            authPresented = true
            return
        }
        guard !reminders.working.contains(productId) else { return }
        let next = !reminders.isOn(productId)
        Task { await setReminder(productId: productId, title: title, on: next) }
    }

    /// Sets or clears a reminder and says how it will arrive.
    func setReminder(productId: String, title: String, on: Bool) async {
        await reminders.load()
        let worked = await attempt(fallback: "follow.failed") {
            try await reminders.set(productId, on: on)
        }
        guard worked else { return }
        let key = on ? (reminders.byEmail ? "remind.setEmail" : "remind.setInbox") : "remind.off"
        toast(language.t(key, ["name": title]))
    }
}
