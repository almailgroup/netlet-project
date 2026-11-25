import XCTest

/// The seller's mini tutorials, on the owner's word: "Show me" beside a step
/// of a new listing opens that step's tutorial, Next walks its scenes to Done,
/// and Done puts it away, in both languages.
final class SellerTutorialUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testShowMeBesideAStepPlaysItsTutorialToTheEnd() {
        walk(language: "en", next: "Next", done: "Done")
    }

    func testShowMeBesideAStepPlaysItsTutorialToTheEndInArabic() {
        walk(language: "ar", next: "التالي", done: "تم")
    }

    func testTheImportPageHasItsTutorialToo() {
        let app = launch(open: "portal:/admin/import", language: "en")
        let showMe = app.buttons["show-me-import"]
        XCTAssertTrue(showMe.waitForExistence(timeout: 12), "The import page drew no Show me (app state \(app.state.rawValue)).")
        showMe.tap()
        XCTAssertTrue(app.staticTexts["tutorial-caption"].waitForExistence(timeout: 6), "Show me opened no tutorial.")
    }

    private func walk(language: String, next: String, done: String) {
        let app = launch(open: "portal:/admin/products/new", language: language)
        let showMe = app.buttons["show-me-basics"]
        XCTAssertTrue(showMe.waitForExistence(timeout: 12), "The new listing drew no Show me (app state \(app.state.rawValue)).")
        for id in ["show-me-photos", "show-me-price", "show-me-extras", "show-me-description", "show-me-search", "show-me-publish"] {
            XCTAssertTrue(app.buttons[id].exists, "\(id) is missing from the new listing.")
        }
        showMe.tap()
        let caption = app.staticTexts["tutorial-caption"]
        XCTAssertTrue(caption.waitForExistence(timeout: 6), "Show me opened no tutorial.")
        let button = app.buttons["tutorial-next"]
        var seen: [String] = []
        for _ in 0..<6 {
            seen.append(caption.label)
            if button.label == done { break }
            XCTAssertEqual(button.label, next)
            button.tap()
        }
        XCTAssertEqual(button.label, done, "The tutorial never reached its last scene: \(seen)")
        XCTAssertEqual(Set(seen).count, seen.count, "A scene repeated its caption: \(seen)")
        XCTAssertGreaterThan(seen.count, 1)
        button.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: caption)
        wait(for: [gone], timeout: 4)
        XCTAssertTrue(showMe.waitForExistence(timeout: 4), "The new listing was not there after the tutorial.")
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func launch(open: String, language: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                               "-NetLetOpen", open, "-NetLetDemoAs", "shopper"]
        app.launch()
        return app
    }
}
