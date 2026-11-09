import Foundation

/// The shopper's orders, and placing one. Every order query is scoped to the
/// signed-in account by the server, so another shopper's reference is "not found"
/// — an answer of nothing, never an error.
protocol OrderServicing: Sendable {
    func orders(page: Int, filters: OrderFilters) async throws -> OrderPage
    func order(reference: String) async throws -> OrderDetail?
    func place(_ order: API.PlaceOrder) async throws -> PlacedOrder
}

extension OrderServicing {
    /// Every order, newest first: the first page of the list with nothing narrowed.
    func orders(page: Int) async throws -> OrderPage {
        try await orders(page: page, filters: OrderFilters())
    }
}

struct OrderService: OrderServicing {
    let client: TRPCClient

    func orders(page: Int, filters: OrderFilters) async throws -> OrderPage {
        let q = filters.q.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await client.call(API.orders, .init(
            page: page,
            pageSize: 20,
            view: filters.view == "all" ? nil : filters.view,
            q: q.isEmpty ? nil : q,
            period: filters.period == "all" ? nil : filters.period
        ))
    }

    func order(reference: String) async throws -> OrderDetail? {
        try await client.call(API.order, .init(reference: reference))
    }

    func place(_ order: API.PlaceOrder) async throws -> PlacedOrder {
        try await client.call(API.placeOrder, order)
    }
}
