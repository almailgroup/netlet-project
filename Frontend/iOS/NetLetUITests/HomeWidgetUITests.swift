import XCTest

/// The home screen widgets as the extension draws them (`WidgetProbe`): each
/// size says what it should in the app's language, the saving is on the deal,
/// the dark face is there, and nothing runs off the screen's sides.
final class HomeWidgetUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "widgetProbe"]
        app.launch()
        return app
    }

    private func mark(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private let faces = [
        "widget-deals-small", "widget-order-small", "widget-deals-medium", "widget-order-medium",
        "widget-deals-large", "widget-deals-dark", "widget-deals-empty", "widget-order-signed-out",
    ]

    func testTheWidgetsSayWhatTheyShouldInEnglish() {
        let app = launch("en")
        let medium = mark(app, "widget-deals-medium")
        XCTAssertTrue(medium.waitForExistence(timeout: 20), "The widget probe did not open.")
        XCTAssertTrue(medium.label.contains("Today's deals"), medium.label)
        XCTAssertTrue(medium.label.contains("−30%"), "the saving is on the deal: \(medium.label)")
        XCTAssertTrue(mark(app, "widget-order-small").label.contains("About 15 to 20 minutes away"), mark(app, "widget-order-small").label)
        XCTAssertTrue(mark(app, "widget-order-small").label.contains("NL-20261104-HMGQQ"), "VoiceOver hears which order")
        XCTAssertTrue(mark(app, "widget-deals-empty").label.contains("No deals right now"))
        XCTAssertTrue(mark(app, "widget-order-signed-out").label.contains("Sign in to follow your orders"))
        for id in faces {
            let face = mark(app, id)
            if !face.isHittable { app.swipeUp() }
            XCTAssertTrue(face.exists, "\(id) is not drawn")
            XCTAssertGreaterThanOrEqual(face.frame.minX, 0, "\(id) runs off the screen's start")
            XCTAssertLessThanOrEqual(face.frame.maxX, app.frame.width + 0.5, "\(id) runs off the screen's end")
        }
    }

    func testTheWidgetsAreInArabicOnTheArabicApp() {
        let app = launch("ar")
        let medium = mark(app, "widget-deals-medium")
        XCTAssertTrue(medium.waitForExistence(timeout: 20), "The widget probe did not open.")
        XCTAssertTrue(medium.label.contains("عروض اليوم"), medium.label)
        XCTAssertFalse(medium.label.contains("Today's deals"), medium.label)
        XCTAssertTrue(mark(app, "widget-order-signed-out").label.contains("سجّل الدخول"), mark(app, "widget-order-signed-out").label)
    }
}
