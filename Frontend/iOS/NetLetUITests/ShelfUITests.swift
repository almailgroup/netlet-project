import XCTest

/// A sideways row of products keeps every card whole — the owner's "fix
/// incomplete or cropped product images in New Arrivals" and "fix the
/// disappearing Sold Out label".
///
/// The demo's `soldout` answers mark basmati rice sold out. It is the last
/// card of New arrivals (the catalogue's oldest), so the row is scrolled to
/// before it is made, and it is the row's tallest card: Notify me under its
/// price. That is the card the old row cut the top off — the top of its photo
/// and the "Sold out" tag drawn on it.
final class ShelfUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testALateTallerCardKeepsItsSoldOutTag() {
        assertWhole(language: "en")
    }

    func testALateTallerCardKeepsItsSoldOutTagInArabic() {
        assertWhole(language: "ar")
    }

    /// The row as it was, behind the diagnosis switch: says whether it cut the
    /// tag off, and fails nothing — the answer to "was that the cause".
    func testTheOldRowsCutIsReported() {
        let app = launch(language: "en", oldRow: true)
        guard let found = lateCard(app, language: "en") else {
            print("TEST-NOTE old row: the sold-out card was not reached")
            return
        }
        let cut = found.tag.minY < found.strip.minY - 1
        print("TEST-NOTE old row: tag top \(Int(found.tag.minY)), row top \(Int(found.strip.minY)), row height \(Int(found.strip.height)) — \(cut ? "the tag is cut off" : "the tag is whole")")
    }

    // MARK: The check

    private func assertWhole(language: String, file: StaticString = #filePath, line: UInt = #line) {
        let app = launch(language: language)
        guard let found = lateCard(app, language: language) else {
            keepScreenshot(app)
            return XCTFail("The sold-out card of New arrivals was never reached.", file: file, line: line)
        }
        print("TEST-NOTE new row (\(language)): tag top \(Int(found.tag.minY)), row top \(Int(found.strip.minY)), row height \(Int(found.strip.height))")
        if found.tag.minY < found.strip.minY - 1 || found.tag.maxY > found.strip.maxY + 1 {
            keepScreenshot(app)
        }
        XCTAssertGreaterThanOrEqual(found.tag.minY, found.strip.minY - 1,
                                    "The sold-out card's tag sits above its row's top: the row cut the card's top off.", file: file, line: line)
        XCTAssertLessThanOrEqual(found.tag.maxY, found.strip.maxY + 1,
                                 "The sold-out card's tag is below its row.", file: file, line: line)
        // Every card of the row starts at the row's top: their hearts, drawn
        // over each photo's corner, are level.
        let tops = found.hearts.map(\.minY)
        if let highest = tops.min(), let lowest = tops.max() {
            XCTAssertLessThanOrEqual(lowest - highest, 1,
                                     "The cards of New arrivals start at different heights: \(tops.map { Int($0) }).", file: file, line: line)
            XCTAssertGreaterThanOrEqual(highest, found.strip.minY - 1,
                                        "A card's photo starts above its row's top.", file: file, line: line)
        }
    }

    /// The row under New arrivals scrolled until its sold-out card is on the
    /// screen: where its tag is, where the row is, and the hearts of the cards
    /// on the screen with it.
    private func lateCard(_ app: XCUIApplication, language: String) -> (tag: CGRect, strip: CGRect, hearts: [CGRect])? {
        let arabic = language == "ar"
        let title = arabic ? "وصل حديثاً" : "New arrivals"
        let soldOut = arabic ? "نفدت الكمية" : "Sold out"
        let heartPrefix = arabic ? "احفظ " : "Save "

        let top = app.descendants(matching: .any).matching(identifier: "page-top").firstMatch
        guard top.waitForExistence(timeout: 45) else { return nil }
        sleep(3)

        // The page moved up until the heading is in the screen's upper half.
        let heading = app.staticTexts[title].firstMatch
        let screen = app.frame
        var headingFrame: CGRect?
        for _ in 0..<14 {
            if let place = frame(of: heading), place.minY > 120, place.minY < screen.height * 0.45 {
                headingFrame = place
                break
            }
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        guard let headingFrame else { return nil }

        // The first row of cards under the heading.
        func strip() -> CGRect? {
            let strips = app.scrollViews.matching(identifier: "product-strip")
            return (0..<strips.count)
                .compactMap { frame(of: strips.element(boundBy: $0)) }
                .filter { $0.minY > headingFrame.maxY }
                .min { $0.minY < $1.minY }
        }
        guard let first = strip() else { return nil }

        // Sideways, a card's width or two at a time, toward the row's end —
        // to the left on an English page, to the right on an Arabic one.
        let tags = app.staticTexts.matching(NSPredicate(format: "label == %@", soldOut))
        for _ in 0..<5 {
            if let row = strip(),
               let tag = (0..<tags.count).compactMap({ frame(of: tags.element(boundBy: $0)) })
                   .first(where: { $0.midX > 0 && $0.midX < screen.width && $0.midY > row.minY - 120 && $0.midY < row.maxY }) {
                let hearts = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", heartPrefix))
                let level = (0..<hearts.count)
                    .compactMap { frame(of: hearts.element(boundBy: $0)) }
                    .filter { $0.minX >= 0 && $0.maxX <= screen.width && $0.midY > row.minY - 120 && $0.midY < row.maxY }
                return (tag, row, level)
            }
            let y = (first.minY + 60) / screen.height
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: arabic ? 0.15 : 0.85, dy: y))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: arabic ? 0.6 : 0.4, dy: y))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.4)
            sleep(1)
        }
        return nil
    }

    // MARK: Helpers

    private func launch(language: String, oldRow: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-NetLetDemoAs", "soldout", "-netlet.language", language, "-NetLetUITest", "YES"]
        if oldRow { app.launchArguments += ["-NetLetOldStrip", "YES"] }
        app.launch()
        return app
    }

    /// Where an element is, in one read — nil once it is not drawn.
    private func frame(of element: XCUIElement) -> CGRect? {
        (try? element.snapshot())?.frame
    }

    private func keepScreenshot(_ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "New arrivals"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
