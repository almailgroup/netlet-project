import XCTest

/// The portal's front page draws its dashboard, for a store and for NetLet,
/// and the co-pilot opens over it. The CI's pictures of all three showed the
/// phone's home screen: the app had stopped on them, while every unit test
/// passed, because the tests decode the recordings and nothing drew them.
/// Each test opens the page from the recordings, scrolls it to its foot so
/// every card is drawn, and fails if the app is no longer running.
final class PortalUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheStoreDashboardDraws() {
        dashboardDraws(as: "shopper", language: "en")
    }

    func testTheStoreDashboardDrawsInArabic() {
        dashboardDraws(as: "shopper", language: "ar")
    }

    func testNetLetsDashboardDraws() {
        dashboardDraws(as: "admin", language: "en")
    }

    func testTheCopilotOpens() {
        let app = launch(open: "copilot", as: "shopper", language: "en")
        let title = app.staticTexts["NetLet Co-pilot"]
        XCTAssertTrue(title.waitForExistence(timeout: 12), "The co-pilot did not open (app state \(app.state.rawValue)).")
        XCTAssertEqual(app.state, .runningForeground, "The app stopped with the co-pilot open.")
    }

    private func dashboardDraws(as who: String, language: String) {
        let app = launch(open: "portal:/admin", as: who, language: language)
        let trend = app.staticTexts[language == "ar" ? "اتجاه المبيعات" : "Sales trend"]
        XCTAssertTrue(trend.waitForExistence(timeout: 12), "The dashboard did not draw (app state \(app.state.rawValue)).")
        for _ in 0..<8 {
            app.swipeUp()
            XCTAssertEqual(app.state, .runningForeground, "The app stopped while the dashboard scrolled.")
        }
        XCTAssertEqual(app.state, .runningForeground, "The app stopped on the dashboard.")
    }

    private func launch(open: String, as who: String, language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetOpen", open, "-NetLetDemoAs", who]
        app.launch()
        return app
    }
}
