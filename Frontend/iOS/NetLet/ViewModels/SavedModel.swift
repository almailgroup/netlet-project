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
        let saving = !ids.contains(productId)
        ids = saving ? ids + [productId] : ids.filter { $0 != productId }
        if signedIn {
            if let answer = try? await account.setSaved(productId, saved: saving) { ids = answer }
        } else {
            defaults.set(ids, forKey: Self.key)
        }
    }

    private var deviceIds: [String] { defaults.stringArray(forKey: Self.key) ?? [] }
}
