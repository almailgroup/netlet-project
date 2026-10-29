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

    /// The account's list, with this device's added to it.
    func adoptAccount() async {
        signedIn = true
        guard let stored = try? await account.savedProducts() else { return }
        var merged = stored
        for productId in deviceIds where !stored.contains(productId) {
            if let answer = try? await account.setSaved(productId, saved: true) { merged = answer }
        }
        ids = merged
        await refreshWished()
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
        ids = deviceIds
        wished = []
    }

    func toggle(_ productId: String) async {
        await set(productId, saved: !ids.contains(productId))
    }

    /// Into Saved without asking which list — the bag's "Save for later",
    /// the web's `saveForLater`.
    func save(_ productId: String) async {
        guard !ids.contains(productId) else { return }
        await set(productId, saved: true)
    }

    /// Out of Saved alone: a wishlist the product is on keeps it, since a
    /// list somebody shared is not the bag's to edit (`unsave`).
    func unsave(_ productId: String) async {
        guard ids.contains(productId) else { return }
        await set(productId, saved: false)
    }

    private func set(_ productId: String, saved saving: Bool) async {
        ids = saving ? ids + [productId] : ids.filter { $0 != productId }
        if signedIn {
            if let answer = try? await account.setSaved(productId, saved: saving) { ids = answer }
        } else {
            defaults.set(ids, forKey: Self.key)
        }
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
    func unwish(_ productId: String) async {
        ids = ids.filter { $0 != productId }
        wished = wished.filter { $0 != productId }
        try? await account.unwish(productId)
        if let stored = try? await account.savedProducts() { ids = stored }
        await refreshWished()
    }

    private var deviceIds: [String] { defaults.stringArray(forKey: Self.key) ?? [] }
}
