import Foundation

/// The bag, as the server prices it (`Cart` in `Shared/commerce/types.ts`).
///
/// A bag stores no prices: it is a list of intentions, and every figure here
/// is what the server computed when it was read — which is why the app never
/// adds up a total itself.
struct Cart: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let items: [CartItem]
    let itemCount: Int
    let subtotal: Money
    let delivery: CartDelivery
    let cod: CashOnDelivery
    let total: Money
    /// The signed-in shopper's address book, for sending a line elsewhere.
    var addresses: [CartAddress]? = nil

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
    let quantity: Int
    /// How the line is sold: in ones, or by a step of grams or millilitres.
    var measure: Measure? = nil
    let lineTotal: Money
    let bundleName: String?
    let addons: [CartAddon]?
    /// The saved address this line goes to, when not where the order goes.
    var destination: CartAddress? = nil

    var id: String { lineId }

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

struct CartAddon: Decodable, Hashable, Sendable {
    let id: String
    let label: String
}

struct CartDelivery: Decodable, Hashable, Sendable {
    let perVendor: [CartDeliveryLine]
    let total: Money
    /// Delivery NetLet carries for a member, said rather than hidden.
    var memberWaived: Money? = nil
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
    /// The door this delivery goes to, when a line was sent elsewhere.
    var destinationLabel: String? = nil

    func storeName(_ language: Language) -> String {
        if language == .ar, let arabic = vendorNameAr, !arabic.isEmpty { return arabic }
        return vendorName
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
