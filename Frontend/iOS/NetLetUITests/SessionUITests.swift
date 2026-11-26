import XCTest

/// Who is signed in, when the server cannot be asked: the Profile tab says
/// the account could not be reached and offers Try again, never the sign-in
/// form — which told a signed-in shopper, offline at launch, that they had
/// been signed out (the web's `unknown` in `useAuth`).
final class SessionUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAnUnreachableAccountIsNotTheSignInForm() {
        check(language: "en", tab: "Profile", heading: "Your account could not be loaded just now", welcome: "Welcome to NetLet")
    }

    func testAnUnreachableAccountIsNotTheSignInFormInArabic() {
        check(language: "ar", tab: "حسابي", heading: "تعذّر تحميل حسابك الآن", welcome: "أهلاً بك في نت‑لت")
    }

    private func check(language: String, tab: String, heading: String, welcome: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "auth.me"]
        app.launch()
        let profile = app.tabBars.buttons[tab]
        XCTAssertTrue(profile.waitForExistence(timeout: 10), "No Profile tab.", file: file, line: line)
        profile.tap()
        XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 10),
                      "The Profile tab did not say the account could not be reached: \(labels(app))", file: file, line: line)
        XCTAssertTrue(app.buttons["account-unreachable-retry"].exists, "No Try again.", file: file, line: line)
        XCTAssertFalse(app.secureTextFields.firstMatch.exists, "The sign-in form is drawn for an account that could not be asked about.", file: file, line: line)
        XCTAssertFalse(app.staticTexts[welcome].exists, "The sign-in form's welcome is drawn.", file: file, line: line)
        // Still unreachable, Try again asks and says the same.
        app.buttons["account-unreachable-retry"].tap()
        XCTAssertTrue(app.staticTexts[heading].waitForExistence(timeout: 10), "Try again lost the words.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex.prefix(30).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ")
    }
}
