import Foundation

/// The bag on the server. Its id is a random token, not a number, because it is
/// the only thing separating one shopper's bag from another's.
protocol CartServicing: Sendable {
    func create(variantId: String, quantity: Int) async throws -> Cart
    func get(_ cartId: String) async throws -> Cart?
    /// Nil when the server no longer has the bag.
    func add(_ cartId: String, variantId: String, quantity: Int) async throws -> Cart?
    func setQuantity(_ cartId: String, lineId: String, quantity: Int) async throws -> Cart?
    /// Lines with their extras or their set: into the bag, or a new bag with them.
    func addLines(_ cartId: String?, lines: [API.CartLine]) async throws -> Cart?
    /// Sends one line to a saved address, or back where the order goes with nil.
    func setDestination(_ cartId: String, lineId: String, addressId: Int?) async throws -> Cart?
    /// Fast or regular for one line (3.2.5); the delivery quote moves with it.
    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String) async throws -> Cart?
}

extension CartServicing {
    /// A stand-in with no address book keeps the bag as it is.
    func setDestination(_ cartId: String, lineId: String, addressId: Int?) async throws -> Cart? {
        try await get(cartId)
    }

    /// A stand-in with no delivery choices keeps the bag as it is.
    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String) async throws -> Cart? {
        try await get(cartId)
    }

    /// A stand-in that knows only plain lines adds them one at a time.
    func addLines(_ cartId: String?, lines: [API.CartLine]) async throws -> Cart? {
        var current: Cart?
        var id = cartId
        for line in lines {
            if let id {
                current = try await add(id, variantId: line.variantId, quantity: line.quantity)
            } else {
                current = try await create(variantId: line.variantId, quantity: line.quantity)
            }
            id = current?.id
        }
        return current
    }
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

    func addLines(_ cartId: String?, lines: [API.CartLine]) async throws -> Cart? {
        if let cartId { return try await client.call(API.addToCart, .init(cartId: cartId, lines: lines)) }
        return try await client.call(API.createCart, .init(lines: lines))
    }

    func setDestination(_ cartId: String, lineId: String, addressId: Int?) async throws -> Cart? {
        try await client.call(API.setLineDestination, .init(cartId: cartId, lineId: lineId, addressId: addressId))
    }

    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String) async throws -> Cart? {
        try await client.call(API.setLineDeliveryChoice, .init(cartId: cartId, lineId: lineId, choice: choice))
    }
}
