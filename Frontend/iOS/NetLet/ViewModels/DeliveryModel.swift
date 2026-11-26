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
///
/// **The address in use is the account's default delivery address (0088)**,
/// the web's `CustomerContext` rule: signing in reads the account's default
/// into the phone's key, with its governorate as the area, so a new phone
/// delivers where the account does, and every choice here is written back.
/// The default way to pay rides the same answer (`accountDefaults`). Before
/// 0088 is pasted the answer is `ready: false` and the phone's key is the
/// whole of it, as it always was.
@Observable
@MainActor
final class DeliveryModel {
    private(set) var zoneId: String?
    private(set) var addresses: [SavedAddress] = []
    private(set) var lastAddressId: Int?
    private(set) var loaded = false
    /// The address book could not be read, and nothing of it is on the phone.
    /// Never drawn as an empty book: the sheet says what failed and offers to
    /// try again, rather than telling a signed-in shopper to add their first
    /// address — the web's `failedToLoad`.
    private(set) var bookError: APIError?
    /// The account's defaults, as `customer.defaults.get` last answered.
    private(set) var accountDefaults: CustomerDefaults?

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
        async let book = readBook()
        async let kept = try? api.call(API.customerDefaults)
        if let stored = await profile?.deliveryZoneId { zoneId = stored }
        switch await book {
        case .success(let read):
            addresses = read
            bookError = nil
        case .failure(let failure):
            // A book already on the phone stays; only an empty one says so.
            if failure != .cancelled, addresses.isEmpty { bookError = failure }
        }
        if let kept = await kept { await adopt(kept) }
        // An account that never chose an area still delivers somewhere: the
        // governorate of the address checkout would pick. A guess never
        // overwrites a choice, so it is not written up.
        if zoneId == nil {
            zoneId = (addresses.first { $0.id == lastAddressId } ?? addresses.first)?.governorate
        }
        loaded = true
    }

    private func readBook() async -> Result<[SavedAddress], APIError> {
        do { return .success(try await account.addresses()) } catch { return .failure(APIError.from(error)) }
    }

    /// The account's default address, read into the phone — or, for an account
    /// with none yet, the one this phone was using, written up. The server
    /// refuses an id that is not this account's.
    private func adopt(_ kept: CustomerDefaults) async {
        accountDefaults = kept
        guard kept.ready else { return }
        if let id = kept.addressId, addresses.contains(where: { $0.id == id }) {
            if lastAddressId != id {
                lastAddressId = id
                defaults.set(id, forKey: CheckoutViewModel.lastAddressKey)
            }
            if let governorate = kept.governorate, !governorate.isEmpty, governorate != zoneId {
                await setZone(governorate, signedIn: true)
            }
        } else if kept.addressId == nil, let last = lastAddressId, addresses.contains(where: { $0.id == last }) {
            await sendDefault(last)
        }
    }

    private func sendDefault(_ id: Int) async {
        guard let answer = try? await api.call(API.setDefaultAddress, .init(addressId: id)), answer.saved,
              let kept = accountDefaults else { return }
        let governorate = addresses.first { $0.id == id }?.governorate
        accountDefaults = CustomerDefaults(ready: true, addressId: id, governorate: governorate, payment: kept.payment, choosable: kept.choosable)
    }

    /// Deliver to this address: checkout starts from it, its governorate
    /// prices each seller's delivery, and it is the account's default.
    func choose(_ address: SavedAddress) async {
        lastAddressId = address.id
        defaults.set(address.id, forKey: CheckoutViewModel.lastAddressKey)
        guard let governorate = address.governorate, !governorate.isEmpty else { return }
        await setZone(governorate, signedIn: true)
        if accountDefaults?.ready == true, accountDefaults?.addressId != address.id {
            await sendDefault(address.id)
        }
    }

    /// The way to pay every order starts from, as the account keeps it —
    /// checkout's "Your default". Quick settings no longer changes it, on the
    /// owner's word ("remove the payment method from the quick settings").
    var payment: String {
        accountDefaults.flatMap { CustomerDefaults.startingPayment($0.payment, choosable: $0.choosable) } ?? "cod"
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
        bookError = nil
        accountDefaults = nil
        zoneId = defaults.string(forKey: Self.guestZoneKey)
        loaded = true
    }
}
