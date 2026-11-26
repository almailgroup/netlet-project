import XCTest

/// Help's answer, when it cannot be read: it says so, offers Try again and
/// keeps a person one press away. It drew nothing at all — no answer, no
/// retry and no person — so a shopper with a problem was left at a dead end.
final class HelpAnswerFailedUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAnAnswerThatCouldNotBeReadStillLeadsSomewhere() {
        check(language: "en", issue: "Delayed order or delivery", person: "Talk to a person")
    }

    func testAnAnswerThatCouldNotBeReadStillLeadsSomewhereInArabic() {
        check(language: "ar", issue: "تأخر الطلب أو التوصيل", person: "تحدّث إلى موظف")
    }

    private func check(language: String, issue: String, person: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "support.selfHelp", "-NetLetOpen", "page:help"]
        app.launch()
        let tile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", issue)).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 15), "No issue tile on the help page: \(labels(app))", file: file, line: line)
        tile.tap()
        let order = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "NL-")).firstMatch
        XCTAssertTrue(order.waitForExistence(timeout: 10), "No order to choose: \(labels(app))", file: file, line: line)
        if !order.isHittable { app.swipeUp() }
        order.tap()
        let retry = app.buttons["help-answer-retry"]
        if !retry.waitForExistence(timeout: 10) { app.swipeUp() }
        XCTAssertTrue(retry.waitForExistence(timeout: 5),
                      "The help page did not offer Try again for an answer it could not read: \(labels(app))", file: file, line: line)
        let toPerson = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", person)).firstMatch
        XCTAssertTrue(toPerson.exists, "A person was not offered when the answer could not be read: \(labels(app))", file: file, line: line)
        // Still unreadable, Try again asks and says the same.
        if !retry.isHittable { app.swipeUp() }
        retry.tap()
        XCTAssertTrue(app.buttons["help-answer-retry"].waitForExistence(timeout: 10), "Try again lost the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    /// The order's own help sheet, the same answer failing: it drew nothing
    /// at all under the issue chosen.
    func testTheOrderSheetsHelpSaysAnAnswerThatCouldNotBeRead() {
        orderSheet(language: "en", other: "Another issue", issue: "Delayed order or delivery")
    }

    func testTheOrderSheetsHelpSaysAnAnswerThatCouldNotBeReadInArabic() {
        orderSheet(language: "ar", other: "مشكلة أخرى", issue: "تأخر الطلب أو التوصيل")
    }

    private func orderSheet(language: String, other: String, issue: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "support.selfHelp",
                               "-NetLetOpen", "helpIssue:NL-20261001-J7MWY"]
        app.launch()
        let another = app.buttons[other]
        XCTAssertTrue(another.waitForExistence(timeout: 20), "The help sheet did not open on its issue: \(labels(app))", file: file, line: line)
        another.tap()
        let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", issue)).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "No issues to choose from: \(labels(app))", file: file, line: line)
        chip.tap()
        let retry = app.buttons["order-help-answer-retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10),
                      "The order's help did not say an answer it could not read: \(labels(app))", file: file, line: line)
        retry.tap()
        XCTAssertTrue(app.buttons["order-help-answer-retry"].waitForExistence(timeout: 10), "Try again lost the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex.prefix(30).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ")
    }
}
