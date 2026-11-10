import XCTest

/// The bottom menu, on the owner's word: five tabs — Home, Categories, Deals,
/// Profile, Cart, in that order — drawn as icons alone, each still named for
/// VoiceOver, and Deals opening the shop's on-offer shelf.
final class TabBarUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testFiveTabsInTheOwnersOrderEachNamed() {
        let app = launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 8), "No tab bar.")
        let tabs = bar.buttons.allElementsBoundByIndex
            .filter { $0.exists && $0.isHittable }
            .sorted { $0.frame.minX < $1.frame.minX }
            .map(\.label)
        XCTAssertEqual(tabs, ["Home", "Categories", "Deals", "Profile", "Cart"], "The tabs, left to right, by their names.")
    }

    func testDealsOpensTheOnOfferShelf() {
        let app = launch()
        let deals = app.tabBars.buttons["Deals"]
        XCTAssertTrue(deals.waitForExistence(timeout: 8), "No Deals tab.")
        deals.tap()
        // The page's own heading, by its identifier: "Deals" is also the
        // tab's name and the home page's band, so the word alone proves
        // nothing.
        let title = app.staticTexts["page-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "Deals did not open a shelf page.")
        XCTAssertEqual(title.label, "Deals", "Deals opened another page.")
        // On offer is the page, not a filter on it: never a chip to clear.
        let offerChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "On offer")).firstMatch
        XCTAssertFalse(offerChip.exists, "On offer is drawn as a filter on the Deals page.")
    }

    func testTheTabsAreNamedInArabic() {
        let app = launch(language: "ar")
        XCTAssertTrue(app.tabBars.buttons["العروض"].waitForExistence(timeout: 8), "The Deals tab has no Arabic name.")
        XCTAssertTrue(app.tabBars.buttons["الأقسام"].exists, "The Categories tab has no Arabic name.")
    }

    /// Whether checkout, reached from the cart the way a shopper reaches it,
    /// still has the tab bar under Place order. The app asks for none there
    /// (`CheckoutView`), the web's rule for a payment page, and the CI's
    /// pictures — which open checkout as the app starts — have shown the bar
    /// all the same. **This asks and does not fail yet**: it says in the log
    /// what a pressed Checkout gives (a `TEST-NOTE` line, which the workflow prints), so the fix is made
    /// for what a phone does, not for what a picture taken at launch does.
    func testCheckoutSaysWhetherItHasTheTabBar() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "cart", "-NetLetDemoAs", "shopper",
        ]
        app.launch()
        let bar = app.tabBars.firstMatch
        guard bar.waitForExistence(timeout: 10) else {
            print("TEST-NOTE checkout tab bar: no tab bar on the cart")
            return
        }
        let checkout = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Checkout"))
        let wanted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: checkout)
        _ = XCTWaiter().wait(for: [wanted], timeout: 10)
        guard let press = checkout.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) else {
            print("TEST-NOTE checkout tab bar: no Checkout to press on the cart")
            return
        }
        press.tap()
        let place = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Place order")).firstMatch
        guard place.waitForExistence(timeout: 12) else {
            print("TEST-NOTE checkout tab bar: checkout did not open")
            return
        }
        // Past the push's own animation, which is when a bar would go.
        _ = XCTWaiter().wait(for: [XCTestExpectation(description: "settled")], timeout: 2)
        let shown = bar.exists && bar.isHittable
        let frame = bar.exists ? "\(bar.frame)" : "none"
        let message = "TEST-NOTE checkout tab bar: shown=\(shown) bar=\(frame) placeOrder=\(place.frame) screen=\(app.frame)"
        print(message)
        XCTContext.runActivity(named: message) { _ in }
    }

    private func launch(language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "home"]
        app.launch()
        return app
    }
}
