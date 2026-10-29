import Foundation
import Observation

/// Checkout confirms — the web's `Checkout`: where it goes, who the driver
/// rings, how it is paid, and placing the order.
///
/// **It confirms; it does not ask, on the owner's word** ("in the checkout
/// page you should only confirm your details — your location and your
/// preferred payment method — and then you can place order"). The address is
/// the saved one in use, chosen in the cart (`DeliveryModel.inUse`), and the
/// order is placed from its own parts, name and number; only a number the
/// driver can ring is ever typed here, and only when neither the address nor
/// the account has one. Payment is cash on delivery, and every figure is the
/// server's: the app sends the bag and the address, and the server prices it,
/// takes the stock and freezes the order.
@Observable
@MainActor
final class CheckoutViewModel {
    /// The number on "Your profile", for an address that carries none.
    private(set) var accountPhone = ""
    /// The number typed here, when neither the address nor the account has one.
    var typedPhone = ""
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

    /// The points to spend and the account's own number.
    func load(user: User?) async {
        guard user != nil else { return }
        if let api, let rewards = try? await api.call(API.rewards) { balance = rewards.balance }
        if let phone = try? await account.profileDetails().phone, !phone.isEmpty {
            accountPhone = PhoneNumber.display(phone)
        }
    }

    /// The address a book starts from when none is in the area in use — the
    /// one used last here, else the first (`addressToUse` on the web) — so an
    /// order always has the door the shopper picked most recently.
    nonisolated static func fallback(_ book: [SavedAddress], lastUsed: Int?) -> SavedAddress? {
        book.first { $0.id == lastUsed } ?? book.first
    }

    /// The driver's number: the address's, else the account's, else typed here.
    func phone(for address: SavedAddress?) -> String {
        address?.contactPhone?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? accountPhone.nilIfEmpty
            ?? typedPhone.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A saved address with no number, on an account with none: the driver
    /// has to be able to ring the door, so the box is drawn.
    func asksPhone(for address: SavedAddress?) -> Bool {
        guard let address else { return false }
        return (address.contactPhone ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && accountPhone.isEmpty
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

    /// Why Place order cannot be pressed yet, first reason first — said under
    /// the button, and a press on the sentence goes to the fix.
    func blocker(for cart: Cart?, address: SavedAddress?) -> String? {
        guard let cart, !cart.isEmpty else { return "checkout.needItems" }
        if !cart.cod.available { return "checkout.needCod" }
        guard let address else { return "checkout.needAddressChoice" }
        return Validation.savedAddressProblem(address, phone: phone(for: address), requiredParts: reference.requiredParts)
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

    /// Places the order to the saved address, from its own parts, name and
    /// number. Nil when something is missing or the server refused; the reason
    /// is then on `refusal` or `blocker(for:address:)`.
    func place(cart: Cart?, address: SavedAddress?, accountName: String? = nil) async -> PlacedOrder? {
        refusal = nil
        guard let cart, let address, blocker(for: cart, address: address) == nil else { return nil }
        placing = true
        defer { placing = false }
        let parts = (address.parts ?? AddressParts()).cleaned()
        let name = address.contactName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? accountName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let notes = (address.addressNotes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let order = API.PlaceOrder(
            cartId: cart.id,
            paymentMethod: "cod",
            contactName: name,
            contactPhone: PhoneNumber.normalise(phone(for: address)),
            deliveryZoneId: address.governorate,
            addressNotes: notes.nilIfEmpty,
            addressParts: parts.isEmpty ? nil : parts,
            // An address kept as a line before the parts existed is sent as its line.
            addressLine: parts.isEmpty ? address.line(.en).nilIfEmpty : nil,
            giftClaims: HeldClaims.all(defaults).map { API.GiftClaim(token: $0.token, productId: $0.productId) }.nilIfEmpty,
            pin: address.pin,
            usePoints: usePoints && balance > 0 ? true : nil,
            voucherCode: appliedCode.isEmpty ? nil : appliedCode
        )
        do {
            let placed = try await orders.place(order)
            defaults.set(address.id, forKey: Self.lastAddressKey)
            return placed
        } catch {
            refusal = APIError.from(error)
            return nil
        }
    }
}
