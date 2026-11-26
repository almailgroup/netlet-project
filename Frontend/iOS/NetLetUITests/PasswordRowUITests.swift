import XCTest

/// "Your profile"'s password row, when how the account signs in could not be
/// read: it says so and offers Try again — never "A password is set" with
/// Change, which an Apple, Google or phone account with no password was shown,
/// and whose Change then asked for a password it never had.
final class PasswordRowUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testWaysThatCouldNotBeReadAreNotAPasswordSet() {
        check(language: "en", isSet: "A password is set")
    }

    func testWaysThatCouldNotBeReadAreNotAPasswordSetInArabic() {
        check(language: "ar", isSet: "كلمة المرور محفوظة")
    }

    private func check(language: String, isSet: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoAs", "shopper", "-NetLetDemoOffline", "auth.myProviders", "-NetLetOpen", "profile"]
        app.launch()
        let retry = app.buttons["profile-ways-retry"]
        var tries = 0
        while !retry.exists, tries < 6 {
            if retry.waitForExistence(timeout: 3) { break }
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(retry.exists, "The password row did not offer Try again for how the account signs in.", file: file, line: line)
        let saysSet = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", isSet)).firstMatch
        XCTAssertFalse(saysSet.exists, "The password row said a password is set before it knew.", file: file, line: line)
        // Still unreadable, Try again asks and says the same.
        if !retry.isHittable { app.swipeUp() }
        retry.tap()
        XCTAssertTrue(app.buttons["profile-ways-retry"].waitForExistence(timeout: 10), "Try again lost the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }
}
