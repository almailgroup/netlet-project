import Foundation

/// The bag, as the server prices it (`Cart` in `Shared/commerce/types.ts`).
///
/// A bag stores no prices: it is a list of intentions, and every figure here
/// is what the server computed when it was read — which is why the app never
/// adds up a total itself.
struct Cart: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    /// The lines, the count and the money are `var` for one reason: a press
    /// draws the bag it will be before the server answers (`BagOps`).
    var items: [CartItem]
    var itemCount: Int
    var subtotal: Money
    let delivery: CartDelivery
    let cod: CashOnDelivery
    var total: Money
    /// The signed-in shopper's address book, for sending a line elsewhere.
    var addresses: [CartAddress]? = nil
    /// A bag left alone long enough to be reminded of (`recovery`).
    var recovery: CartRecovery? = nil

    var isEmpty: Bool { items.isEmpty }

    /// The plain line for a variant — no extras, no bundle — which is the one a
    /// card or a product page adds to and the one its count describes.
    func plainLine(for variantId: String) -> CartItem? {
        items.first { $0.variantId == variantId && ($0.addons ?? []).isEmpty && $0.bundleName == nil }
    }
}

struct CartItem: Decodable, Identifiable, Hashable, Sendable {
    let lineId: String
    let variantId: String
    let productHandle: String
    let productTitle: String
    let productTitleAr: String?
    let variantTitle: String
    let image: ProductImage?
    let unitPrice: Money
    var quantity: Int
    /// How the line is sold: in ones, or by a step of grams or millilitres.
    var measure: Measure? = nil
    var lineTotal: Money
    let bundleName: String?
    let addons: [CartAddon]?
    /// The saved address this line goes to, when not where the order goes.
    var destination: CartAddress? = nil
    /// Regular unless the shopper chose fast (3.2.5); nil rides regular.
    var deliveryChoice: String? = nil
    /// What fast costs from this line's store, when the store offers it at all.
    var fastDelivery: FastDelivery? = nil
    /// The store selling it, so the bag draws each store's lines together.
    var vendor: CartStore? = nil

    struct FastDelivery: Decodable, Hashable, Sendable {
        let fee: Money
        let speed: String?
    }

    var id: String { lineId }
    var isFast: Bool { deliveryChoice == "fast" }

    /// The title in the page's language, from the two the bag carries.
    func title(_ language: Language) -> String {
        if language == .ar, let arabic = productTitleAr, !arabic.isEmpty { return arabic }
        return productTitle
    }

    /// "Default" is the variant a single-variant product is given, and says nothing.
    var variantLabel: String? {
        variantTitle == "Default" || variantTitle.isEmpty ? nil : variantTitle
    }
}

/// The store a line comes from (`CartItem.vendor` on the web): its name in
/// both languages and its address, for its page.
struct CartStore: Decodable, Hashable, Sendable {
    let id: Int?
    let name: String
    let nameAr: String?
    let slug: String

    func name(_ language: Language) -> String {
        if language == .ar, let arabic = nameAr, !arabic.isEmpty { return arabic }
        return name
    }
}

/// One store's part of the bag: its lines, and the parcels the server priced
/// for it — the web's `bagGroups`.
struct BagGroup: Identifiable, Hashable, Sendable {
    let store: CartStore
    let items: [CartItem]
    let delivery: [CartDeliveryLine]

    var id: String { store.slug }

    /// Each store's lines together, in the order the first of them was added,
    /// with its parcels regular first; nil when any line names no store, and
    /// the bag is then drawn as one list (`bagGroups` in `lib/bagGroups.ts`).
    static func groups(_ cart: Cart) -> [BagGroup]? {
        guard !cart.items.isEmpty, cart.items.allSatisfy({ $0.vendor != nil }) else { return nil }
        var order: [String] = []
        var stores: [String: CartStore] = [:]
        var lines: [String: [CartItem]] = [:]
        for item in cart.items {
            guard let store = item.vendor else { continue }
            if stores[store.slug] == nil { order.append(store.slug); stores[store.slug] = store }
            if stores[store.slug]?.id == nil, store.id != nil { stores[store.slug] = store }
            lines[store.slug, default: []].append(item)
        }
        return order.compactMap { slug in
            guard let store = stores[slug] else { return nil }
            let parcels = cart.delivery.perVendor.filter { $0.vendorId != nil && $0.vendorId == store.id }
            // Regular first, each kept in the server's order — Swift's sort is not stable.
            let ordered = parcels.filter { $0.choice != "fast" } + parcels.filter { $0.choice == "fast" }
            return BagGroup(store: store, items: lines[slug] ?? [], delivery: ordered)
        }
    }

    /// How far a parcel is toward free delivery, 0 to 1, from the server's own
    /// figures; nil with no threshold left (`freeDeliveryProgress`).
    static func freeProgress(_ line: CartDeliveryLine) -> Double? {
        guard let toFree = line.toFree, !toFree.isZero, let goods = line.goods else { return nil }
        let threshold = goods.fils + toFree.fils
        guard threshold > 0 else { return nil }
        return min(1, max(0, Double(goods.fils) / Double(threshold)))
    }
}

/// The basket somebody forgot (3.1.17): a count and an age, never a total,
/// since the bag is priced again on every read.
struct CartRecovery: Decodable, Hashable, Sendable {
    let remind: Bool
    var itemCount: Int? = nil
    var hours: Int? = nil
}

struct CartAddon: Decodable, Hashable, Sendable {
    let id: String
    let label: String
}

struct CartDelivery: Decodable, Hashable, Sendable {
    let perVendor: [CartDeliveryLine]
    let total: Money
    /// Delivery NetLet carries for a member, said rather than hidden.
    var memberWaived: Money? = nil
    /// Whether a member's free delivery covers every trip, fast included (4.1).
    var memberFree: Bool? = nil
}

/// A saved address as the bag names it: enough to choose one by.
struct CartAddress: Decodable, Hashable, Identifiable, Sendable {
    let id: Int
    let label: String
}

/// One seller's delivery: each seller charges their own, and the shopper pays each.
struct CartDeliveryLine: Decodable, Hashable, Sendable {
    let vendorId: Int?
    let vendorName: String
    let vendorNameAr: String?
    let fee: Money
    let free: Bool
    let toFree: Money?
    /// What is in the parcel, which is what its free-delivery threshold measures.
    var goods: Money? = nil
    /// The door this delivery goes to, when a line was sent elsewhere.
    var destinationLabel: String? = nil
    /// "fast" on a fast parcel (3.2.5), which is charged its own fee.
    var choice: String? = nil

    func storeName(_ language: Language) -> String {
        if language == .ar, let arabic = vendorNameAr, !arabic.isEmpty { return arabic }
        return vendorName
    }

    /// The row's words: whose delivery, to which door, and "fast" when it is.
    @MainActor
    func label(_ l: LanguageSettings) -> String {
        let name = storeName(l.current)
        let base = destinationLabel.map { l.t("address.deliveryTo", ["name": name, "label": $0]) } ?? l.t("cart.deliveryFrom", ["name": name])
        return choice == "fast" ? "\(base) · \(l.t("delivery.fastTag"))" : base
    }
}

/// Whether this bag can be paid in cash at the door, and if not, which store
/// is why — a store may not take cash, or may cap what it collects.
struct CashOnDelivery: Decodable, Hashable, Sendable {
    struct Refusal: Decodable, Hashable, Sendable {
        let kind: String
        let vendorName: String
        let ceiling: String?
    }

    let available: Bool
    let because: Refusal?
}
