import XCTest
@testable import NetLet

/// The browsing history read back by id: a read that failed is the read's,
/// never an empty history — the device still holds the ids, and the page
/// said "nothing here yet" over them.
@MainActor
final class BrowsingHistoryTests: XCTestCase {
    func testAFailedReadIsNotAnEmptyHistory() async {
        let result = await BrowsingHistoryView.readBack(["1", "2"]) { _ in throw APIError.offline }
        guard case .failure(let error) = result else { return XCTFail("A failed read came back as a history: \(result)") }
        XCTAssertEqual(error, .offline)
    }

    func testTheHistoryComesBackNewestFirstWithoutWhatTheShopNoLongerShows() async throws {
        let products = try await Fixtures.products()
        XCTAssertGreaterThanOrEqual(products.count, 2)
        let newest = products[1].id, older = products[0].id
        let result = await BrowsingHistoryView.readBack([newest, "gone", older]) { _ in products }
        guard case .success(let found) = result else { return XCTFail("A history that was read failed: \(result)") }
        XCTAssertEqual(found.map(\.id), [newest, older], "in the device's order, the one the shop no longer shows left out")
    }

    func testNothingViewedAsksNothing() async {
        var asked = false
        let result = await BrowsingHistoryView.readBack([]) { _ in asked = true; return [] }
        guard case .success(let found) = result else { return XCTFail("\(result)") }
        XCTAssertTrue(found.isEmpty)
        XCTAssertFalse(asked)
    }
}
