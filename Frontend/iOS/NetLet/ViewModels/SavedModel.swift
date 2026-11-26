import Foundation
import Observation

/// The hearts: what a shopper saved, and what is on their wishlists — the
/// web's `savedIds`, `wishedIds` and `heartedIds`.
///
/// **Saved and the wishlists are two different things, on the owner's word**:
/// Saved is what somebody keeps to come back to and buy, only theirs; a
/// wishlist is what they would like, kept private or shared for family to buy
/// from. A heart fills for either (`isHearted`), and an empty one asks which
/// (`WishSheet`). Saved lives on this device signed out and is the account's
/// signed in (`customer.saved`), so the web and another phone show the same
/// ones — and anything saved on this device before signing in is added to the
/// account's list then, as the web does. A press shows at once and the
/// server's answer is the list kept.
@Observable
@MainActor
final class SavedModel {
    /// Saved.
    private(set) var ids: [String]
    /// What is on the shopper's wishlists, once each; empty signed out.
    private(set) var wished: [String] = []
    private var signedIn = false
    /// Signed in and the account's list could not be read: the Saved page
    /// says so with Try again rather than "nothing saved yet", the web's
    /// `savedUnread`, and the app asks again on coming back.
    private(set) var unread = false

    private let account: AccountServicing
    private let defaults: UserDefaults
    static let key = "netlet.saved"

    init(account: AccountServicing, defaults: UserDefaults = .standard) {
        self.account = account
        self.defaults = defaults
        ids = defaults.stringArray(forKey: Self.key) ?? []
    }

    func contains(_ productId: String) -> Bool { ids.contains(productId) }

    /// Whether the heart is filled: in Saved, or on a wishlist.
    func isHearted(_ productId: String) -> Bool { ids.contains(productId) || wished.contains(productId) }

    /// The account's list, with this device's added to it — and then this
    /// device's emptied, the web's rule: kept, it was merged in again at every
    /// launch, so a heart taken off one of them came back, and signing out
    /// left the account's hearts on a phone somebody else might use.
    func adoptAccount() async {
        signedIn = true
        guard let stored = try? await account.savedProducts() else {
            unread = true
            return
        }
        unread = false
        var merged = stored
        var allKept = true
        for productId in deviceIds where !stored.contains(productId) {
            if let answer = try? await account.setSaved(productId, saved: true) { merged = answer } else { allKept = false }
        }
        ids = merged
        if allKept { defaults.removeObject(forKey: Self.key) }
        await refreshWished()
    }

    /// Saved read again from the account — after something went into it
    /// somewhere other than the heart (a wishlist item moved there).
    func refreshSaved() async {
        guard signedIn, let stored = try? await account.savedProducts() else { return }
        ids = stored
        unread = false
    }

    /// The lists read again — after an item is added to or taken off one
    /// somewhere other than the heart.
    func refreshWished() async {
        guard signedIn, let stored = try? await account.wishedProducts() else { return }
        wished = stored
    }

    /// Back to the hearts kept on this device.
    func signedOut() {
        signedIn = false
        unread = false
        ids = deviceIds
        wished = []
    }

    func toggle(_ productId: String) async {
        await set(productId, saved: !ids.contains(productId))
    }

    /// Into Saved without asking which list — the bag's "Save for later",
    /// the web's `saveForLater`.
    /// Answers whether it took, for the caller to say a refusal.
    @discardableResult
    func save(_ productId: String) async -> Bool {
        guard !ids.contains(productId) else { return true }
        return await set(productId, saved: true)
    }

    /// Out of Saved alone: a wishlist the product is on keeps it, since a
    /// list somebody shared is not the bag's to edit (`unsave`).
    @discardableResult
    func unsave(_ productId: String) async -> Bool {
        guard ids.contains(productId) else { return true }
        return await set(productId, saved: false)
    }

    /// Answers whether it took: the heart's toast said "saved" or "removed"
    /// over a refusal that had put the heart back as it was.
    private func set(_ productId: String, saved saving: Bool) async -> Bool {
        let before = ids
        ids = saving ? ids + [productId] : ids.filter { $0 != productId }
        guard signedIn else {
            defaults.set(ids, forKey: Self.key)
            return true
        }
        // The server's list is what is kept; a refusal puts the heart back
        // as it was, rather than leaving it drawn saved over nothing saved.
        guard let answer = try? await account.setSaved(productId, saved: saving) else {
            ids = before
            return false
        }
        ids = answer
        return true
    }

    /// The heart's question answered with a wishlist — a private or a public
    /// one, made if the shopper has none (`wishlists.wish`) — and never Saved,
    /// which is the other answer. Drawn filled at once, and empty again if the
    /// shop refuses.
    func wish(_ productId: String, visibility: String, title: String) async throws -> WishAnswer {
        let had = wished.contains(productId)
        if !had { wished.append(productId) }
        do {
            let answer = try await account.wish(productId, visibility: visibility, title: title)
            await refreshWished()
            return answer
        } catch {
            if !had { wished = wished.filter { $0 != productId } }
            throw error
        }
    }

    /// A filled heart on something on a wishlist: off every list of the
    /// shopper's and out of Saved, since the heart is how they said they
    /// wanted it.
    ///
    /// Answers whether it took. A refusal puts both back as they were: it
    /// left the heart drawn empty over a product the account still held, under
    /// a toast saying it was off the lists.
    @discardableResult
    func unwish(_ productId: String) async -> Bool {
        let (savedBefore, wishedBefore) = (ids, wished)
        ids = ids.filter { $0 != productId }
        wished = wished.filter { $0 != productId }
        do {
            try await account.unwish(productId)
        } catch {
            ids = savedBefore
            wished = wishedBefore
            return false
        }
        if let stored = try? await account.savedProducts() { ids = stored }
        await refreshWished()
        return true
    }

    private var deviceIds: [String] { defaults.stringArray(forKey: Self.key) ?? [] }
}
