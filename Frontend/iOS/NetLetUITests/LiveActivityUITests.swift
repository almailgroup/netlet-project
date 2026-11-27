import XCTest

/// The Lock Screen card and the Dynamic Island an order on its way wears,
/// drawn by the views the widget extension draws (`LiveActivityProbe`): each
/// card says where the order is in the app's language, the island is there
/// compact and held open, and nothing is cut off the screen's sides.
final class LiveActivityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "liveActivityProbe"]
        app.launch()
        return app
    }

    private func mark(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    func testTheCardSaysWhereTheOrderIsInEnglish() {
        let app = launch("en")
        let driving = mark(app, "live-card-driving")
        XCTAssertTrue(driving.waitForExistence(timeout: 20), "The Lock Screen probe did not open.")
        XCTAssertTrue(driving.label.contains("About 15 to 20 minutes away"), driving.label)
        XCTAssertTrue(driving.label.contains("NL-20261104-HMGQQ"), "VoiceOver hears which order: \(driving.label)")
        let waiting = mark(app, "live-card-waiting")
        XCTAssertTrue(waiting.label.contains("On the way"), waiting.label)
        XCTAssertTrue(waiting.label.contains("Open NetLet to see where it is now"), "an old card says so: \(waiting.label)")
        XCTAssertTrue(mark(app, "live-card-arrived").label.contains("Delivered"))
        for id in ["live-card-driving", "live-card-waiting", "live-card-arrived", "live-island-compact", "live-island-expanded"] {
            let frame = mark(app, id).frame
            XCTAssertGreaterThanOrEqual(frame.minX, 0, "\(id) runs off the screen's start")
            XCTAssertLessThanOrEqual(frame.maxX, app.frame.width + 0.5, "\(id) runs off the screen's end")
        }
    }

    func testTheCardIsInArabicOnTheArabicApp() {
        let app = launch("ar")
        let driving = mark(app, "live-card-driving")
        XCTAssertTrue(driving.waitForExistence(timeout: 20), "The Lock Screen probe did not open.")
        XCTAssertTrue(driving.label.contains("دقيقة"), driving.label)
        XCTAssertFalse(driving.label.contains("minutes"), driving.label)
        XCTAssertTrue(mark(app, "live-card-waiting").label.contains("افتح نت لت"), mark(app, "live-card-waiting").label)
    }
}
