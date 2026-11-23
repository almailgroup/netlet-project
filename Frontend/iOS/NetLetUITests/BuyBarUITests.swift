import XCTest

/// The product page's floating buy bar says its two buttons whole, on the
/// owner's word: a picture of it read "Add…" and "Bu…", because the name and
/// price beside them took an equal claim to the width. The buttons are laid
/// out first now, at their own width, so each is as wide as its words need —
/// "Add to cart" about 124 points with its bag, "Buy now" about 103 with its
/// bolt — where the cut ones were about 85 and 75.
final class BuyBarUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheBarsButtonsAreWholeInEnglish() {
        let (add, buy) = barButtons(language: "en", add: "Add to cart", buy: "Buy now")
        XCTAssertGreaterThanOrEqual(add.width, 110, "Add to cart is too narrow for its words: \(add)")
        XCTAssertGreaterThanOrEqual(buy.width, 92, "Buy now is too narrow for its words: \(buy)")
    }

    func testTheBarsButtonsAreWholeInArabic() {
        // Arabic's words are longer, so on a narrow phone the bar may leave
        // its icons off; the words still have their room.
        let (add, buy) = barButtons(language: "ar", add: "أضف إلى السلة", buy: "اشترِ الآن")
        XCTAssertGreaterThanOrEqual(add.width, 100, "أضف إلى السلة is too narrow for its words: \(add)")
        XCTAssertGreaterThanOrEqual(buy.width, 80, "اشترِ الآن is too narrow for its words: \(buy)")
    }

    /// Opens a product, scrolls until the floating bar shows, and hands back
    /// its two buttons' frames, having checked they sit inside the bar, side by
    /// side, and that nothing else of the bar covers them.
    private func barButtons(language: String, add addName: String, buy buyName: String) -> (add: CGRect, buy: CGRect) {
        let app = XCUIApplication()
        // The demo answers every product with its earbuds, which the demo bag
        // does not hold, so the bar offers Add to cart and Buy now.
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "product:wireless-earbuds"]
        app.launch()

        // The bar is a container named for buying the product ("Buy …", "شراء …").
        let bar = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Buy ", "شراء ")).firstMatch
        let page = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", addName)).firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20), "The product page has no \(addName).")
        // Slow swipes, so the page moves by the swipe: the bar comes once the
        // page's own buttons have gone up under the header.
        for _ in 0..<12 where !bar.exists { app.swipeUp(velocity: .slow) }
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "The floating buy bar never showed.")

        // By the words they contain, so an icon's own name beside them changes nothing.
        let addButton = bar.buttons.matching(NSPredicate(format: "label CONTAINS %@", addName)).firstMatch
        let buyButton = bar.buttons.matching(NSPredicate(format: "label CONTAINS %@", buyName)).firstMatch
        XCTAssertTrue(addButton.exists && buyButton.exists, "The bar lacks \(addName) or \(buyName): \(bar.buttons.allElementsBoundByIndex.map(\.label))")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "buy bar \(language)"
        shot.lifetime = .keepAlways
        add(shot)
        print("TEST-NOTE buy bar \(language): bar=\(bar.frame) add=\(addButton.frame) buy=\(buyButton.frame) screen=\(app.frame.width)")

        let whole = bar.frame.insetBy(dx: -1, dy: -1)
        XCTAssertTrue(whole.contains(addButton.frame) && whole.contains(buyButton.frame), "A button spills out of the bar: bar \(bar.frame), \(addButton.frame), \(buyButton.frame)")
        XCTAssertFalse(addButton.frame.insetBy(dx: 1, dy: 1).intersects(buyButton.frame), "The bar's buttons overlap: \(addButton.frame), \(buyButton.frame)")
        return (addButton.frame, buyButton.frame)
    }
}
