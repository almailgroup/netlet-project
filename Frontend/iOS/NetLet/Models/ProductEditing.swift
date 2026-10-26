import Foundation

/// A product as its editor reads it (`inventory.products.get`): everything a
/// shopper never sees beside everything they do.
struct EditableProduct: Decodable, Sendable {
    struct Image: Decodable, Hashable, Sendable {
        let url: String
        let altText: String?
        let kind: String
        let posterUrl: String?
    }

    struct Addon: Decodable, Hashable, Sendable {
        let kind: String
        let label: String
        let labelAr: String?
        let price: String
    }

    struct Variant: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let sku: String?
        let title: String
        let price: String
        let compareAtPrice: String?
        let stock: Int
        let preorderStock: Int?
        let preorderReleaseAt: Date?
        let centreId: Int?
        let memberPrice: String?
        let unit: String?
        let stepAmount: String?
        let options: [String: String]?

        var step: Double { stepAmount.flatMap(Double.init) ?? 1 }
    }

    let id: Int
    let vendorId: Int
    let categoryId: Int?
    let handle: String
    let title: String
    let titleAr: String?
    let description: String?
    let descriptionAr: String?
    let status: String
    let reviewNote: String?
    let tags: [String]
    let commissionPercent: String?
    let commissionFixed: String?
    /// The rate the store offers this product to affiliates at, nil when it does not (3.7.1).
    let affiliatePercent: String?
    let acceptsOffers: Bool?
    let deliverySpeed: String?
    let sizeClass: String?
    let attributes: [ProductAttribute]?
    let sizeChart: SizeChart?
    /// Why a was-price is withheld from shoppers: "missing" or "expired" permit.
    let offerHidden: String?
    let images: [Image]
    let addons: [Addon]?
    let variants: [Variant]
}

/// What moving a product to another store answers.
struct ProductMoved: Decodable, Sendable {
    struct Store: Decodable, Sendable {
        let name: String
    }

    let to: Store
    let bundlesWithdrawn: Int
}

/// A value the server takes as an explicit null — "inherit", "clear this" —
/// which an ordinary optional would leave out, and an absent key leaves alone.
struct OrNull<Value: Encodable & Sendable>: Encodable, Sendable {
    let value: Value?

    init(_ value: Value?) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var single = encoder.singleValueContainer()
        if let value { try single.encode(value) } else { try single.encodeNil() }
    }
}

extension OrNull where Value == String {
    /// A box's text, or null when it was emptied.
    static func text(_ text: String) -> OrNull<String> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return OrNull(trimmed.isEmpty ? nil : trimmed)
    }
}

extension API {
    struct ProductDetails: Encodable, Sendable {
        let id: Int
        let title: String
        let titleAr: OrNull<String>
        let description: OrNull<String>
        let descriptionAr: OrNull<String>
        let categoryId: OrNull<Int>
        let tags: [String]
    }

    struct ProductAttributes: Encodable, Sendable {
        let id: Int
        let attributes: [ProductAttribute]
    }

    struct ProductSizeClass: Encodable, Sendable {
        let productId: Int
        let sizeClass: OrNull<String>
    }

    struct ProductSpeed: Encodable, Sendable {
        let productId: Int
        let speed: OrNull<String>
    }

    struct ProductTakesAsks: Encodable, Sendable {
        let productId: Int
        let accepts: OrNull<Bool>
    }

    struct ProductStatus: Encodable, Sendable {
        let id: Int
        let status: String
    }

    struct GalleryItem: Encodable, Sendable {
        let url: String
        let altText: OrNull<String>
        let kind: String
        let posterUrl: OrNull<String>
    }

    struct ProductGallery: Encodable, Sendable {
        let id: Int
        let images: [GalleryItem]
    }

    struct AddonInput: Encodable, Sendable {
        let kind: String
        let label: String
        let labelAr: OrNull<String>
        let price: String
    }

    struct ProductAddons: Encodable, Sendable {
        let id: Int
        let addons: [AddonInput]
    }

    /// A variant written whole except its stock, which only moves by a delta
    /// with a reason. `preorderReleaseAt` is a `yyyy-mm-dd` day.
    struct VariantInput: Encodable, Sendable {
        var id: Int?
        let productId: Int
        let title: String
        var sku: OrNull<String>?
        let price: String
        var compareAtPrice: OrNull<String>?
        var unit: String?
        var stepAmount: Double?
        var preorderStock: Int?
        var preorderReleaseAt: OrNull<String>?
        var memberPrice: OrNull<String>?
        var options: [String: String]?
    }

    struct StockAdjust: Encodable, Sendable {
        let variantId: Int
        let delta: Int
        let reason: String
    }

    struct ProductStore: Encodable, Sendable {
        let id: Int
        let vendorId: Int
    }

    struct ProductCommission: Encodable, Sendable {
        let id: Int
        let percent: OrNull<String>
        let fixed: OrNull<String>
    }

    struct ChartInput: Encodable, Sendable {
        struct Row: Encodable, Sendable {
            let size: String
            let ranges: [String: [Double]]
        }

        let axis: String
        let measures: [String]
        let rows: [Row]
    }

    struct ProductChart: Encodable, Sendable {
        let productId: Int
        let chart: OrNull<ChartInput>
    }

    static let editableProduct = Procedure<RowId, EditableProduct?>(query: "inventory.products.get")
    static let saveProductDetails = Procedure<ProductDetails, Acknowledged>(mutation: "inventory.products.update")
    static let saveProductAttributes = Procedure<ProductAttributes, Acknowledged>(mutation: "inventory.products.setAttributes")
    static let saveSizeClass = Procedure<ProductSizeClass, Acknowledged>(mutation: "inventory.products.setSizeClass")
    static let saveDeliverySpeed = Procedure<ProductSpeed, Acknowledged>(mutation: "inventory.products.setDeliverySpeed")
    static let saveProductTakesAsks = Procedure<ProductTakesAsks, Acknowledged>(mutation: "offers.setProductOpen")
    static let saveProductStatus = Procedure<ProductStatus, String>(mutation: "inventory.products.setStatus")
    static let saveGallery = Procedure<ProductGallery, Acknowledged>(mutation: "inventory.products.setImages")
    static let saveAddons = Procedure<ProductAddons, Acknowledged>(mutation: "inventory.products.setAddons")
    static let saveVariant = Procedure<VariantInput, Acknowledged>(mutation: "inventory.variants.save")
    static let adjustVariantStock = Procedure<StockAdjust, Int>(mutation: "inventory.variants.adjustStock")
    static let moveProduct = Procedure<ProductStore, ProductMoved>(mutation: "inventory.products.move")
    static let saveProductCommission = Procedure<ProductCommission, Acknowledged>(mutation: "inventory.products.setCommission")
    static let saveSizeChart = Procedure<ProductChart, Acknowledged>(mutation: "inventory.products.setSizeChart")
}
