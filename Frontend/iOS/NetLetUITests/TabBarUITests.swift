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

    /// Checkout has no tab bar, the web's rule for a payment page, and the
    /// cart gets it back. On iOS 26 a pressed Checkout kept the bar under
    /// Place order for as long as the page under it (`ShopPage`) said the bar
    /// was visible: a root's "visible" wins over a pushed page's "hidden"
    /// there. Found by opening checkout six ways in one run, each changing
    /// one thing, and reading what each showed; the way that worked is the
    /// app's now, and this is what keeps it.
    func testCheckoutHasNoTabBarAndTheCartGetsItBack() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "cart", "-NetLetDemoAs", "shopper",
        ]
        app.launch()
        let home = app.tabBars.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 10), "No tab bar on the cart.")

        let checkout = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Checkout"))
        let wanted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: checkout)
        _ = XCTWaiter().wait(for: [wanted], timeout: 10)
        guard let press = checkout.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) else {
            return XCTFail("No Checkout to press on the cart.")
        }
        press.tap()
        let place = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Place order")).firstMatch
        XCTAssertTrue(place.waitForExistence(timeout: 12), "Checkout did not open.")

        // The bar goes with the push's own animation, so it is waited for.
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: home)
        let left = XCTWaiter().wait(for: [gone], timeout: 6)
        XCTAssertEqual(left, .completed, "The tab bar is still on checkout: \(bar(in: app)) placeOrder=\(place.frame)")
        // And the page has the room it left: Place order sits at the screen's foot.
        XCTAssertGreaterThan(place.frame.maxY, app.frame.maxY - 70, "Place order is not at the foot of the screen: \(place.frame) in \(app.frame)")

        let back = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(back.exists && back.isHittable, "Checkout has no way back.")
        back.tap()
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: home)
        let came = XCTWaiter().wait(for: [returned], timeout: 6)
        XCTAssertEqual(came, .completed, "The tab bar did not come back on the cart: \(bar(in: app))")
    }

    /// The bar and its first tab, as a test sees them, for a failure to say.
    private func bar(in app: XCUIApplication) -> String {
        let bar = app.tabBars.firstMatch
        let home = app.tabBars.buttons["Home"]
        let barSays = bar.exists ? "hittable=\(bar.isHittable) \(bar.frame)" : "none"
        let homeSays = home.exists ? "hittable=\(home.isHittable) \(home.frame)" : "none"
        return "bar[\(barSays)] home[\(homeSays)]"
    }

    private func launch(language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "home"]
        app.launch()
        return app
    }
}
