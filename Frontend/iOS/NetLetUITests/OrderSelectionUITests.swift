import XCTest

/// Choosing an order's items, the cart's own circles, on the owner's word
/// ("when you select a specific order, it should let you choose the product,
/// just like in the cart page, and it should give you all the options"): a
/// circle beside each item brings a bar of Liquid Glass over the page's foot
/// with every act the chosen items allow — and the whole order's, whatever is
/// chosen; neither the item nor the order has a ⋯ — Track opens the
/// tracker for them, and Close puts the bar away. **The circles are out only
/// once "Edit order" is pressed**, on the owner's word ("when I came to this
/// page no need to see it in this way … add an icon like edit your order"),
/// and Close puts them away with the bar. The recorded order holds one
/// delivered item that can still go back, be claimed on and be rated.
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

        // The order opens on its items alone: no circles and no line about
        // them until "Edit order" is pressed.
        let edit = app.buttons["order-edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20), "The order has no Edit order button: \(labels(app))")
        XCTAssertEqual(edit.label, "Edit order")
        // The circle is a toggle (`.isToggle`), which XCUITest reports as a
        // toggle rather than a button, so it is found by its name alone.
        let circle = named(app, "Choose USB-C charger 65W")
        XCTAssertFalse(circle.exists, "The item's circle is out before Edit order: \(labels(app))")
        XCTAssertFalse(named(app, "Choose every item in this order").exists, "The All circle is out before Edit order.")
        XCTAssertFalse(app.staticTexts["Choose items, or all of them, to see what you can do."].exists, "The line about the circles is out before Edit order.")
        edit.tap()
        XCTAssertTrue(circle.waitForExistence(timeout: 6), "Edit order brought no circle: \(labels(app))")
        XCTAssertTrue(named(app, "Choose every item in this order").exists, "The order has no All circle: \(labels(app))")
        XCTAssertEqual(edit.label, "Done", "Editing, the button does not say Done.")
        // Neither the item nor the order has a ⋯ any more: the bar is the one
        // way in (on the owner's word).
        XCTAssertFalse(named(app, "Options for USB-C charger 65W").exists, "The item still has a ⋯ of its own: \(labels(app))")
        XCTAssertFalse(named(app, "Options for this order").exists, "The order still has a ⋯ of its own: \(labels(app))")
        XCTAssertFalse(app.staticTexts["1 item chosen"].exists, "The bar is up before anything is chosen.")
        circle.tap()

        let count = app.staticTexts["1 item chosen"]
        XCTAssertTrue(count.waitForExistence(timeout: 6), "Choosing the item brought no bar: \(labels(app))")
        // The order's only item is every item: the order's receipt is on the bar too.
        for act in ["Track", "Return", "Warranty", "Rate", "Buy again", "Receipt", "Help"] {
            XCTAssertTrue(app.buttons[act].exists, "The bar does not offer \(act): \(labels(app))")
        }
        // A paid, delivered item cannot be cancelled or have its quantity changed.
        XCTAssertFalse(app.buttons["Quantity"].exists, "The bar offers a change on a paid order.")

        // Track opens the tracker on the chosen item's parcel.
        app.buttons["Track"].tap()
        let delivered = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Delivered")).firstMatch
        XCTAssertTrue(delivered.waitForExistence(timeout: 6), "Track did not open the tracker: \(labels(app))")
        // The tracker's own Close, never the bar's, which is named Close too.
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND identifier != %@", "Close", "chosen-close")).firstMatch.tap()

        // Close puts the bar away (it said Clear; the owner asked for Close).
        let clear = app.buttons["chosen-close"]
        XCTAssertTrue(clear.waitForExistence(timeout: 6), "The bar went with the tracker: \(labels(app))")
        clear.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: count)
        wait(for: [gone], timeout: 4)
        // Close puts the circles away with the bar, and Edit order is back.
        let circleGone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: circle)
        wait(for: [circleGone], timeout: 4)
        XCTAssertEqual(app.buttons["order-edit"].label, "Edit order", "After Close the button is not Edit order again.")
    }

    /// A press on the item's name chooses it, and a second puts it back, on
    /// the owner's word ("when you tap on its name or anywhere near that
    /// specific product, it should automatically choose it") — the circle is
    /// no longer the only place to press.
    func testAPressOnTheItemsNameChoosesIt() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-20261001-J7MWY", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        // The press lands on the item's name, with the circles still away: it
        // opens the editing with that item chosen.
        let name = app.staticTexts["USB-C charger 65W"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 20), "The order's item has no name: \(labels(app))")
        let onTheName = name.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let count = app.staticTexts["1 item chosen"]
        XCTAssertFalse(count.exists, "The bar is up before anything is chosen.")
        onTheName.tap()
        XCTAssertTrue(count.waitForExistence(timeout: 6), "A press on the item's name did not choose it: \(labels(app))")
        XCTAssertTrue(named(app, "Choose USB-C charger 65W").exists, "Choosing by the name did not bring the circles out.")
        onTheName.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: count)
        wait(for: [gone], timeout: 4)
    }

    /// One item of several chosen offers the whole order's acts too, on the
    /// owner's word ("these options should show even if one is selected; keep
    /// as many options as there is for the user"): the owner's screenshots
    /// had one of two items offer Track, Buy again, Help and Cancel, and both
    /// offer eight. The recorded pending order holds a lamp (three of it) and
    /// a kettle, neither with a driver yet, on an order that may still change
    /// its address, its way to pay or be cancelled.
    func testOneItemOfSeveralOffersTheOrdersActsToo() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-AS-PENDING", "-NetLetDemoAs", "pending",
        ]
        app.launch()

        let edit = app.buttons["order-edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 20), "The order has no Edit order button: \(labels(app))")
        edit.tap()
        let circle = named(app, "Choose Copper Kettle")
        XCTAssertTrue(circle.waitForExistence(timeout: 6), "The kettle has no circle: \(labels(app))")
        XCTAssertEqual(named(app, "Choose Harbour Desk Lamp").exists, true, "The lamp has no circle: \(labels(app))")
        circle.tap()
        XCTAssertTrue(app.staticTexts["1 item chosen"].waitForExistence(timeout: 6), "Choosing the kettle brought no bar: \(labels(app))")
        for act in ["Track", "Change order", "Buy again", "Address", "Payment", "Receipt", "Help", "Cancel item"] {
            XCTAssertTrue(app.buttons[act].exists, "One item chosen does not offer \(act): \(labels(app))")
        }
        // Cancel order only from All, on the owner's word: one item of two
        // offers that item's cancel alone.
        XCTAssertFalse(app.buttons["Cancel order"].exists, "One item of two offers Cancel order: \(labels(app))")
        // The kettle is one of its kind, so it has no quantity of its own to lower.
        XCTAssertFalse(app.buttons["Quantity"].exists, "The bar offers a quantity for one of a kind.")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "one item of two chosen"
        shot.lifetime = .keepAlways
        add(shot)

        // Both chosen: Cancel order, and no Cancel items beside it.
        named(app, "Choose Harbour Desk Lamp").tap()
        XCTAssertTrue(app.buttons["Cancel order"].waitForExistence(timeout: 6), "Every item chosen does not offer Cancel order: \(labels(app))")
        XCTAssertFalse(app.buttons["Cancel items"].exists, "Every item chosen offers Cancel items beside Cancel order.")
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
