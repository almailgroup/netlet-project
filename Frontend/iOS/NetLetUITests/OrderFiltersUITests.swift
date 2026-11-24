import XCTest

/// My orders on the owner's word: a search bar with the filter button beside
/// it and no tabs or sort over the list; the button opens the filter page,
/// where a status and a year are chosen together and applied by Show orders,
/// each then a chip of its own with a cross; Clear all takes them both. Every
/// order says when it was ordered. The demo answers every filter with the same
/// recorded list, so this proves the page and its chips, not the server's
/// filtering, which `orders.test.ts` proves against a real Postgres.
final class OrderFiltersUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAStatusAndAYearAreChosenOnTheFilterPageAndCleared() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "orders", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        let filters = app.buttons["order-filters-button"]
        XCTAssertTrue(filters.waitForExistence(timeout: 20), "My orders drew no filter button: \(buttonLabels(app))")
        XCTAssertTrue(app.textFields["orders-search"].exists, "My orders drew no search bar beside the filter button.")
        XCTAssertFalse(app.buttons["order-sort-button"].exists, "My orders still draws a Sort button.")
        XCTAssertFalse(app.buttons["All orders"].exists, "My orders still draws its row of tabs.")
        let dated = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Ordered on ")).firstMatch
        XCTAssertTrue(dated.waitForExistence(timeout: 10), "An order does not say when it was ordered.")

        filters.tap()
        let delivered = app.buttons["Delivered"]
        XCTAssertTrue(delivered.waitForExistence(timeout: 10), "The filter page offered no Delivered status.")
        for each in ["Order received", "Being prepared", "Shipped", "Cancelled", "Last 30 days", "Last 3 months", "Choose dates", "Returns", "Reviews"] {
            XCTAssertTrue(app.buttons[each].exists, "The filter page has no \(each): \(buttonLabels(app))")
        }
        for gone in ["Last 6 months", "This month", "Cash on delivery", "Any total", "Any store"] {
            XCTAssertFalse(app.buttons[gone].exists, "The filter page still offers \(gone).")
        }
        delivered.tap()
        let year = app.buttons["2026"]
        XCTAssertTrue(year.waitForExistence(timeout: 5), "The filter page offered no year.")
        year.tap()
        app.buttons["Show orders"].tap()

        XCTAssertTrue(app.buttons["Remove Delivered"].waitForExistence(timeout: 10), "The status chosen is not a chip: \(buttonLabels(app))")
        XCTAssertTrue(app.buttons["Remove 2026"].exists, "The year chosen is not a chip: \(buttonLabels(app))")
        XCTAssertEqual(app.buttons["order-filters-button"].value as? String, "2", "The filter button does not count the status and the year.")

        app.buttons["Remove Delivered"].tap()
        XCTAssertTrue(waitUntilGone(app.buttons["Remove Delivered"]), "The status's cross did not take it off.")
        XCTAssertEqual(app.buttons["order-filters-button"].value as? String, "1", "Taking the status off took the year too.")

        let clear = app.buttons["Clear all"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5), "Clear all is not drawn while a filter is on.")
        clear.tap()
        XCTAssertTrue(waitUntilGone(app.buttons["Remove 2026"]), "The year's chip stayed after Clear all.")
        XCTAssertFalse(app.buttons["Clear all"].exists, "Clear all stayed with nothing chosen.")
    }

    private func waitUntilGone(_ element: XCUIElement) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: 10) == .completed
    }

    private func buttonLabels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
