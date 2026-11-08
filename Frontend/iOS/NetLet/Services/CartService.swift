import Foundation

/// The bag on the server. Its id is a random token, not a number, because it is
/// the only thing separating one shopper's bag from another's.
/// The bag on the server. Every read and write but the first takes `skip`, the
/// lines the shopper left out of this checkout (`CartChoice`): each answer's
/// totals, delivery and cash rule are then of the chosen lines alone.
protocol CartServicing: Sendable {
    func create(variantId: String, quantity: Int) async throws -> Cart
    func get(_ cartId: String, skip: [String]) async throws -> Cart?
    /// Nil when the server no longer has the bag.
    func add(_ cartId: String, variantId: String, quantity: Int, skip: [String]) async throws -> Cart?
    func setQuantity(_ cartId: String, lineId: String, quantity: Int, skip: [String]) async throws -> Cart?
    /// Lines with their extras or their set: into the bag, or a new bag with them.
    func addLines(_ cartId: String?, lines: [API.CartLine], skip: [String]) async throws -> Cart?
    /// Sends one line to a saved address, or back where the order goes with nil.
    func setDestination(_ cartId: String, lineId: String, addressId: Int?, skip: [String]) async throws -> Cart?
    /// Fast or regular for one line (3.2.5); the delivery quote moves with it.
    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String, skip: [String]) async throws -> Cart?
    /// A product's own discount code on one line (0074), or nil to take it off.
    func setLineCode(_ cartId: String, lineId: String, code: String?, skip: [String]) async throws -> API.LineCodeAnswer
}

extension CartServicing {
    /// A stand-in with no address book keeps the bag as it is.
    func setDestination(_ cartId: String, lineId: String, addressId: Int?, skip: [String]) async throws -> Cart? {
        try await get(cartId, skip: skip)
    }

    /// A stand-in with no codes recognises none, and taking one off keeps the bag.
    func setLineCode(_ cartId: String, lineId: String, code: String?, skip: [String]) async throws -> API.LineCodeAnswer {
        if code == nil { return API.LineCodeAnswer(ok: true, cart: try await get(cartId, skip: skip), reason: nil) }
        return API.LineCodeAnswer(ok: false, cart: nil, reason: "voucher.unknown")
    }

    /// A stand-in with no delivery choices keeps the bag as it is.
    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String, skip: [String]) async throws -> Cart? {
        try await get(cartId, skip: skip)
    }

    /// A stand-in that knows only plain lines adds them one at a time.
    func addLines(_ cartId: String?, lines: [API.CartLine], skip: [String]) async throws -> Cart? {
        var current: Cart?
        var id = cartId
        for line in lines {
            if let id {
                current = try await add(id, variantId: line.variantId, quantity: line.quantity, skip: skip)
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

    func get(_ cartId: String, skip: [String]) async throws -> Cart? {
        try await client.call(API.cart, .init(cartId: cartId, skip: skip.nilIfEmpty))
    }

    func add(_ cartId: String, variantId: String, quantity: Int, skip: [String]) async throws -> Cart? {
        try await client.call(API.addToCart, .init(cartId: cartId, lines: [.init(variantId: variantId, quantity: quantity)], skip: skip.nilIfEmpty))
    }

    func setQuantity(_ cartId: String, lineId: String, quantity: Int, skip: [String]) async throws -> Cart? {
        try await client.call(API.updateCart, .init(cartId: cartId, lines: [.init(lineId: lineId, quantity: quantity)], skip: skip.nilIfEmpty))
    }

    func addLines(_ cartId: String?, lines: [API.CartLine], skip: [String]) async throws -> Cart? {
        if let cartId { return try await client.call(API.addToCart, .init(cartId: cartId, lines: lines, skip: skip.nilIfEmpty)) }
        return try await client.call(API.createCart, .init(lines: lines))
    }

    func setDestination(_ cartId: String, lineId: String, addressId: Int?, skip: [String]) async throws -> Cart? {
        try await client.call(API.setLineDestination, .init(cartId: cartId, lineId: lineId, addressId: addressId, skip: skip.nilIfEmpty))
    }

    func setDeliveryChoice(_ cartId: String, lineId: String, choice: String, skip: [String]) async throws -> Cart? {
        try await client.call(API.setLineDeliveryChoice, .init(cartId: cartId, lineId: lineId, choice: choice, skip: skip.nilIfEmpty))
    }

    func setLineCode(_ cartId: String, lineId: String, code: String?, skip: [String]) async throws -> API.LineCodeAnswer {
        guard let code else {
            let cart = try await client.call(API.clearLineCode, .init(cartId: cartId, lineId: lineId, skip: skip.nilIfEmpty))
            return API.LineCodeAnswer(ok: true, cart: cart, reason: nil)
        }
        return try await client.call(API.setLineCode, .init(cartId: cartId, lineId: lineId, code: code, skip: skip.nilIfEmpty))
    }
}

