import XCTest

/// A product's reviews that could not be read say so with Try again: the
/// section spun for good under its heading.
final class ReviewsFailedUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testReviewsThatCouldNotBeReadSaySo() {
        check(language: "en")
    }

    func testReviewsThatCouldNotBeReadSaySoInArabic() {
        check(language: "ar")
    }

    private func check(language: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetDemoOffline", "reviews.forProduct", "-NetLetOpen", "product:wireless-earbuds"]
        app.launch()
        let failed = app.otherElements["reviews-failed"]
        var tries = 0
        while !failed.exists, tries < 16 {
            app.swipeUp()
            tries += 1
        }
        XCTAssertTrue(failed.waitForExistence(timeout: 10), "The reviews did not say they could not be loaded.", file: file, line: line)
        XCTAssertTrue(failed.buttons.firstMatch.exists, "No Try again beside the failure.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }
}
