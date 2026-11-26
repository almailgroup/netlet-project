import XCTest

/// Help's order picker, when the orders cannot be read: it says so and offers
/// Try again, never "You have no orders yet" — which told a shopper with
/// orders, offline for a moment, that the account had none.
final class HelpOrdersUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testOrdersThatCouldNotBeReadAreNotNoOrders() {
        check(language: "en", issue: "Delayed order or delivery", failed: "Your orders could not be loaded just now", none: "You have no orders")
    }

    func testOrdersThatCouldNotBeReadAreNotNoOrdersInArabic() {
        check(language: "ar", issue: "تأخر الطلب أو التوصيل", failed: "تعذّر تحميل طلباتك الآن", none: "لا توجد لديك طلبات")
    }

    private func check(language: String, issue: String, failed: String, none: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "orders.list", "-NetLetOpen", "page:help"]
        app.launch()
        let tile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", issue)).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 15), "No issue tile on the help page: \(labels(app))", file: file, line: line)
        tile.tap()
        XCTAssertTrue(app.buttons["help-orders-retry"].waitForExistence(timeout: 10),
                      "The picker did not offer Try again for orders it could not read: \(labels(app))", file: file, line: line)
        XCTAssertTrue(app.staticTexts[failed].exists, "The picker did not say the orders could not be read.", file: file, line: line)
        let saysNone = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", none)).firstMatch
        XCTAssertFalse(saysNone.exists, "The picker said the account has no orders.", file: file, line: line)
        // Still unreadable, Try again asks and says the same.
        app.buttons["help-orders-retry"].tap()
        XCTAssertTrue(app.buttons["help-orders-retry"].waitForExistence(timeout: 10), "Try again lost the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex.prefix(30).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ")
    }
}
