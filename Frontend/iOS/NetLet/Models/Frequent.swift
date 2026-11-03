import Foundation

/// The shopper's Frequently bought list as the server answers it
/// (`frequent.list`, migration 0073) — `ready` is false before the owner has
/// pasted the migration, and the screen then says so rather than drawing an
/// empty list as if it were one.
struct FrequentList: Decodable, Hashable, Sendable {
    let ready: Bool
    let items: [FrequentEntry]
}

/// One item: the product and the option the shopper buys, the amount they
/// usually take, and today's product — nil once it has left the shop.
struct FrequentEntry: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let productId: String
    let variantId: String
    let quantity: Int
    let product: Product?
}

/// What of one product is on the list — the product page's button.
struct FrequentForProduct: Decodable, Hashable, Sendable {
    struct Entry: Decodable, Hashable, Sendable {
        let id: Int
        let variantId: String
        let quantity: Int
    }

    let ready: Bool
    let entries: [Entry]
}

/// Something the shopper has bought before and not put on the list.
struct FrequentSuggestion: Decodable, Identifiable, Hashable, Sendable {
    let productId: String
    let variantId: String
    /// In how many separate orders it was bought.
    let timesBought: Int
    /// What they took the last time, offered as the usual amount.
    let lastQuantity: Int
    let product: Product

    var id: String { "\(productId):\(variantId)" }
}

/// `Shared/commerce/frequentItems.ts` in Swift, rule for rule — tested on the
/// TypeScript's own cases.
enum FrequentRules {
    enum State: Equatable { case ready, soldOut, gone }

    /// The usual amount: a whole number from one to the bag's line ceiling.
    static func quantity(_ value: Int) -> Int {
        max(1, min(ReferenceData.shared.rules.maxLineQuantity, value))
    }

    /// Gone when the product has left the shop or the option no longer exists;
    /// sold out when there is none; ready otherwise.
    static func state(_ product: Product?, variantId: String) -> State {
        guard let product, let variant = product.variants.first(where: { $0.id == variantId }) else { return .gone }
        return variant.availableForSale ? .ready : .soldOut
    }

    /// How many one press puts in the bag: the usual amount, held to what there
    /// is less what the bag already holds of that option. Zero when there is no room.
    static func addable(usual: Int, maxQuantity: Int, inBag: Int) -> Int {
        let room = min(ReferenceData.shared.rules.maxLineQuantity, maxQuantity) - inBag
        return max(0, min(quantity(usual), room))
    }
}
