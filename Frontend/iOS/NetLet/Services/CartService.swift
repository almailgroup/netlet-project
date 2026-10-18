import Foundation

/// The bag on the server. Its id is a random token, not a number, because it is
/// the only thing separating one shopper's bag from another's.
protocol CartServicing: Sendable {
    func create(variantId: String, quantity: Int) async throws -> Cart
    func get(_ cartId: String) async throws -> Cart?
    /// Nil when the server no longer has the bag.
    func add(_ cartId: String, variantId: String, quantity: Int) async throws -> Cart?
    func setQuantity(_ cartId: String, lineId: String, quantity: Int) async throws -> Cart?
}

struct CartService: CartServicing {
    let client: TRPCClient

    func create(variantId: String, quantity: Int) async throws -> Cart {
        try await client.call(API.createCart, .init(lines: [.init(variantId: variantId, quantity: quantity)]))
    }

    func get(_ cartId: String) async throws -> Cart? {
        try await client.call(API.cart, .init(cartId: cartId))
    }

    func add(_ cartId: String, variantId: String, quantity: Int) async throws -> Cart? {
        try await client.call(API.addToCart, .init(cartId: cartId, lines: [.init(variantId: variantId, quantity: quantity)]))
    }

    func setQuantity(_ cartId: String, lineId: String, quantity: Int) async throws -> Cart? {
        try await client.call(API.updateCart, .init(cartId: cartId, lines: [.init(lineId: lineId, quantity: quantity)]))
    }
}
