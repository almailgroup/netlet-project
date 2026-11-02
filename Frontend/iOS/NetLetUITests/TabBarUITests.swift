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
        let title = app.staticTexts["browse.title"]
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

    private func launch(language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "home"]
        app.launch()
        return app
    }
}
