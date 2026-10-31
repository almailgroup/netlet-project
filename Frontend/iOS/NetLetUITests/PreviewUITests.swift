import XCTest

/// Holding a product card opens its preview, and the preview works — the
/// owner's "the product preview is not working in app". Each test holds a
/// card the way a thumb does, on its photo and on its words, and reads the
/// sheet that comes up; a quick tap on the photo still opens the product's
/// page, and the preview's own Add to cart and Close do what they say.
///
/// The card's photo is hidden from VoiceOver (the title is the link it
/// hears), so the photo is found from the heart drawn over its corner.
final class PreviewUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testHoldingACardPhotoOpensThePreview() {
        let app = launch("department:")
        let heart = firstHeart(app)
        hold(app, at: photoPoint(of: heart, in: app))
        XCTAssertTrue(app.staticTexts["Quick view"].waitForExistence(timeout: 6), "Holding a card's photo opened no preview.")
        let close = app.buttons["Close quick view"]
        XCTAssertTrue(close.waitForExistence(timeout: 3), "The preview has no Close.")
        close.tap()
        XCTAssertTrue(waitForAbsence(app.staticTexts["Quick view"], timeout: 6), "Close left the preview up.")
    }

    func testHoldingACardPhotoOpensThePreviewInArabic() {
        let app = launch("department:", language: "ar")
        let heart = firstHeart(app, prefix: "احفظ ")
        hold(app, at: photoPoint(of: heart, in: app, rightToLeft: true))
        XCTAssertTrue(app.staticTexts["نظرة سريعة"].waitForExistence(timeout: 6), "Holding a card's photo opened no preview on the Arabic page.")
    }

    func testHoldingACardOnTheHomePageOpensThePreview() {
        let app = launch("")
        let heart = firstHeart(app)
        hold(app, at: photoPoint(of: heart, in: app))
        XCTAssertTrue(app.staticTexts["Quick view"].waitForExistence(timeout: 6), "Holding a card's photo on the home page opened no preview.")
    }

    /// The words under the photo — the store, the price — open it too.
    func testHoldingACardsWordsOpensThePreview() {
        let app = launch("department:")
        let heart = firstHeart(app)
        guard let place = frame(of: heart) else { return XCTFail("The card could not be read.") }
        // Under the photo (4:5 at the card's width, about 1.25 widths tall),
        // on the store's name, clear of the title link under it.
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let width = app.frame.width
        let cardWidth = (width - 16 * 2 - 12) / 2
        let point = origin.withOffset(CGVector(dx: place.maxX - cardWidth / 2, dy: place.minY + cardWidth * 1.25 + 15))
        point.press(forDuration: 0.9)
        XCTAssertTrue(app.staticTexts["Quick view"].waitForExistence(timeout: 6), "Holding a card's words opened no preview.")
    }

    /// A press shorter than the hold still opens the product's own page.
    func testTappingACardPhotoOpensTheProduct() {
        let app = launch("department:")
        let heart = firstHeart(app)
        let name = heart.label.replacingOccurrences(of: "Save ", with: "")
        photoPoint(of: heart, in: app).tap()
        // The product page's own buy box: a card's buttons always name the
        // product ("Add to cart: …"), the page's do not.
        let buy = app.buttons.matching(NSPredicate(format: "label IN %@", ["Add to cart", "Buy now", "Pre-order now"])).firstMatch
        XCTAssertTrue(buy.waitForExistence(timeout: 12), "A tap on a card's photo did not open \(name).")
        XCTAssertFalse(app.staticTexts["Quick view"].exists, "A tap opened the preview rather than the product.")
    }

    /// The preview's Add to cart says it worked where the finger is.
    func testThePreviewAddsToTheBag() {
        let app = launch("preview:basmati-rice-5kg")
        XCTAssertTrue(app.staticTexts["Quick view"].waitForExistence(timeout: 30), "The preview never opened.")
        let add = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Add")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "The preview has no Add to cart.")
        add.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Added to your cart")).firstMatch.waitForExistence(timeout: 8),
                      "Add to cart in the preview said nothing.")
    }

    // MARK: Helpers

    private func launch(_ open: String, language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES"]
        if !open.isEmpty { app.launchArguments += ["-NetLetOpen", open] }
        app.launch()
        return app
    }

    private func frame(of element: XCUIElement) -> CGRect? {
        (try? element.snapshot())?.frame
    }

    /// The first card's heart wholly on the screen, once the page has drawn.
    private func firstHeart(_ app: XCUIApplication, prefix: String = "Save ", file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let top = app.descendants(matching: .any).matching(identifier: "page-top").firstMatch
        XCTAssertTrue(top.waitForExistence(timeout: 45), "The page never drew.", file: file, line: line)
        sleep(3)
        let hearts = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
        XCTAssertTrue(hearts.firstMatch.waitForExistence(timeout: 20), "No product card on the page.", file: file, line: line)
        let screen = app.frame
        for index in 0..<min(hearts.count, 12) {
            let heart = hearts.element(boundBy: index)
            if let place = frame(of: heart), place.minY > 140, place.maxY + 160 < screen.maxY - 90 {
                return heart
            }
        }
        // Nothing far enough down the screen: move the page a little and take the first.
        app.swipeUp(velocity: .slow)
        sleep(1)
        return hearts.firstMatch
    }

    /// A point on the photo beside the heart, clear of it and of the bag's
    /// plus in the photo's foot.
    private func photoPoint(of heart: XCUIElement, in app: XCUIApplication, rightToLeft: Bool = false) -> XCUICoordinate {
        let place = frame(of: heart) ?? .zero
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let dx = rightToLeft ? place.maxX + 44 : place.minX - 44
        return origin.withOffset(CGVector(dx: dx, dy: place.maxY + 48))
    }

    private func hold(_ app: XCUIApplication, at point: XCUICoordinate) {
        point.press(forDuration: 0.9)
    }

    private func waitForAbsence(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
