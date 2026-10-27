import Foundation
import Observation

/// Where the shop delivers, for the header's location button and its sheet —
/// the web's `addressInUse` over the account's address book and its area.
///
/// Signed in, the area is the account's (`customer.profile.update`, which the
/// web's header and checkout read too) and the address is the one used last
/// on this device if it is in that area, else the area's first — checkout's
/// own key (`CheckoutViewModel.lastAddressKey`), so picking an address here is
/// the one checkout starts from. Signed out there is no book, and the area a
/// guest picks is kept on the device to say what delivery costs.
@Observable
@MainActor
final class DeliveryModel {
    private(set) var zoneId: String?
    private(set) var addresses: [SavedAddress] = []
    private(set) var lastAddressId: Int?
    private(set) var loaded = false

    private let api: APICalling
    private let account: AccountServicing
    private let defaults: UserDefaults
    static let guestZoneKey = "netlet.deliveryZone"

    init(api: APICalling, account: AccountServicing, defaults: UserDefaults = .standard) {
        self.api = api
        self.account = account
        self.defaults = defaults
        zoneId = defaults.string(forKey: Self.guestZoneKey)
        lastAddressId = defaults.object(forKey: CheckoutViewModel.lastAddressKey) as? Int
    }

    /// The saved address being delivered to, by the web's rule.
    var inUse: SavedAddress? {
        Self.addressInUse(addresses, lastUsed: lastAddressId, zone: zoneId)
    }

    /// What the header says: the address's own name ("Home"), else the area,
    /// else nil for the button to ask.
    func label(_ language: Language) -> String? {
        if let inUse { return inUse.label }
        return ReferenceData.shared.governorate(id: zoneId)?.name(language)
    }

    /// `addressInUse` in `Frontend/Web/src/lib/lastAddress.ts`.
    nonisolated static func addressInUse(_ book: [SavedAddress], lastUsed: Int?, zone: String?) -> SavedAddress? {
        guard let zone else { return nil }
        return book.first { $0.id == lastUsed && $0.governorate == zone } ?? book.first { $0.governorate == zone }
    }

    /// The account's area and book, asked again whenever the sheet opens.
    func refresh(signedIn: Bool) async {
        lastAddressId = defaults.object(forKey: CheckoutViewModel.lastAddressKey) as? Int
        guard signedIn else {
            signedOut()
            return
        }
        async let profile = try? account.profile()
        async let book = try? account.addresses()
        if let stored = await profile?.deliveryZoneId { zoneId = stored }
        if let book = await book { addresses = book }
        // An account that never chose an area still delivers somewhere: the
        // governorate of the address checkout would pick. A guess never
        // overwrites a choice, so it is not written up.
        if zoneId == nil {
            zoneId = (addresses.first { $0.id == lastAddressId } ?? addresses.first)?.governorate
        }
        loaded = true
    }

    /// Deliver to this address: checkout starts from it, and its governorate
    /// prices each seller's delivery.
    func choose(_ address: SavedAddress) async {
        lastAddressId = address.id
        defaults.set(address.id, forKey: CheckoutViewModel.lastAddressKey)
        guard let governorate = address.governorate, !governorate.isEmpty else { return }
        await setZone(governorate, signedIn: true)
    }

    /// A governorate alone — a guest's, or an account's with no address there.
    func setZone(_ id: String, signedIn: Bool) async {
        zoneId = id
        defaults.set(id, forKey: Self.guestZoneKey)
        guard signedIn else { return }
        _ = try? await api.call(API.setDeliveryArea, .init(deliveryZoneId: id))
    }

    func signedOut() {
        addresses = []
        zoneId = defaults.string(forKey: Self.guestZoneKey)
        loaded = true
    }
}
