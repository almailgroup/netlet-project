import XCTest

/// Two of the owner's rules, held where a person meets them.
///
/// "For removing anything, first it should ask you if you are sure you want
/// to remove this, like removing products from cart" — a line's "Remove from
/// cart" asks "Remove from your cart?", and Cancel keeps the line.
///
/// "When choosing a category in the homepage, it should redirect you to the
/// category page choosing that specific category" — a home tile opens the
/// Categories tab with that department's subcategories unfolded.
final class RemovalUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testRemovingACartLineAsksFirstAndCancelKeepsIt() {
        let app = launch(open: "cart", as: "shopper")
        let menus = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "More options for"))
        let appeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: menus)
        _ = XCTWaiter().wait(for: [appeared], timeout: 12)
        guard let menu = menus.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) else {
            return XCTFail("No line menu on the cart.")
        }
        let line = menu.label
        menu.tap()

        let remove = app.buttons["Remove from cart"]
        XCTAssertTrue(remove.waitForExistence(timeout: 6), "The line's menu has no Remove from cart.")
        remove.tap()

        let question = app.alerts["Remove from your cart?"]
        XCTAssertTrue(question.waitForExistence(timeout: 6), "Remove from cart took the line out without asking.")
        XCTAssertTrue(question.buttons["Remove"].exists, "The question has no Remove.")
        question.buttons["Cancel"].tap()

        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: question)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 6), .completed, "The question stayed up after Cancel.")
        XCTAssertTrue(app.buttons[line].waitForExistence(timeout: 4), "Cancel took the line out of the cart.")
    }

    func testAHomeCategoryTileOpensCategoriesOnIt() {
        let app = launch(open: "home", as: nil)
        // The row's first tile, on screen without scrolling it.
        let tile = app.buttons["Electronics"].firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 12), "No Electronics tile on the home page.")
        tile.tap()

        let categories = app.tabBars.buttons["Categories"]
        XCTAssertTrue(categories.waitForExistence(timeout: 6), "No tab bar after the tile.")
        let chosen = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: categories)
        XCTAssertEqual(XCTWaiter().wait(for: [chosen], timeout: 6), .completed, "The tile did not open the Categories tab.")
        // Its subcategories unfolded under its tile, ending on View all.
        XCTAssertTrue(app.buttons["See all in Electronics"].waitForExistence(timeout: 8), "Electronics is not open on the Categories page.")
    }

    private func launch(open: String?, as who: String?) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES"]
        if let open { arguments += ["-NetLetOpen", open] }
        if let who { arguments += ["-NetLetDemoAs", who] }
        app.launchArguments = arguments
        app.launch()
        return app
    }
}
