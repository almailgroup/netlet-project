import Foundation
import Observation

/// Checkout: who receives it, where it goes, and placing the order.
///
/// Payment is cash on delivery and nothing else, and every figure is the
/// server's: the app sends the bag and the address, and the server prices it,
/// takes the stock and freezes the order.
@Observable
@MainActor
final class CheckoutViewModel: AddressPartsEditing {
    private(set) var addresses: LoadState<[SavedAddress]> = .idle
    private(set) var chosenAddress: Int?

    var contactName = ""
    var contactPhone = ""
    var governorate: String?
    var parts = AddressParts()
    /// True when the shopper picked "Another area" and types it.
    var typedArea = false
    var notes = ""
    /// Where the door is on the map; optional, the typed address is not.
    var pin: Pin?
    /// Keep a new address in the book once the order has gone through.
    var saveForNext = true
    /// Spend the referral balance on this order.
    var usePoints = false
    /// The code box as typed, and the code last asked about.
    var codeInput = ""
    private(set) var appliedCode = ""
    private(set) var quote: API.VoucherQuote?
    /// Why the code does nothing — a message key — once asked.
    private(set) var codeRefusal: String?
    private(set) var quoting = false
    /// The referral balance, in points; zero hides the choice.
    private(set) var balance = 0

    /// Set once Place order has been pressed, so a problem is said only after
    /// it is asked about — the web's rule that nothing appears because a box lost focus.
    private(set) var attempted = false
    private(set) var placing = false
    private(set) var refusal: APIError?

    private let orders: OrderServicing
    private let account: AccountServicing
    private let api: APICalling?
    private let defaults: UserDefaults
    let reference: ReferenceData
    static let lastAddressKey = "netlet.lastAddressId"

    init(orders: OrderServicing, account: AccountServicing, api: APICalling? = nil, defaults: UserDefaults = .standard, reference: ReferenceData = .shared) {
        self.orders = orders
        self.account = account
        self.api = api
        self.defaults = defaults
        self.reference = reference
    }

    /// The saved addresses, with the one used last on this device chosen already.
    func load(user: User?) async {
        if contactName.isEmpty { contactName = user?.name ?? "" }
        guard user != nil else { return }
        if let api, let rewards = try? await api.call(API.rewards) { balance = rewards.balance }
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
        adopt(parts: address.parts, governorate: address.governorate)
        if let name = address.contactName, !name.isEmpty { contactName = name }
        if let phone = address.contactPhone, !phone.isEmpty { contactPhone = phone }
        notes = address.addressNotes ?? ""
        pin = address.pin
    }

    func startNewAddress() {
        chosenAddress = nil
        parts = AddressParts()
        typedArea = false
        notes = ""
        pin = nil
    }

    /// Asks what a code would do to this bag. Only a code naming nothing
    /// counts against the guesses' ceiling, and asking again about the same
    /// wrong code counts again — so it is asked on the press, never on its own.
    func applyCode(cartId: String) async {
        let code = codeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, let api else { return }
        quoting = true
        defer { quoting = false }
        appliedCode = code
        quote = nil
        codeRefusal = nil
        do {
            let answer = try await api.call(API.quoteVoucher, .init(cartId: cartId, code: code))
            quote = answer
            if !answer.ok { codeRefusal = answer.reason ?? "voucher.unknown" }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { codeRefusal = failure.messageKey(knownKey: Phrasebook.shared.has) }
        }
    }

    /// What this bag comes to with the code, the points and the card taken off.
    func bill(for cart: Cart) -> Till.Bill {
        Till.bill(for: cart, quote: quote, balance: balance, usePoints: usePoints)
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
        if because.kind == "shop" { return language.t("checkout.codUnavailableShop") }
        if because.kind == "ceiling", let ceiling = because.ceiling, let amount = Money(amount: ceiling) {
            return language.t("checkout.codUnavailableCeiling", ["name": because.vendorName, "amount": amount.formatted(language.current)])
        }
        return language.t("checkout.codUnavailableSeller", ["name": because.vendorName])
    }

    /// Places the order. Nil when something is missing or the server refused;
    /// the reason is then on `refusal` or `blocker(for:)`.
    func place(cart: Cart?, savedLabel: String = "") async -> PlacedOrder? {
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
            addressParts: cleaned,
            giftClaims: HeldClaims.all(defaults).map { API.GiftClaim(token: $0.token, productId: $0.productId) }.nilIfEmpty,
            pin: pin,
            usePoints: usePoints && balance > 0 ? true : nil,
            voucherCode: appliedCode.isEmpty ? nil : appliedCode
        )
        do {
            let placed = try await orders.place(order)
            if let chosenAddress { defaults.set(chosenAddress, forKey: Self.lastAddressKey) }
            await keepNewAddress(cleaned, name: name, notes: trimmedNotes, label: savedLabel)
            return placed
        } catch {
            refusal = APIError.from(error)
            return nil
        }
    }

    /// A first address goes in the book *after* the order succeeds, never
    /// instead of it, so a refusal from the book's own rules costs nothing.
    private func keepNewAddress(_ parts: AddressParts, name: String, notes: String, label: String) async {
        guard chosenAddress == nil, saveForNext, !parts.isEmpty, let api else { return }
        let input = API.AddressInput(
            label: label.isEmpty ? governorate ?? "" : label,
            contactName: name.isEmpty ? nil : name,
            contactPhone: PhoneNumber.normalise(contactPhone),
            governorate: governorate,
            addressNotes: notes.isEmpty ? nil : notes,
            pin: pin,
            parts: parts
        )
        if let saved = try? await api.call(API.addAddress, input) {
            defaults.set(saved.id, forKey: Self.lastAddressKey)
        }
    }
}
