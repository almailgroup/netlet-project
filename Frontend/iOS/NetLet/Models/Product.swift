import Foundation

/// A product as the shop shows it — `Product` in `Shared/commerce/types.ts`,
/// the only commerce contract the clients know. Only the fields the app reads
/// are declared; anything else the server sends is ignored, so a field added
/// there never breaks a decode here.
struct Product: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let handle: String
    let title: String
    let description: String
    let productType: String?
    let vendor: String?
    let vendorSlug: String?
    let vendorBadges: [String]
    let tags: [String]
    let attributes: [ProductAttribute]
    let images: [ProductImage]
    let priceRange: PriceRange
    let options: [ProductOption]
    let variants: [ProductVariant]
    let deliverySpeed: String?
    let deliveryProvider: String?

    /// The first variant that can be bought, or the first at all: what a card
    /// adds and what the price on a card describes.
    var leadVariant: ProductVariant? {
        variants.first(where: \.availableForSale) ?? variants.first
    }

    var isAvailable: Bool { variants.contains(where: \.availableForSale) }

    /// A product with more than one variant asks which before anything is added
    /// — a size has to be chosen before a number means anything.
    var needsChoice: Bool { variants.count > 1 }

    /// The specification rows a shopper reads: the `spec` namespace, as the web
    /// draws them, with any row left blank dropped.
    var specifications: [ProductAttribute] {
        attributes.filter { $0.namespace == "spec" && !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
    }
}

struct ProductImage: Codable, Hashable, Sendable {
    let url: String
    let altText: String?
}

struct PriceRange: Decodable, Hashable, Sendable {
    let min: Money
    let max: Money
}

struct ProductOption: Decodable, Hashable, Sendable {
    let name: String
    let values: [String]
}

struct SelectedOption: Decodable, Hashable, Sendable {
    let name: String
    let value: String
}

struct ProductAttribute: Decodable, Hashable, Sendable {
    let namespace: String
    let key: String
    let label: String
    let value: String
}

struct Measure: Decodable, Hashable, Sendable {
    let unit: String
    let stepAmount: Double
}

struct ProductVariant: Decodable, Identifiable, Hashable, Sendable {
    struct Preorder: Decodable, Hashable, Sendable {
        let releaseAt: String?
    }

    let id: String
    let title: String
    let sku: String?
    let price: Money
    let compareAtPrice: Money?
    let memberPrice: Money?
    let availableForSale: Bool
    let preorder: Preorder?
    let maxQuantity: Int
    let selectedOptions: [SelectedOption]

    /// A saving the shop may advertise. The server has already dropped a
    /// was-price whose store's discount permit lapsed, so its presence is the
    /// whole rule.
    var saving: Money? {
        guard let was = compareAtPrice, was > price else { return nil }
        return was - price
    }

    var savingPercent: Int? {
        guard let was = compareAtPrice, was > price, was.fils > 0 else { return nil }
        return Int((Double(was.fils - price.fils) / Double(was.fils) * 100).rounded())
    }

    func value(of option: String) -> String? {
        selectedOptions.first(where: { $0.name == option })?.value
    }
}

/// What `search.products` answers: the products, how many there were, and the
/// spelling it searched for instead when nothing matched what was typed.
struct SearchResult: Decodable, Sendable {
    let products: [Product]
    let total: Int
    let correctedTo: String?
}
