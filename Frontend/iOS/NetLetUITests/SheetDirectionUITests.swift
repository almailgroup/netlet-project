import XCTest

/// A sheet is drawn in the page's language's direction. A sheet is a hosting
/// controller of its own, which takes its direction from the phone's system
/// language and not from the page that opened it, so on a phone set to
/// English every order sheet came up left to right on the Arabic page —
/// Close at the left and each item's row unmirrored — while its words were
/// Arabic. Close is the bar's leading button, so it sits at the right on the
/// Arabic page and at the left on the English one.
final class SheetDirectionUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAnOrderSheetIsMirroredOnTheArabicPage() {
        let app = launch(language: "ar")
        let close = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "إغلاق")).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 20), "The Track sheet did not open with its Close.")
        XCTAssertGreaterThan(close.frame.midX, app.frame.midX, "Close is on the left of an Arabic sheet: the sheet came up left to right.")
    }

    func testAnOrderSheetReadsLeftToRightInEnglish() {
        let app = launch(language: "en")
        let close = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Close")).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 20), "The Track sheet did not open with its Close.")
        XCTAssertLessThan(close.frame.midX, app.frame.midX, "Close is on the right of an English sheet.")
    }

    private func launch(language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
            "-NetLetOpen", "track:NL-20261001-J7MWY", "-NetLetDemoAs", "shopper",
        ]
        app.launch()
        return app
    }
}
