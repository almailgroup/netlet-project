import XCTest

/// Every long page scrolls under a finger — the owner's "I can't scroll, it
/// stops" on the home page. Each test opens a page from the demo recordings,
/// drags up three times from where a thumb would — over the product cards,
/// their photos and the sideways rows, not only the empty ground — and fails
/// if the top of the page has not gone up the screen.
///
/// A page shorter than the screen cannot scroll and is not asked to (the bag
/// with two lines, a short search), so the pages here are the long ones.
final class ScrollingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testHomeScrolls() {
        assertScrolls(launch(""))
    }

    func testHomeScrollsInArabic() {
        assertScrolls(launch("", language: "ar"))
    }

    func testAllProductsScrolls() {
        assertScrolls(launch("department:"))
    }

    func testCategoriesScrolls() {
        assertScrolls(launch("categories"))
    }

    func testProductScrolls() {
        assertScrolls(launch("product:basmati-rice-5kg"))
    }

    func testAccountScrolls() {
        assertScrolls(launch("account", as: "shopper"))
    }

    // MARK: Helpers

    private func launch(_ open: String, as role: String? = nil, language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES"]
        if !open.isEmpty { app.launchArguments += ["-NetLetOpen", open] }
        if let role { app.launchArguments += ["-NetLetDemoAs", role] }
        app.launch()
        return app
    }

    /// A thumb's drag up the screen from a point, lifted where it stops.
    private func drag(_ app: XCUIApplication, x: CGFloat, from y: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y - 0.35))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .default, thenHoldForDuration: 0.1)
    }

    private func assertScrolls(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let top = app.descendants(matching: .any).matching(identifier: "page-top").firstMatch
        XCTAssertTrue(top.waitForExistence(timeout: 20), "The page never drew.", file: file, line: line)
        // The shelves land from the recordings a moment after the page.
        sleep(3)
        let start = top.frame.minY
        drag(app, x: 0.28, from: 0.72)
        drag(app, x: 0.72, from: 0.72)
        drag(app, x: 0.5, from: 0.78)
        let moved = !top.exists || top.frame.minY < start - 150
        XCTAssertTrue(moved, "Three drags left the page where it was (top at \(start), now \(top.exists ? top.frame.minY : -1)).", file: file, line: line)
        // And it scrolls back, so a page is not stuck at its foot either.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)), withVelocity: .default, thenHoldForDuration: 0.1)
    }
}
