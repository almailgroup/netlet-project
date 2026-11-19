import XCTest
import SwiftUI
@testable import NetLet

/// Where a pressed department's row comes to rest on the Categories tab
/// (`DepartmentBrowser.revealAnchor`): just under the pinned search row,
/// whatever the phone's height. `CategoriesUITests` is the proof on the
/// screen; this is the arithmetic under it.
@MainActor
final class DepartmentBrowserTests: XCTestCase {
    func testTheRowRestsJustUnderTheSearchRow() {
        XCTAssertEqual(DepartmentBrowser.clearance, SearchRow.height + 12)
        XCTAssertEqual(SearchRow.height, 64)
    }

    func testTheAnchorIsTheClearanceAsAFractionOfWhatThePageShows() {
        // An iPhone 16 Pro's page between the status bar and the tab bar, and an SE's.
        for viewport: CGFloat in [729, 554] {
            let anchor = DepartmentBrowser.revealAnchor(viewport: viewport)
            XCTAssertEqual(anchor.y * viewport, DepartmentBrowser.clearance, accuracy: 0.001)
        }
    }

    func testWithNoHeightToGoByItIsTheTop() {
        XCTAssertEqual(DepartmentBrowser.revealAnchor(viewport: 0), .top)
        XCTAssertEqual(DepartmentBrowser.revealAnchor(viewport: 40), .top)
    }
}
