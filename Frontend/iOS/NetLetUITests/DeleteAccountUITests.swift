import XCTest

/// "Delete your account", when what stands in the way could not be read: it
/// says so and offers Try again — never a greyed Delete button with no
/// sentence beside it, which is what a phone offline for a moment was shown.
final class DeleteAccountUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testACheckThatCouldNotBeReadSaysSo() {
        check(language: "en", title: "Delete your account", failed: "This part of your account could not be loaded.")
    }

    func testACheckThatCouldNotBeReadSaysSoInArabic() {
        check(language: "ar", title: "حذف حسابك", failed: "تعذّر تحميل هذا الجزء من حسابك.")
    }

    private func check(language: String, title: String, failed: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "auth.deletionCheck", "-NetLetOpen", "profile"]
        app.launch()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        var tries = 0
        while !(row.exists && row.isHittable), tries < 12 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "No delete row on Your profile.", file: file, line: line)
        row.tap()
        let retry = app.buttons["delete-check-retry"]
        if !retry.waitForExistence(timeout: 5) { app.swipeUp() }
        XCTAssertTrue(retry.waitForExistence(timeout: 10), "The card did not offer Try again for a check it could not read.", file: file, line: line)
        XCTAssertTrue(app.staticTexts[failed].exists, "The card did not say the check could not be read.", file: file, line: line)
        // Still unreadable, Try again asks and says the same.
        retry.tap()
        XCTAssertTrue(app.buttons["delete-check-retry"].waitForExistence(timeout: 10), "Try again lost the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }
}
