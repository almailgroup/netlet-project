import XCTest

/// What a `Group` did to the app, held where a person would meet it.
///
/// A SwiftUI `Group` hands what is chained onto it to each of its children,
/// so a load on an empty one never ran and a reset on one whose children come
/// and go ran again each time a new child appeared (`swiftGroups.test.ts`
/// keeps the shape out of the sources). These are the four places that
/// changed what somebody sees:
///
/// - the store's own front page never asked for its warnings, so a store with
///   one standing never saw it;
/// - a card's folded count opened the stepper and the plus leaving folded it
///   again in the same moment, so the quantity could not be changed from a card;
/// - the product editor's size chart put the saved sizes back over a size just
///   added;
/// - "Offer this product to affiliates" snapped back off as its rate box appeared.
final class GroupLifecycleUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: The store's warnings

    /// The recordings hold one standing warning for the demo store.
    func testTheStoresOwnFrontPageShowsItsWarning() {
        let app = launch(open: "portal:/admin", as: "shopper")
        let reason = app.staticTexts["Listing photos showed a different model from the one shipped"]
        XCTAssertTrue(app.staticTexts["Sales trend"].waitForExistence(timeout: 12), "The store's front page did not draw.")
        XCTAssertTrue(scroll(app, to: reason), "The store's warning never appeared on its own front page.")
    }

    // MARK: A card's stepper

    func testACardsCountOpensTheStepperAndItStaysOpen() {
        stepperStaysOpen(language: "en", folded: "2 in cart: Basmati rice", more: "More of Basmati rice 5 kg")
    }

    func testACardsCountOpensTheStepperAndItStaysOpenInArabic() {
        stepperStaysOpen(language: "ar", folded: "2 في السلة: Basmati rice", more: "زد من Basmati rice 5 kg")
    }

    /// The recorded bag holds two bags of rice, so the rice card shows its
    /// folded count. A press opens the stepper, which waits for presses and
    /// folds again on its own (`settleSeconds`: 2.5 seconds for a shopper, 8
    /// under a UI test, since a tap returns only once the glass has settled
    /// and the first run of this test read 2.5 seconds of it as a fold).
    private func stepperStaysOpen(language: String, folded: String, more: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = launch(open: "department:", language: language)
        let count = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", folded)).firstMatch
        XCTAssertTrue(count.waitForExistence(timeout: 12), "The rice card shows no count. \(labels(app))", file: file, line: line)
        let pressed = Date()
        count.tap()
        let tapTook = Date().timeIntervalSince(pressed)
        let plus = app.buttons[more]
        XCTAssertTrue(plus.waitForExistence(timeout: 3), "The count opened no stepper. \(labels(app))", file: file, line: line)
        sleep(2)
        let open = plus.exists
        print("TEST-NOTE card stepper \(language): the tap returned after \(String(format: "%.2f", tapTook))s, open \(String(format: "%.2f", Date().timeIntervalSince(pressed)))s after the press: \(open)")
        XCTAssertTrue(open, "The stepper folded the moment it opened. \(labels(app))", file: file, line: line)
        XCTAssertTrue(count.waitForExistence(timeout: 14), "The stepper never folded back to the count.", file: file, line: line)
        XCTAssertEqual(app.state, .runningForeground, file: file, line: line)
    }

    // MARK: The product editor

    /// The demo's linen shirt has a chart of four sizes.
    func testASizeAddedToTheChartIsKept() {
        let app = launch(open: "portal:/admin/products/10", as: "shopper")
        let section = sectionHeader(app, "Size chart")
        XCTAssertTrue(section.waitForExistence(timeout: 12), "The editor drew no Size chart section. \(labels(app))")
        XCTAssertTrue(scroll(app, to: section), "The Size chart section never came into reach.")
        section.tap()
        let sizes = app.textFields.matching(NSPredicate(format: "label == %@", "Size"))
        let add = app.buttons["Add a size"]
        XCTAssertTrue(add.waitForExistence(timeout: 6), "The size chart has no Add a size. \(labels(app))")
        let before = sizes.count
        XCTAssertGreaterThan(before, 0, "The size chart opened with no sizes.")
        XCTAssertTrue(scroll(app, to: add), "Add a size never came into reach.")
        add.tap()
        sleep(1)
        XCTAssertEqual(sizes.count, before + 1, "The size just added was put back to the saved chart's \(before).")
    }

    /// The shirt is not offered to affiliates, so the switch starts off.
    func testOfferingAProductToAffiliatesStaysOn() {
        let app = launch(open: "portal:/admin/products/10", as: "shopper")
        let section = sectionHeader(app, "Affiliates")
        XCTAssertTrue(section.waitForExistence(timeout: 12), "The editor drew no Affiliates section. \(labels(app))")
        XCTAssertTrue(scroll(app, to: section), "The Affiliates section never came into reach.")
        section.tap()
        let offer = app.switches["Offer this product to affiliates"]
        XCTAssertTrue(offer.waitForExistence(timeout: 6), "The section has no switch. \(labels(app))")
        XCTAssertTrue(scroll(app, to: offer), "The switch never came into reach.")
        XCTAssertEqual(offer.value as? String, "0", "The switch did not start off.")
        // The switch itself, at the row's end, not the words beside it.
        let knob = offer.switches.firstMatch.exists ? offer.switches.firstMatch : offer
        knob.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        sleep(1)
        XCTAssertEqual(offer.value as? String, "1", "The switch snapped back off.")
        XCTAssertTrue(app.staticTexts["Your rate, % of the line"].exists, "The rate box did not stay.")
    }

    // MARK: Helpers

    private func launch(open: String, as who: String? = nil, language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", open]
        if let who { app.launchArguments += ["-NetLetDemoAs", who] }
        app.launch()
        return app
    }

    /// Up a little at a time until the element can be pressed.
    private func scroll(_ app: XCUIApplication, to element: XCUIElement) -> Bool {
        for _ in 0..<14 {
            if element.exists, element.isHittable { return true }
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        return element.exists && element.isHittable
    }

    /// An editor section's header: its title, with the chevron beside it,
    /// which can add a word of its own to the button's name.
    private func sectionHeader(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", title, title + ",")).firstMatch
    }

    private func labels(_ app: XCUIApplication) -> String {
        "Buttons: " + app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).filter { !$0.isEmpty }.joined(separator: " | ")
    }
}
