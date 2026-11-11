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

    /// Which way of putting the tab bar away works on checkout. The app asks
    /// for none there (`CheckoutView`), the web's rule for a payment page,
    /// and on iOS 26 a pressed Checkout showed it all the same — this test's
    /// first run said so (`shown=true`, the bar hittable under Place order).
    /// Reading the code could not say why, so the app has one switch per
    /// suspect (`UITestHooks.tabBarProbe`) and this opens checkout under each
    /// and says what it found, and whether the bar is back on the cart
    /// afterwards. **It asks and does not fail**: each line is a `TEST-NOTE`,
    /// which the workflow prints and posts, and the way that works becomes
    /// the app's with a test that does fail.
    func testCheckoutSaysWhetherItHasTheTabBar() {
        for way in ["asIs", "rootAuto", "toggle", "uikitHidden", "uikitSet", "slide"] {
            let said = whatCheckoutShows(way)
            print("TEST-NOTE checkout tab bar [\(way)]: \(said)")
        }
    }

    private func whatCheckoutShows(_ way: String) -> String {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "cart", "-NetLetDemoAs", "shopper", "-NetLetTabBarProbe", way,
        ]
        app.launch()
        guard app.tabBars.firstMatch.waitForExistence(timeout: 10) else { return "no tab bar on the cart" }
        let onCart = bar(in: app)
        let checkout = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Checkout"))
        let wanted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: checkout)
        _ = XCTWaiter().wait(for: [wanted], timeout: 10)
        guard let press = checkout.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) else {
            return "no Checkout to press on the cart"
        }
        press.tap()
        let place = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Place order")).firstMatch
        guard place.waitForExistence(timeout: 12) else { return "checkout did not open" }
        // Past the push's own animation, which is when a bar would go.
        pause(2)
        let onCheckout = "\(bar(in: app)) placeOrder=\(place.frame)"
        // And back: a way that hides the bar has to give it back.
        let back = app.navigationBars.buttons.firstMatch
        guard back.exists, back.isHittable else { return "cart: \(onCart) | checkout: \(onCheckout) | no way back" }
        back.tap()
        pause(2)
        return "cart: \(onCart) | checkout: \(onCheckout) | back: \(bar(in: app)) screen=\(app.frame)"
    }

    /// The bar and its first tab, as a test sees them: the bar's own frame
    /// stays put when its layers are slid away, and a tab's does not.
    private func bar(in app: XCUIApplication) -> String {
        let bar = app.tabBars.firstMatch
        let home = app.tabBars.buttons["Home"]
        let barSays = bar.exists ? "hittable=\(bar.isHittable) \(bar.frame)" : "none"
        let homeSays = home.exists ? "hittable=\(home.isHittable) \(home.frame)" : "none"
        return "bar[\(barSays)] home[\(homeSays)]"
    }

    private func pause(_ seconds: TimeInterval) {
        _ = XCTWaiter().wait(for: [XCTestExpectation(description: "settled")], timeout: seconds)
    }

    private func launch(language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "home"]
        app.launch()
        return app
    }
}
