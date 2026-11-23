import XCTest

/// Choosing an order's items, the cart's own circles, on the owner's word
/// ("when you select a specific order, it should let you choose the product,
/// just like in the cart page, and it should give you all the options"): a
/// circle beside each item brings a bar of Liquid Glass over the page's foot
/// with every act the chosen items allow — the item has no ⋯ of its own —
/// Track opens the tracker for them, and Clear puts the bar away. The recorded order holds one delivered item that can still
/// go back, be claimed on and be rated.
final class OrderSelectionUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testChoosingAnItemBringsEveryActItAllows() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-20261001-J7MWY", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        // The circle is a toggle (`.isToggle`), which XCUITest reports as a
        // toggle rather than a button, so it is found by its name alone.
        let circle = named(app, "Choose USB-C charger 65W")
        XCTAssertTrue(circle.waitForExistence(timeout: 20), "The order's item has no circle: \(labels(app))")
        XCTAssertTrue(named(app, "Choose every item in this order").exists, "The order has no All circle: \(labels(app))")
        // The item has no ⋯ of its own: its acts are the bar's (on the owner's word).
        XCTAssertFalse(named(app, "Options for USB-C charger 65W").exists, "The item still has a ⋯ of its own: \(labels(app))")
        XCTAssertFalse(app.staticTexts["1 item chosen"].exists, "The bar is up before anything is chosen.")
        circle.tap()

        let count = app.staticTexts["1 item chosen"]
        XCTAssertTrue(count.waitForExistence(timeout: 6), "Choosing the item brought no bar: \(labels(app))")
        for act in ["Track", "Return", "Warranty", "Rate", "Buy again", "Help"] {
            XCTAssertTrue(app.buttons[act].exists, "The bar does not offer \(act): \(labels(app))")
        }
        // A paid, delivered item cannot be cancelled or have its quantity changed.
        XCTAssertFalse(app.buttons["Quantity"].exists, "The bar offers a change on a paid order.")

        // Track opens the tracker on the chosen item's parcel.
        app.buttons["Track"].tap()
        let delivered = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Delivered")).firstMatch
        XCTAssertTrue(delivered.waitForExistence(timeout: 6), "Track did not open the tracker: \(labels(app))")
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Close")).firstMatch.tap()

        // Clear puts the bar away.
        let clear = app.buttons["Clear"]
        XCTAssertTrue(clear.waitForExistence(timeout: 6), "The bar went with the tracker: \(labels(app))")
        clear.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: count)
        wait(for: [gone], timeout: 4)
    }

    private func named(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Every named element on screen with its type, so a miss says what was there.
    private func labels(_ app: XCUIApplication) -> String {
        app.descendants(matching: .any).allElementsBoundByIndex.prefix(80)
            .filter { !$0.label.isEmpty }
            .map { "\($0.label) [\($0.elementType.rawValue)]" }
            .joined(separator: " | ")
    }
}
