import XCTest
@testable import NetLet

/// The next page of orders that could not be read is said at the list's foot,
/// never taken for the list's end: a shopper with thirty orders saw twenty and
/// took them for all.
@MainActor
final class OrdersMoreFailedTests: XCTestCase {
    /// The recorded first page, said to be one of more; the second page fails
    /// until `secondWorks` is set.
    private final class PagedOrders: OrderServicing, @unchecked Sendable {
        let real = OrderService(client: Fixtures.client)
        var secondWorks = false

        func orders(page: Int, filters: OrderFilters) async throws -> OrderPage {
            let first = try await real.orders(page: 1, filters: filters)
            if page == 1 { return OrderPage(rows: Array(first.rows.prefix(1)), total: 2, page: 1, pageSize: 1) }
            guard secondWorks else { throw APIError.offline }
            return OrderPage(rows: Array(first.rows.dropFirst().prefix(1)), total: 2, page: 2, pageSize: 1)
        }
        func order(reference: String) async throws -> OrderDetail? { nil }
        func place(_ order: API.PlaceOrder) async throws -> PlacedOrder { throw APIError.offline }
    }

    private func model(_ service: PagedOrders) -> OrdersViewModel {
        OrdersViewModel(service: service, returns: { [] }, reviews: { [] })
    }

    func testANextPageThatCouldNotBeReadIsNotTheEnd() async throws {
        let service = PagedOrders()
        let orders = model(service)
        await orders.load()
        let shown = try XCTUnwrap(orders.orders.value).count
        try XCTSkipIf(shown == 0, "The recording holds no orders to page through.")
        XCTAssertTrue(orders.canLoadMore)
        await orders.loadMore()
        XCTAssertTrue(orders.moreFailed)
        XCTAssertTrue(orders.canLoadMore, "A failed page must not end the list.")
        service.secondWorks = true
        await orders.retryMore()
        XCTAssertFalse(orders.moreFailed)
    }
}
