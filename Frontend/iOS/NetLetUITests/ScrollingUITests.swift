import XCTest

/// Every long page scrolls under a finger, all the way — the owner's "I can't
/// scroll, it stops" on the home page. Each test opens a page from the demo
/// recordings and moves it the ways a thumb does: drags from over the product
/// cards, their photos and the sideways rows, not only the empty ground; a
/// flick that has to carry on by itself after the finger lifts; and flicks to
/// the page's foot and back to its top. The top and the foot are markers drawn
/// only under `-NetLetUITest` in a Debug build (`PageTopMarker`).
///
/// A page shorter than the screen cannot scroll and is not asked to (the bag
/// with two lines, a short search), so the pages here are the long ones.
final class ScrollingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testHomeScrolls() {
        assertDrags(launch(""))
    }

    func testHomeScrollsInArabic() {
        assertDrags(launch("", language: "ar"))
    }

    /// A flick carries the page on after the finger has gone: something that
    /// stops a scroll stops it here, where a slow drag would not show it.
    func testAFlickCarriesTheHomePageOn() {
        let app = launch("")
        let top = marker(app, "page-top")
        let start = top.frame.minY
        app.swipeUp(velocity: .fast)
        sleep(2)
        let travelled = top.exists ? start - top.frame.minY : .infinity
        XCTAssertGreaterThan(travelled, 600, "A flick moved the home page only \(travelled) points.")
    }

    func testHomeReachesItsFootAndComesBack() {
        assertReachesFoot(launch(""))
    }

    func testAllProductsScrolls() {
        let app = launch("department:")
        assertDrags(app)
        assertReachesFoot(app)
    }

    func testCategoriesScrolls() {
        assertDrags(launch("categories"), atLeast: 100)
    }

    func testProductScrolls() {
        let app = launch("product:basmati-rice-5kg")
        assertDrags(app)
        assertReachesFoot(app)
    }

    func testAccountScrolls() {
        assertDrags(launch("account", as: "shopper"))
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

    /// One of the page's markers, once the page has drawn and its shelves landed.
    private func marker(_ app: XCUIApplication, _ name: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let element = app.descendants(matching: .any).matching(identifier: name).firstMatch
        if name == "page-top" {
            XCTAssertTrue(element.waitForExistence(timeout: 20), "The page never drew.", file: file, line: line)
            sleep(3)
        }
        return element
    }

    /// A thumb's drag up the screen from a point, lifted where it stops.
    private func drag(_ app: XCUIApplication, x: CGFloat, from y: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y - 0.35))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .default, thenHoldForDuration: 0.1)
    }

    private func assertDrags(_ app: XCUIApplication, atLeast distance: CGFloat = 150, file: StaticString = #filePath, line: UInt = #line) {
        let top = marker(app, "page-top", file: file, line: line)
        let start = top.frame.minY
        drag(app, x: 0.28, from: 0.72)
        drag(app, x: 0.72, from: 0.72)
        drag(app, x: 0.5, from: 0.78)
        let moved = !top.exists || top.frame.minY < start - distance
        XCTAssertTrue(moved, "Three drags left the page where it was (top at \(start), now \(top.exists ? top.frame.minY : -1)).", file: file, line: line)
    }

    /// Flicks up until the page's foot is on the screen, then down until its
    /// top is — a page that stops partway, either way, fails.
    private func assertReachesFoot(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let top = marker(app, "page-top", file: file, line: line)
        let foot = marker(app, "page-foot")
        let screen = app.frame
        func onScreen(_ element: XCUIElement) -> Bool {
            element.exists && element.frame.minY >= screen.minY && element.frame.maxY <= screen.maxY
        }
        var flicks = 0
        while !onScreen(foot) && flicks < 25 {
            app.swipeUp(velocity: .fast)
            flicks += 1
        }
        XCTAssertTrue(onScreen(foot), "\(flicks) flicks never reached the page's foot.", file: file, line: line)
        flicks = 0
        while !(onScreen(top) && top.frame.minY > 40) && flicks < 25 {
            app.swipeDown(velocity: .fast)
            flicks += 1
        }
        XCTAssertTrue(onScreen(top), "\(flicks) flicks never brought the page back to its top.", file: file, line: line)
    }
}
