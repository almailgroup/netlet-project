import XCTest

/// My orders' chips, on the owner's word: a press on When opens its sheet,
/// a year chosen there is the chip's own words, and Sort likewise — then
/// Clear all puts both back. The demo answers every filter with the same
/// recorded list, so this proves the chips and their sheets, not the server's
/// filtering, which `orders.test.ts` proves against a real Postgres.
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

        let date = chip(app, "Date")
        XCTAssertTrue(date.waitForExistence(timeout: 20), "My orders drew no Date chip.")
        date.tap()
        let year = app.buttons["2026"]
        XCTAssertTrue(year.waitForExistence(timeout: 10), "The Date sheet offered no year.")
        year.tap()
        let dated = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Date, 2026")).firstMatch
        XCTAssertTrue(dated.waitForExistence(timeout: 10), "The Date chip does not say 2026: \(chipLabels(app))")

        chip(app, "Sort").tap()
        let oldest = app.buttons["Oldest first"]
        XCTAssertTrue(oldest.waitForExistence(timeout: 10), "The Sort sheet offered no Oldest first.")
        oldest.tap()
        let sorted = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Sort, Oldest first")).firstMatch
        XCTAssertTrue(sorted.waitForExistence(timeout: 10), "The Sort chip does not say Oldest first: \(chipLabels(app))")

        let clear = app.buttons["Clear all"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5), "Clear all is not drawn while chips are chosen.")
        clear.tap()
        XCTAssertTrue(chip(app, "Date").waitForExistence(timeout: 10), "Clear all did not put the Date chip back: \(chipLabels(app))")
        XCTAssertFalse(app.buttons["Clear all"].exists, "Clear all stayed with nothing chosen.")
    }

    private func chip(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
    }

    private func chipLabels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
