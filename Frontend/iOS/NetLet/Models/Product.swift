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

/// A store on the home page's row and the stores index: `StoreCard` in
/// `Backend/src/services/catalog.ts`. Everything on it is measured — products
/// on sale, a rating only from five visible reviews, the badges it earned.
struct StoreCard: Decodable, Identifiable, Hashable, Sendable {
    struct Rating: Decodable, Hashable, Sendable {
        let average: Double
        let count: Int
    }

    let slug: String
    let name: String
    let logoUrl: String?
    let products: Int
    let rating: Rating?
    let badges: [String]

    var id: String { slug }
}

/// A brand the shop sells and how many of its products are live.
struct BrandCount: Decodable, Identifiable, Hashable, Sendable {
    let name: String
    let count: Int

    var id: String { name }
}

/// How to reach a person at NetLet and who the shop is (`support.channels`):
/// each channel a setting on the server, absent when it is not set.
struct ShopContact: Decodable, Hashable, Sendable {
    struct Visit: Decodable, Hashable, Sendable {
        let address: String
        let addressAr: String?
    }

    struct Social: Decodable, Hashable, Sendable {
        let platform: String
        let url: String
    }

    struct Company: Decodable, Hashable, Sendable {
        let name: String
        let nameAr: String?
        let licence: String?
        let address: String?
    }

    let whatsapp: String?
    let phone: String?
    let email: String?
    let visit: Visit?
    let social: [Social]
    let company: Company?

    /// The shop's own defaults (`NETLET_CONTACT`), until the server answers.
    static var fallback: ShopContact {
        let contact = ReferenceData.shared.rules.contact
        return ShopContact(
            whatsapp: nil,
            phone: contact.map { $0.phone.filter(\.isNumber) },
            email: contact?.email,
            visit: contact.map { Visit(address: $0.address, addressAr: $0.addressAr) },
            social: [],
            company: nil
        )
    }

    /// A number as the footer says it: "+965 5080 8606" for a Kuwaiti one.
    static func display(_ digits: String) -> String {
        guard digits.count == 11, digits.hasPrefix("965") else { return "+" + digits }
        let local = digits.dropFirst(3)
        return "+965 \(local.prefix(4)) \(local.suffix(4))"
    }
}

/// One store's public page (`commerce.store`): who it is, its live shelf and
/// its newest reviews. What the server selects is the privacy rule — no email,
/// phone, street address, licence or IBAN ever reaches it.
struct StorePage: Decodable, Sendable {
    struct Profile: Decodable, Sendable {
        struct Delivery: Decodable, Sendable {
            let flat: String?
            let freeOver: String?
            let speed: String?
            let cashOnDelivery: Bool
        }

        let slug: String
        let name: String
        let description: String?
        let logoUrl: String?
        let governorate: String?
        let since: String
        let products: Int
        let rating: StoreCard.Rating?
        let badges: [String]
        let delivery: Delivery
    }

    struct Review: Decodable, Identifiable, Sendable {
        let id: Int
        let rating: Int
        let title: String?
        let body: String?
        let author: String
        let createdAt: String
        let productTitle: String
    }

    let store: Profile
    let products: [Product]
    let reviews: [Review]
}
