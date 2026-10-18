import Foundation

/// The shopper's orders, and placing one. Every order query is scoped to the
/// signed-in account by the server, so another shopper's reference is "not found".
protocol OrderServicing: Sendable {
    func orders(page: Int) async throws -> OrderPage
    func order(reference: String) async throws -> OrderDetail
    func place(_ order: API.PlaceOrder) async throws -> PlacedOrder
}

struct OrderService: OrderServicing {
    let client: TRPCClient

    func orders(page: Int) async throws -> OrderPage {
        try await client.call(API.orders, .init(page: page, pageSize: 20))
    }

    func order(reference: String) async throws -> OrderDetail {
        try await client.call(API.order, .init(reference: reference))
    }

    func place(_ order: API.PlaceOrder) async throws -> PlacedOrder {
        try await client.call(API.placeOrder, order)
    }
}
