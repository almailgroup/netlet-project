import Foundation

/// A catalogue category, which is what a department is on the seller's side
/// (`inventory.categories`).
struct Category: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let slug: String?
    let name: String
    let nameAr: String?

    func displayName(_ language: Language) -> String {
        if language == .ar, let nameAr, !nameAr.isEmpty { return nameAr }
        return name
    }
}

/// One page of a store's own products (`inventory.products.list`).
struct SellerProductPage: Decodable, Sendable {
    let rows: [SellerProduct]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// A store's product as its seller sees it: the status a shopper never does,
/// and each variant's price and stock.
struct SellerProduct: Decodable, Identifiable, Hashable, Sendable {
    struct Variant: Decodable, Hashable, Sendable {
        let id: Int
        let price: Money
        let stock: Int
    }

    let id: Int
    let handle: String
    let title: String
    let titleAr: String?
    let status: String
    let reviewNote: String?
    let variants: [Variant]

    func displayTitle(_ language: Language) -> String {
        if language == .ar, let titleAr, !titleAr.isEmpty { return titleAr }
        return title
    }

    var stock: Int { variants.reduce(0) { $0 + $1.stock } }
    var price: Money? { variants.first?.price }

    /// The status's name in the shop's words.
    var statusKey: String {
        switch status {
        case "published": return "status.published"
        case "pending_review": return "status.pending_review"
        case "archived": return "status.archived"
        default: return "status.draft"
        }
    }
}

/// What creating a listing answers: the new product's row.
struct CreatedListing: Decodable, Sendable {
    let id: Int
    let handle: String
    let status: String
}

/// A photo uploaded to `/api/media`: the path it is served at, and its size.
struct UploadedPhoto: Decodable, Hashable, Sendable {
    let url: String
    let width: Int
    let height: Int
}
