import XCTest

/// My orders' filters, organised on the owner's word: Filters opens one
/// sheet where a year is chosen and applied by Show orders, and then stands as
/// a chip of its own with a cross; Sort says the order the list is in; Clear
/// all puts both back. The demo answers every filter with the same recorded
/// list, so this proves the bar and its sheets, not the server's filtering,
/// which `orders.test.ts` proves against a real Postgres.
final class OrderFiltersUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAYearAndAnOrderAreChosenAndCleared() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "orders", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        let filters = app.buttons["order-filters-button"]
        XCTAssertTrue(filters.waitForExistence(timeout: 20), "My orders drew no Filters button: \(chipLabels(app))")
        filters.tap()
        let year = app.buttons["2026"]
        XCTAssertTrue(year.waitForExistence(timeout: 10), "The Filters sheet offered no year.")
        year.tap()
        let show = app.buttons["Show orders"]
        XCTAssertTrue(show.waitForExistence(timeout: 5), "The Filters sheet has no Show orders.")
        show.tap()
        let chosen = app.buttons["Remove 2026"]
        XCTAssertTrue(chosen.waitForExistence(timeout: 10), "The year chosen is not a chip of its own: \(chipLabels(app))")
        XCTAssertEqual(app.buttons["order-filters-button"].value as? String, "1", "Filters does not count the year.")

        let sort = app.buttons["order-sort-button"]
        XCTAssertTrue(sort.exists, "My orders drew no Sort button.")
        sort.tap()
        let oldest = app.buttons["Oldest first"]
        XCTAssertTrue(oldest.waitForExistence(timeout: 10), "The Sort sheet offered no Oldest first.")
        oldest.tap()
        let sorted = app.buttons.matching(NSPredicate(format: "label == %@", "Sort, Oldest first")).firstMatch
        XCTAssertTrue(sorted.waitForExistence(timeout: 10), "Sort does not say Oldest first: \(chipLabels(app))")

        let clear = app.buttons["Clear all"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5), "Clear all is not drawn while filters are on.")
        reveal(clear, app)
        clear.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == %@", "Sort, Newest first")).firstMatch.waitForExistence(timeout: 10),
                      "Clear all did not put the order back: \(chipLabels(app))")
        XCTAssertFalse(app.buttons["Remove 2026"].exists, "The year's chip stayed after Clear all.")
        XCTAssertFalse(app.buttons["Clear all"].exists, "Clear all stayed with nothing chosen.")
    }

    /// Swipes the chip row toward its end until `element` is wholly on the
    /// screen inside it, and says where it was if it never was.
    ///
    /// Reach is read from the frames, never `isHittable`: XCUI cannot answer
    /// that for an element wholly off the screen — run 303 stopped on "Failed
    /// to determine hittability of "Sort" Button: Activation point invalid" at
    /// the first ask — and the row draws its chips past its own frame
    /// (`glassRow`), so a drawn chip is not one a finger reaches.
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication) {
        let row = app.descendants(matching: .any).matching(identifier: "order-filter-tokens").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "The chip row is not drawn: \(chipLabels(app))")
        func inReach() -> Bool {
            let shown = row.frame.intersection(app.frame).insetBy(dx: 4, dy: -8)
            return element.exists && !shown.isNull && shown.contains(element.frame)
        }
        for _ in 0..<6 where !inReach() {
            row.swipeLeft()
        }
        XCTAssertTrue(inReach(), "\(element.label) never came into reach at \(element.frame) in the row's \(row.frame): \(chipLabels(app))")
    }

    private func chipLabels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
