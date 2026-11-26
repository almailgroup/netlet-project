import XCTest
@testable import NetLet

/// A gift list's products that could not be read are said as such: the
/// giver's page called every present "no longer available".
@MainActor
final class GiftProductsTests: XCTestCase {
    func testAFailedReadIsNotProductsThatAreGone() async {
        let outcome = await GiftProducts.read(["11", "12"], api: OfflineAPI(), language: .en)
        guard case .failed = outcome else {
            return XCTFail("A read that failed must not settle the presents as gone; it was \(outcome).")
        }
    }

    func testTheRecordedProductsAreRead() async throws {
        let products = try await Fixtures.products()
        let ids = products.prefix(2).map(\.id)
        let outcome = await GiftProducts.read(ids, api: Fixtures.client, language: .en)
        guard case .read(let found) = outcome else { return XCTFail("The recorded products were not read.") }
        XCTAssertFalse(found.isEmpty)
    }

    func testNoPresentsIsNothingToRead() async {
        guard case .read(let found) = await GiftProducts.read([], api: OfflineAPI(), language: .en) else {
            return XCTFail("An empty list asks nothing.")
        }
        XCTAssertTrue(found.isEmpty)
    }
}
