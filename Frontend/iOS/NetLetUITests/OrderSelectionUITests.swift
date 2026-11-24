import XCTest

/// Choosing an order's items, the cart's own circles, on the owner's word
/// ("when you select a specific order, it should let you choose the product,
/// just like in the cart page, and it should give you all the options"): a
/// circle beside each item brings a bar of Liquid Glass over the page's foot
/// with every act the chosen items allow — and the whole order's, whatever is
/// chosen; neither the item nor the order has a ⋯ — Warranty opens its
/// sheet for them, and Close puts the bar away. **No Track, Payment or
/// Receipt on the bar**, on the owner's word ("no need inside the track
/// because will show out side, no need payment because we will control full
/// payment for all order one time, no need receipt because there will be one
/// receipt for all"): each item's status is under its photo, the way to pay is
/// changed from the order's own line, and the receipt is the PDF at the top. **The circles are out only
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
        for act in ["View product", "Return", "Warranty", "Rate", "Buy again", "Help"] {
            XCTAssertTrue(app.buttons[act].exists, "The bar does not offer \(act): \(labels(app))")
        }
        for act in ["Track", "Payment", "Receipt"] {
            XCTAssertFalse(app.buttons[act].exists, "The bar still offers \(act): \(labels(app))")
        }
        // A paid, delivered item cannot be cancelled or have its quantity changed.
        XCTAssertFalse(app.buttons["Quantity"].exists, "The bar offers a change on a paid order.")

        // Warranty opens its sheet about the chosen item.
        app.buttons["Warranty"].tap()
        let note = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "For something that arrived")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 6), "Warranty did not open its sheet: \(labels(app))")
        // The sheet's own Close, never the bar's, which is named Close too.
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

    /// "I cannot see product details" from an order (the owner's word): with
    /// the circles away a press on the item opens its product; while the
    /// order is edited a press on its name chooses it and a second puts it
    /// back (the owner's "tap on its name … should choose it"), and one item
    /// chosen offers View product on the bar, which opens it too.
    func testAPressOnTheItemOpensItsProductAndChoosesItWhileEditing() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-20261001-J7MWY", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        let name = app.staticTexts["USB-C charger 65W"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 20), "The order's item has no name: \(labels(app))")
        let count = app.staticTexts["1 item chosen"]

        // Not editing: the press opens the product's page (the demo answers
        // every product with its earbuds), and nothing is chosen.
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(productPage(app).waitForExistence(timeout: 12), "A press on the item did not open its product: \(labels(app))")
        XCTAssertFalse(count.exists, "A press outside editing chose the item.")
        backFromProduct(app)

        // Editing: the press on the name chooses the item, a second puts it back.
        let edit = app.buttons["order-edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10), "Back from the product, the order has no Edit order: \(labels(app))")
        edit.tap()
        let onTheName = name.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        onTheName.tap()
        XCTAssertTrue(count.waitForExistence(timeout: 6), "While editing, a press on the item's name did not choose it: \(labels(app))")
        XCTAssertFalse(productPage(app).exists, "While editing, a press on the item opened its product.")
        onTheName.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: count)
        wait(for: [gone], timeout: 4)

        // One item chosen: View product, first on the bar, opens its page.
        named(app, "Choose USB-C charger 65W").tap()
        let view = app.buttons["View product"]
        XCTAssertTrue(view.waitForExistence(timeout: 6), "One item chosen does not offer View product: \(labels(app))")
        view.tap()
        XCTAssertTrue(productPage(app).waitForExistence(timeout: 12), "View product did not open the product: \(labels(app))")
    }

    /// The product page's own buy box: a card's buttons name the product, the page's do not.
    private func productPage(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN %@", ["Add to cart", "Buy now", "Pre-order now"])).firstMatch
    }

    private func backFromProduct(_ app: XCUIApplication) {
        let back = app.buttons["Back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 6), "The product page has no way back: \(labels(app))")
        back.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: productPage(app))
        wait(for: [gone], timeout: 10)
    }

    /// One item of several chosen offers the whole order's acts too, on the
    /// owner's word ("these options should show even if one is selected; keep
    /// as many options as there is for the user"): the owner's screenshots
    /// had one of two items offer four acts and both eight. The recorded
    /// pending order holds a lamp (three of it) and a kettle, neither with a
    /// driver yet, on an order that may still change its address, its way to
    /// pay or be cancelled — the way to pay from the order's own line, never
    /// the bar.
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
        for act in ["Change order", "Buy again", "Change address", "Help", "Cancel item"] {
            XCTAssertTrue(app.buttons[act].exists, "One item chosen does not offer \(act): \(labels(app))")
        }
        for act in ["Track", "Payment", "Receipt"] {
            XCTAssertFalse(app.buttons[act].exists, "The bar still offers \(act): \(labels(app))")
        }
        // The way to pay is the whole order's, changed from its own line.
        XCTAssertTrue(app.buttons["Change payment method"].exists, "The order has no line to change how it is paid: \(labels(app))")
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
