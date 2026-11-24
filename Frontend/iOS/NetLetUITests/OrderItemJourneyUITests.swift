import XCTest

/// Where each item is, on the owner's word: My orders' rows carry the order's
/// main facts and no status ("in this page will show you only the main
/// info"); the opened order draws one status under every item's photo, each
/// read off that item alone ("delivery status should shown here"); and once
/// an item has arrived, that place is its review ("once it shown delivered,
/// then review icon will appear out here") — Rate, or Edit once rated.
final class OrderItemJourneyUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheListHasNoStatusAndEachItemHasItsOwnInEnglish() {
        check(language: "en", dated: "Ordered on ", words: ["Order received", "Being prepared"])
    }

    func testTheListHasNoStatusAndEachItemHasItsOwnInArabic() {
        check(language: "ar", dated: "تاريخ الطلب:", words: ["تم استلام الطلب", "قيد التجهيز"])
    }

    func testADeliveredItemOffersRatingUnderItsPhoto() {
        let app = launch(language: "en", open: "order:NL-20261001-J7MWY", as: "shopper")
        let rate = app.buttons.matching(NSPredicate(format: "label == %@", "Rate USB-C charger 65W")).firstMatch
        XCTAssertTrue(rate.waitForExistence(timeout: 20), "The delivered item offers no Rate under its photo: \(labels(app))")
        XCTAssertEqual(statuses(app).count, 1, "The order of one item draws \(statuses(app).count) statuses.")
        rate.tap()
        let sheet = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Rate this item")).firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 10), "Rate did not open the review: \(labels(app))")
    }

    func testARatedItemOffersEditingUnderItsPhoto() {
        let app = launch(language: "en", open: "order:NL-WALK-001", as: "claimed")
        let edit = app.buttons.matching(NSPredicate(format: "label == %@", "Edit your review"))
        XCTAssertTrue(edit.firstMatch.waitForExistence(timeout: 20), "A rated item offers no Edit under its photo: \(labels(app))")
        XCTAssertEqual(edit.count, 2, "Each of the two rated items should offer Edit, \(edit.count) did.")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label == %@", "Rate 4K monitor")).firstMatch.exists, "A rated item still offers Rate.")
    }

    private func check(language: String, dated: String, words: [String]) {
        // The list: the main facts of each order, no status.
        let list = launch(language: language, open: "orders", as: "shopper")
        let date = list.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", dated)).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 20), "My orders drew no order (\(language)).")
        XCTAssertEqual(statuses(list).count, 0, "My orders still draws a status on its rows (\(language)).")
        list.terminate()

        // The opened order: one status per item, under its photo, each its own.
        let order = launch(language: language, open: "order:NL-AS-PENDING", as: "pending")
        XCTAssertTrue(statuses(order).firstMatch.waitForExistence(timeout: 20), "The opened order draws no status under its items (\(language)).")
        let opened = statuses(order).allElementsBoundByIndex
        print("TEST-NOTE item status \(language): \(opened.map { "\($0.label) \($0.frame)" })")
        // The recorded pending order holds two items, one pending and one being prepared.
        XCTAssertEqual(opened.count, 2, "The opened order should draw one status per item (two), drew \(opened.count) (\(language)).")
        guard opened.count == 2 else { return }
        XCTAssertLessThan(opened[0].frame.maxY, opened[1].frame.minY, "The two items' statuses are not one under each item, in turn.")
        for (status, word) in zip(opened, words) {
            XCTAssertTrue(status.label.contains(word), "An item's status reads \(status.label), not \(word) (\(language)).")
        }
        // Under the photo, at the item's start: the left in English, the right in Arabic.
        let width = order.windows.firstMatch.frame.width
        if language == "ar" {
            XCTAssertGreaterThan(opened[0].frame.midX, width / 2, "On the Arabic page the status is not at the item's start (the right).")
        } else {
            XCTAssertLessThan(opened[0].frame.midX, width / 2, "The status is not at the item's start (the left).")
        }
    }

    private func launch(language: String, open: String, as who: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
            "-NetLetOpen", open, "-NetLetDemoAs", who,
        ]
        app.launch()
        return app
    }

    private func statuses(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(identifier: "item-status")
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
