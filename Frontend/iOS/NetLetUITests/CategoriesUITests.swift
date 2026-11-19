import XCTest

/// The owner's word on the Categories tab: "when you tap on a category, it
/// should automatically scroll down showing the sub categories … when you tap
/// on any category." A press on a department brings its row of tiles up
/// under the pinned search row, so its subcategories unfold into the screen
/// rather than past the tab bar — for a department low on the screen and for
/// one in the first row alike.
final class CategoriesUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testPressingADepartmentLowOnTheScreenBringsItsSubcategoriesIntoView() {
        let app = launch()
        assertPressReveals("Baby", firstRow: "Diapers & wipes", movesAtLeast: 100, in: app)
    }

    func testPressingADepartmentInTheFirstRowScrollsToo() {
        let app = launch()
        assertPressReveals("Electronics", firstRow: "Mobile phones", movesAtLeast: 20, in: app)
    }

    func testPressingAnotherDepartmentBelowAnOpenOneBringsThatOneUp() {
        let app = launch()
        assertPressReveals("Electronics", firstRow: "Mobile phones", movesAtLeast: 20, in: app)
        // Electronics' list is open above the Baby tiles now; Baby is under it.
        let baby = onScreen(buttons("Baby", in: app), in: app, scrolling: true)
        assertPressReveals("Baby", firstRow: "Diapers & wipes", movesAtLeast: 0, in: app, tile: baby)
    }

    // MARK: Helpers

    /// Presses `name`'s tile and checks the page glided it up: it ends just
    /// under the search row, `movesAtLeast` points higher than it was, and
    /// its first subcategory row is on the screen above the tab bar.
    private func assertPressReveals(_ name: String, firstRow: String, movesAtLeast distance: CGFloat, in app: XCUIApplication, tile given: XCUIElement? = nil, file: StaticString = #filePath, line: UInt = #line) {
        guard let tile = given ?? onScreen(buttons(name, in: app), in: app, scrolling: false) else {
            return XCTFail("No \(name) tile on the screen.", file: file, line: line)
        }
        let before = tile.frame.minY
        tile.tap()
        let row = app.buttons[firstRow]
        XCTAssertTrue(row.waitForExistence(timeout: 6), "\(name) did not open its subcategories.", file: file, line: line)
        // The glide is under half a second; give it time to land.
        let landed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: row)
        _ = XCTWaiter().wait(for: [landed], timeout: 4)
        Thread.sleep(forTimeInterval: 0.8)

        let after = tile.frame.minY
        let searchFoot = searchRowFoot(in: app)
        let tabBarTop = app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY : app.windows.firstMatch.frame.maxY
        let note = "\(name): tile \(Int(before)) → \(Int(after)), search row's foot \(Int(searchFoot)), first row \(row.frame), tab bar at \(Int(tabBarTop))"
        print("TEST-NOTE categories \(note)")
        XCTAssertGreaterThanOrEqual(before - after, distance, "The page did not glide up to \(name). \(note)", file: file, line: line)
        XCTAssertGreaterThanOrEqual(after, searchFoot - 1, "\(name)'s tile went under the search row. \(note)", file: file, line: line)
        XCTAssertLessThanOrEqual(after, searchFoot + 40, "\(name)'s tile did not come up to the search row. \(note)", file: file, line: line)
        XCTAssertTrue(row.isHittable, "\(firstRow) is not where a finger can press it. \(note)", file: file, line: line)
        XCTAssertLessThan(row.frame.maxY, tabBarTop, "\(firstRow) is under the tab bar. \(note)", file: file, line: line)
    }

    /// Where the pinned search row ends. The element named by the field's
    /// words is the text inside it, shorter than the row, so its foot is not
    /// the row's: the row is 64 points (`SearchRow.height`) with the field in
    /// its middle, so its foot is half that under the words' middle. Taken
    /// from the words' foot plus the row's padding, the first run read 115
    /// where the row ends at 126.
    private func searchRowFoot(in app: XCUIApplication) -> CGFloat {
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Search categories and stores")).firstMatch
        return field.exists ? field.frame.midY + 64 / 2 : app.windows.firstMatch.frame.minY + 126
    }

    /// Every button whose name is `name` — a tile's words, the art being hidden.
    private func buttons(_ name: String, in app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "label == %@", name))
    }

    /// The first match of `query` a finger can press, swiping the page up a
    /// little at a time to reach it when `scrolling`.
    private func onScreen(_ query: XCUIElementQuery, in app: XCUIApplication, scrolling: Bool) -> XCUIElement? {
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: query)
        _ = XCTWaiter().wait(for: [shown], timeout: 12)
        for _ in 0..<6 {
            if let element = query.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) { return element }
            guard scrolling else { return nil }
            let window = app.windows.firstMatch
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
            Thread.sleep(forTimeInterval: 0.6)
        }
        return nil
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "categories"]
        app.launch()
        return app
    }
}
