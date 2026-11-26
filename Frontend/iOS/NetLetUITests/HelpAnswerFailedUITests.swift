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

    private func labels(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex.prefix(30).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ")
    }
}
