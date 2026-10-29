import Foundation
import Observation

/// The hearts: products a shopper saved, the web's `savedIds` and `toggleSaved`.
///
/// Signed out they live on this device; signed in they are the account's
/// (`customer.saved`), so the web and another phone show the same ones — and
/// anything saved on this device before signing in is added to the account's
/// list then, as the web does. A press shows at once and the server's answer
/// is the list kept.
@Observable
@MainActor
final class SavedModel {
    private(set) var ids: [String]
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

    /// The account's list, with this device's added to it.
    func adoptAccount() async {
        signedIn = true
        guard let stored = try? await account.savedProducts() else { return }
        var merged = stored
        for productId in deviceIds where !stored.contains(productId) {
            if let answer = try? await account.setSaved(productId, saved: true) { merged = answer }
        }
        ids = merged
    }

    /// Back to the hearts kept on this device.
    func signedOut() {
        signedIn = false
        ids = deviceIds
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

    /// The heart's question answered — a private or a public wishlist, made if
    /// the shopper has none (`wishlists.wish`) — and in Saved, so the heart fills.
    /// Drawn filled at once, and empty again if the shop refuses.
    func wish(_ productId: String, visibility: String, title: String) async throws -> WishAnswer {
        if !ids.contains(productId) { ids.append(productId) }
        do {
            let answer = try await account.wish(productId, visibility: visibility, title: title)
            if let stored = try? await account.savedProducts() { ids = stored }
            return answer
        } catch {
            ids = ids.filter { $0 != productId }
            throw error
        }
    }

    /// A filled heart pressed, signed in: out of Saved and off every list of
    /// the shopper's, since the heart is how they said they wanted it.
    func unwish(_ productId: String) async {
        ids = ids.filter { $0 != productId }
        try? await account.unwish(productId)
        if let stored = try? await account.savedProducts() { ids = stored }
    }

    private var deviceIds: [String] { defaults.stringArray(forKey: Self.key) ?? [] }
}
