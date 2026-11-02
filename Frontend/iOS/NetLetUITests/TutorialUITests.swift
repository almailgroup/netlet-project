import XCTest

/// The tutorial a new install opens on (`AppTutorial`) — the owner's "make
/// sure that there is skip tutorial option". Skip puts it away from its first
/// page in either language; Next walks it to the last page, whose Create
/// account opens the Profile tab's form at its first step; and a swipe turns
/// a page as Next does.
///
/// `-NetLetOpen tutorial` opens it whatever the device remembers, since a UI
/// test is never a first launch.
final class TutorialUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testSkipPutsTheTutorialAway() {
        let app = launch()
        let title = app.staticTexts["Welcome to NetLet"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "The tutorial did not open.")
        let skip = app.buttons["Skip"]
        XCTAssertTrue(skip.exists, "The tutorial has no Skip.")
        skip.tap()
        XCTAssertTrue(waitForAbsence(title, timeout: 6), "Skip left the tutorial up.")
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 4), "Skip did not land on the shop.")
    }

    func testSkipPutsTheTutorialAwayInArabic() {
        let app = launch(language: "ar")
        let title = app.staticTexts["أهلاً بك في نت‑لت"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "The Arabic tutorial did not open.")
        app.buttons["تخطّي"].tap()
        XCTAssertTrue(waitForAbsence(title, timeout: 6), "Skip left the Arabic tutorial up.")
    }

    /// Next to the last page, which offers Create account and Sign in; Create
    /// account opens the form on its first step.
    func testNextReachesTheLastPageAndCreatesAnAccount() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Welcome to NetLet"].waitForExistence(timeout: 8), "The tutorial did not open.")
        let next = app.buttons["Next"]
        for page in 1...4 {
            XCTAssertTrue(next.waitForExistence(timeout: 4), "No Next on page \(page).")
            next.tap()
        }
        XCTAssertTrue(app.staticTexts["Pay at the door, follow every parcel"].waitForExistence(timeout: 4), "Next did not reach the last page.")
        XCTAssertTrue(waitForAbsence(next, timeout: 3), "The last page still offers Next.")
        XCTAssertTrue(app.buttons["Sign in"].exists, "The last page offers no Sign in.")
        let create = app.buttons["Create account"]
        XCTAssertTrue(create.exists, "The last page offers no Create account.")
        create.tap()
        XCTAssertTrue(waitForAbsence(app.staticTexts["Pay at the door, follow every parcel"], timeout: 6), "Create account left the tutorial up.")
        let firstStep = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Step 1 of 2")).firstMatch
        XCTAssertTrue(firstStep.waitForExistence(timeout: 6), "Create account did not open the form at its first step.")
    }

    /// A swipe turns the page, as a thumb expects.
    func testASwipeTurnsThePage() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Welcome to NetLet"].waitForExistence(timeout: 8), "The tutorial did not open.")
        let second = app.staticTexts["Sign in or create an account"]
        // The page beside the one showing may already be drawn, off the screen.
        XCTAssertFalse(second.exists && second.isHittable, "The account page showed before the swipe.")
        app.swipeLeft()
        let shown = expectation(for: NSPredicate(format: "exists == true AND hittable == true"), evaluatedWith: second)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 4), .completed, "A swipe did not turn to the account page.")
    }

    private func launch(language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "tutorial"]
        app.launch()
        return app
    }

    private func waitForAbsence(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
