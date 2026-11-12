import Foundation

/// What a department on the Categories tab offers besides its subcategories —
/// `Shared/commerce/categoryGuide.ts`: how many of its products are on offer,
/// how many carry stars, which brands it sells, and the deals in each
/// subcategory, read off the department's own shelf (the products its page
/// draws), so "Deals · 3" is the three that page then shows.
///
/// A way in is offered only where it leads somewhere — the dead-control rule:
/// Deals only with a deal, New arrivals from two products, Highest rated from
/// two with stars, a brand only when a product carries it.
struct CategoryGuide: Equatable, Sendable {
    struct BrandFact: Equatable, Sendable {
        let name: String
        let count: Int
    }

    enum Way: String, CaseIterable, Sendable {
        case deals, newest, rating
    }

    /// The most brands a department's panel names (`TOP_BRANDS`).
    static let topBrands = 8
    /// "Highest rated" is offered from this many rated products (`MIN_RATED`).
    static let minRated = 2
    /// "New arrivals" is offered from this many products (`MIN_FOR_NEWEST`).
    static let minForNewest = 2

    let products: Int
    let deals: Int
    let rated: Int
    /// Its brands, the most products first, ties by name, at most `topBrands`.
    let brands: [BrandFact]
    /// Deals per subcategory, by its slug; one with none is absent.
    let subDeals: [String: Int]

    /// The facts of a department's own shelf — every product in it is the department's.
    init(shelf: [Product]) {
        var deals = 0
        var rated = 0
        var brands: [String: Int] = [:]
        var subDeals: [String: Int] = [:]
        for product in shelf {
            if product.isOnOffer {
                deals += 1
                if let sub = product.subcategory { subDeals[sub, default: 0] += 1 }
            }
            if product.rating != nil { rated += 1 }
            if let brand = product.brand { brands[brand, default: 0] += 1 }
        }
        self.products = shelf.count
        self.deals = deals
        self.rated = rated
        self.brands = brands
            .map { BrandFact(name: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.name.localizedCompare($1.name) == .orderedAscending }
            .prefix(Self.topBrands)
            .map { $0 }
        self.subDeals = subDeals
    }

    /// The ways into the department its panel offers, in the order drawn.
    var ways: [Way] {
        var ways: [Way] = []
        if deals > 0 { ways.append(.deals) }
        if products >= Self.minForNewest { ways.append(.newest) }
        if rated >= Self.minRated { ways.append(.rating) }
        return ways
    }
}
