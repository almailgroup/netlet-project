import Foundation
import Observation

/// Checkout: who receives it, where it goes, and placing the order.
///
/// Payment is cash on delivery and nothing else, and every figure is the
/// server's: the app sends the bag and the address, and the server prices it,
/// takes the stock and freezes the order.
@Observable
@MainActor
final class CheckoutViewModel {
    private(set) var addresses: LoadState<[SavedAddress]> = .idle
    private(set) var chosenAddress: Int?

    var contactName = ""
    var contactPhone = ""
    var governorate: String?
    var parts = AddressParts()
    /// True when the shopper picked "Another area" and types it.
    var typedArea = false
    var notes = ""

    /// Set once Place order has been pressed, so a problem is said only after
    /// it is asked about — the web's rule that nothing appears because a box lost focus.
    private(set) var attempted = false
    private(set) var placing = false
    private(set) var refusal: APIError?

    private let orders: OrderServicing
    private let account: AccountServicing
    private let defaults: UserDefaults
    private let reference: ReferenceData
    static let lastAddressKey = "netlet.lastAddressId"

    init(orders: OrderServicing, account: AccountServicing, defaults: UserDefaults = .standard, reference: ReferenceData = .shared) {
        self.orders = orders
        self.account = account
        self.defaults = defaults
        self.reference = reference
    }

    /// The saved addresses, with the one used last on this device chosen already.
    func load(user: User?) async {
        if contactName.isEmpty { contactName = user?.name ?? "" }
        guard user != nil else { return }
        addresses = .loading
        do {
            let book = try await account.addresses()
            addresses = .loaded(book)
            let last = defaults.object(forKey: Self.lastAddressKey) as? Int
            if chosenAddress == nil, let pick = book.first(where: { $0.id == last }) ?? book.first {
                use(pick)
            }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { addresses = .failed(failure) }
        }
    }

    /// Fills the form from a saved address; changes after it are for this order only.
    func use(_ address: SavedAddress) {
        chosenAddress = address.id
        governorate = address.governorate
        parts = address.parts ?? AddressParts()
        typedArea = parts.area.map { area in !(reference.areas[address.governorate ?? ""] ?? []).contains { $0.en == area } } ?? false
        if let name = address.contactName, !name.isEmpty { contactName = name }
        if let phone = address.contactPhone, !phone.isEmpty { contactPhone = phone }
        notes = address.addressNotes ?? ""
    }

    func startNewAddress() {
        chosenAddress = nil
        parts = AddressParts()
        typedArea = false
        notes = ""
    }

    /// The governorate's own areas, in the order the web lists them — or every
    /// governorate's, while none is chosen, so picking an area can choose it.
    var areas: [Area] {
        if let governorate { return reference.areas[governorate] ?? [] }
        return reference.governorates.flatMap { reference.areas[$0.id] ?? [] }
    }

    /// Choosing an area with no governorate chosen chooses its governorate too,
    /// since that is what prices delivery.
    func chooseArea(_ area: Area?) {
        if let area {
            typedArea = false
            parts.area = area.en
            if governorate == nil { governorate = reference.governorate(ofArea: area.en) }
        } else {
            typedArea = true
            parts.area = nil
        }
    }

    func chooseGovernorate(_ id: String) {
        guard id != governorate else { return }
        governorate = id
        if !typedArea, let area = parts.area, !areas.contains(where: { $0.en == area }) { parts.area = nil }
    }

    /// The first thing still missing, first reason first — said under the
    /// button, because a greyed button with no sentence beside it leaves
    /// somebody scrolling a form for what it wants.
    func blocker(for cart: Cart?) -> String? {
        guard let cart, !cart.isEmpty else { return "checkout.needItems" }
        if !cart.cod.available { return "checkout.needCod" }
        return Validation.deliveryProblem(governorate: governorate, parts: parts, phone: contactPhone, requiredParts: reference.requiredParts)
    }

    /// The reason cash on delivery is refused for this bag, in the shop's words.
    func codRefusal(for cart: Cart, language: LanguageSettings) -> String? {
        guard !cart.cod.available, let because = cart.cod.because else { return nil }
        if because.kind == "ceiling", let ceiling = because.ceiling, let amount = Money(amount: ceiling) {
            return language.t("checkout.codUnavailableCeiling", ["name": because.vendorName, "amount": amount.formatted(language.current)])
        }
        return language.t("checkout.codUnavailableSeller", ["name": because.vendorName])
    }

    /// Places the order. Nil when something is missing or the server refused;
    /// the reason is then on `refusal` or `blocker(for:)`.
    func place(cart: Cart?) async -> PlacedOrder? {
        attempted = true
        refusal = nil
        guard let cart, blocker(for: cart) == nil else { return nil }
        placing = true
        defer { placing = false }
        let cleaned = parts.cleaned()
        let name = contactName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let order = API.PlaceOrder(
            cartId: cart.id,
            paymentMethod: "cod",
            contactName: name.isEmpty ? nil : name,
            contactPhone: PhoneNumber.normalise(contactPhone),
            deliveryZoneId: governorate,
            addressNotes: trimmedNotes.isEmpty ? nil : trimmedNotes,
            addressParts: cleaned
        )
        do {
            let placed = try await orders.place(order)
            if let chosenAddress { defaults.set(chosenAddress, forKey: Self.lastAddressKey) }
            return placed
        } catch {
            refusal = APIError.from(error)
            return nil
        }
    }
}
