import XCTest
@testable import NetLet

/// My orders' chips — `OrderFilterRules` on the cases of `orderFilters.test.ts`,
/// and the list's answer carrying its choices.
final class OrderFilterRulesTests: XCTestCase {
    func testACalendarDayIsOneTheCalendarHas() {
        XCTAssertTrue(OrderFilterRules.isCalendarDay("2026-02-28"))
        XCTAssertTrue(OrderFilterRules.isCalendarDay("2024-02-29"))
        XCTAssertFalse(OrderFilterRules.isCalendarDay("2026-02-30"))
        XCTAssertFalse(OrderFilterRules.isCalendarDay("2026-2-3"))
        XCTAssertFalse(OrderFilterRules.isCalendarDay(nil))
    }

    func testAYearIsItsFirstAndLastDay() {
        XCTAssertEqual(OrderFilterRules.yearRange(2025).from, "2025-01-01")
        XCTAssertEqual(OrderFilterRules.yearRange(2025).to, "2025-12-31")
        XCTAssertEqual(OrderFilterRules.yearOfRange(from: "2025-01-01", to: "2025-12-31"), 2025)
        XCTAssertNil(OrderFilterRules.yearOfRange(from: "2025-01-02", to: "2025-12-31"))
        XCTAssertNil(OrderFilterRules.yearOfRange(from: "2025-01-01", to: "2026-12-31"))
    }

    func testThisMonthAndLastMonth() {
        let november = OrderFilterRules.monthRanges(today: "2026-11-22")
        XCTAssertEqual(november.thisMonth.from, "2026-11-01")
        XCTAssertEqual(november.thisMonth.to, "2026-11-30")
        XCTAssertEqual(november.lastMonth.from, "2026-10-01")
        XCTAssertEqual(november.lastMonth.to, "2026-10-31")
        let january = OrderFilterRules.monthRanges(today: "2024-01-05")
        XCTAssertEqual(january.lastMonth.from, "2023-12-01")
        XCTAssertEqual(january.lastMonth.to, "2023-12-31")
        XCTAssertEqual(OrderFilterRules.monthRanges(today: "2024-03-09").lastMonth.to, "2024-02-29")
    }

    func testTheChipsThatNarrowAreCountedTheDateOnceAndTheOrderNever() {
        XCTAssertEqual(OrderFilterRules.narrowingCount(OrderFilters()), 0)
        var dated = OrderFilters()
        dated.period = "30"
        dated.from = "2026-01-01"
        XCTAssertEqual(OrderFilterRules.narrowingCount(dated), 1)
        var many = OrderFilters()
        many.from = "2026-01-01"
        many.store = 2
        many.payment = "online"
        many.total = "under10"
        many.sort = "oldest"
        XCTAssertEqual(OrderFilterRules.narrowingCount(many), 4)
        var sorted = OrderFilters()
        sorted.sort = "highest"
        XCTAssertEqual(OrderFilterRules.narrowingCount(sorted), 0)
        // A status is a filter now, on the filter page (`narrowingCount` in TypeScript).
        var status = OrderFilters()
        status.view = "delivered"
        XCTAssertEqual(OrderFilterRules.narrowingCount(status), 1)
    }

    /// The filter page's choices are the server's: the owner's statuses, the
    /// last 30 days and 3 months, and the two lists.
    @MainActor
    func testTheFilterPagesChoicesAreTheServers() {
        let orders = ReferenceData.shared.rules.orders
        XCTAssertEqual(orders?.filterStatuses, ["received", "preparing", "onTheWay", "delivered", "cancelled"])
        XCTAssertEqual(orders?.filterDates, ["30", "90"])
        XCTAssertEqual(orders?.filterLists, ["returns"], "Returns and refunds beside the statuses; Reviews left the page")
    }

    /// The recorded list carries its choices, as the server answers them.
    func testTheListCarriesItsChoices() async throws {
        let page = try await Fixtures.client.call(API.orders, .init(page: 1, pageSize: 20))
        let facets = try XCTUnwrap(page.facets)
        XCTAssertEqual(facets.years, [2026])
        XCTAssertEqual(facets.stores.first?.name, "Acme Electronics")
        XCTAssertEqual(facets.firstDay, "2026-10-01")
    }

    /// The exported choices are the server's.
    @MainActor
    func testTheExportedChoicesAreTheServers() {
        let orders = ReferenceData.shared.rules.orders
        XCTAssertEqual(orders?.filterSorts, ["newest", "oldest", "highest", "lowest"])
        XCTAssertEqual(orders?.filterPayments, ["all", "cod", "online"])
        XCTAssertEqual(orders?.filterTotals, ["all", "under10", "10to50", "50to100", "over100"])
        XCTAssertEqual(orders?.totalBands?["10to50"]?.min, 10)
        XCTAssertEqual(orders?.totalBands?["under10"]?.min, nil)
    }
}
