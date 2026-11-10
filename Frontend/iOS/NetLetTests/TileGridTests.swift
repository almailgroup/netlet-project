import XCTest
@testable import NetLet

/// How many squares share a row (`TileGrid.perRow`): three on a phone for a
/// department's subcategories, the stores and the brands, and more on a wide
/// screen rather than squares wider than the ceiling.
final class TileGridTests: XCTestCase {
    func testAPhoneHasThreeToARow() {
        // Phones 390 and 320 wide, less the page's 16 at each side.
        XCTAssertEqual(TileGrid.perRow(width: 358, spacing: 12, columns: 3, widest: 150), 3)
        XCTAssertEqual(TileGrid.perRow(width: 288, spacing: 12, columns: 3, widest: 150), 3)
    }

    func testAWideScreenHasMoreRatherThanWiderSquares() {
        let across = TileGrid.perRow(width: 736, spacing: 12, columns: 3, widest: 150)
        XCTAssertEqual(across, 5)
        let square = (736 - 12 * CGFloat(across - 1)) / CGFloat(across)
        XCTAssertLessThanOrEqual(square, 150)
    }

    func testWithNoCeilingOrNoWidthItIsThePlainCount() {
        XCTAssertEqual(TileGrid.perRow(width: 736, spacing: 12, columns: 2, widest: nil), 2)
        XCTAssertEqual(TileGrid.perRow(width: .infinity, spacing: 12, columns: 3, widest: 150), 3)
        XCTAssertEqual(TileGrid.perRow(width: 358, spacing: 12, columns: 0, widest: nil), 1)
    }
}
