import XCTest

/// The receipt beside the order's title, on the owner's word ("move the
/// download pdf option from the bottom of the order page to here, and include
/// the date of the order as well"): a round PDF button at the end of the
/// title's line — the right in English, the left in Arabic — the date under
/// the title, above Edit order, and no second receipt button at the
/// order's foot. A press makes the receipt and shows it.
final class OrderReceiptUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheReceiptIsBesideTheTitleWithTheDateUnderItInEnglish() {
        check(language: "en", heading: "Order NL-20261001-J7MWY", gone: "In this order", placed: "Ordered on ")
    }

    func testTheReceiptIsBesideTheTitleWithTheDateUnderItInArabic() {
        check(language: "ar", heading: "الطلب NL-20261001-J7MWY", gone: "في هذا الطلب", placed: "تاريخ الطلب:")
    }

    private func check(language: String, heading: String, gone: String, placed: String) {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-20261001-J7MWY", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        let pdf = app.buttons["order-receipt-pdf"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 20), "The order has no PDF button (\(language)): \(labels(app))")
        let title = app.staticTexts[heading]
        XCTAssertTrue(title.exists, "The order's title is not \(heading): \(labels(app))")
        let date = app.staticTexts["order-placed-on"]
        XCTAssertTrue(date.exists, "The order does not say when it was ordered (\(language)).")
        XCTAssertTrue(date.label.hasPrefix(placed), "The date reads \(date.label), not \(placed)…")
        // "In this order" is not drawn, and Edit order is at the row's start
        // (the owner's word: "remove this word … edit order keep it left").
        XCTAssertFalse(app.staticTexts[gone].exists, "\(gone) is still drawn over the items.")
        let inThisOrder = app.buttons["order-edit"]
        XCTAssertTrue(inThisOrder.exists, "No Edit order under the title: \(labels(app))")
        if language == "ar" {
            XCTAssertGreaterThan(inThisOrder.frame.midX, app.windows.firstMatch.frame.midX, "On the Arabic page Edit order is not at the row's start (the right).")
        } else {
            XCTAssertLessThan(inThisOrder.frame.midX, app.windows.firstMatch.frame.midX, "Edit order is not at the row's start (the left).")
        }

        // Beside the title, on its line, at the line's end.
        XCTAssertLessThan(abs(pdf.frame.midY - title.frame.midY), 20, "The PDF button is not on the title's line: pdf \(pdf.frame), title \(title.frame)")
        if language == "ar" {
            XCTAssertLessThan(pdf.frame.midX, title.frame.midX, "On the Arabic page the PDF button is not at the title's end (the left).")
        } else {
            XCTAssertGreaterThan(pdf.frame.midX, title.frame.midX, "The PDF button is not at the title's end (the right).")
        }
        // The date under the title, both above the items.
        XCTAssertGreaterThan(date.frame.minY, title.frame.minY, "The date is not under the title.")
        XCTAssertLessThan(date.frame.maxY, inThisOrder.frame.minY, "The date is not above Edit order.")
        XCTAssertLessThan(pdf.frame.maxY, inThisOrder.frame.minY, "The PDF button is not above Edit order.")

        // One receipt button on the page: none left at the order's foot.
        let receipts = app.buttons.matching(NSPredicate(format: "label == %@", pdf.label))
        XCTAssertEqual(receipts.count, 1, "There is still a second receipt button: \(labels(app))")

        // A press makes the receipt and shows it (Quick Look covers the page).
        pdf.tap()
        var shown = false
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            // Quick Look's own Done, or the page under it no longer reachable.
            if app.buttons["Done"].exists || !pdf.exists || !pdf.isHittable { shown = true; break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        print("TEST-NOTE receipt \(language): pdf=\(pdf.frame) title=\(title.frame) date=\(date.frame) shown=\(shown) done=\(app.buttons["Done"].exists)")
        XCTAssertTrue(shown, "Pressing the PDF button showed no receipt (\(language)): \(labels(app))")
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
