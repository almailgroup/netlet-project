import XCTest

/// Where each item is, on the owner's word: My orders' rows carry the order's
/// main facts and no status ("in this page will show you only the main
/// info"); the opened order draws a band under every item, each read off that
/// item alone and saying what a press does ("it should be clear, showing
/// status also track order click to be understandable by clients") — Track
/// order while it is coming; and once it has arrived, its review ("once it
/// shown delivered, then review icon will appear out here") — Rate, or Edit
/// once rated.
final class OrderItemJourneyUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheListHasNoStatusAndEachItemHasItsOwnInEnglish() {
        check(language: "en", dated: "Ordered on ", words: ["Order received", "Being prepared"], track: "Track order", tracker: "Track your order")
    }

    func testTheListHasNoStatusAndEachItemHasItsOwnInArabic() {
        check(language: "ar", dated: "تاريخ الطلب:", words: ["تم استلام الطلب", "قيد التجهيز"], track: "تتبّع الطلب", tracker: "تتبّع طلبك")
    }

    func testADeliveredItemOffersRatingUnderItsPhoto() {
        let app = launch(language: "en", open: "order:NL-20261001-J7MWY", as: "shopper")
        let rate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "Rate USB-C charger 65W")).firstMatch
        XCTAssertTrue(rate.waitForExistence(timeout: 20), "The delivered item offers no Rate under it: \(labels(app))")
        XCTAssertTrue(rate.label.hasPrefix("Delivered"), "The delivered item's band does not say it was delivered: \(rate.label)")
        XCTAssertEqual(statuses(app).count, 1, "The order of one item draws \(statuses(app).count) statuses.")
        rate.tap()
        let sheet = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Rate this item")).firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 10), "Rate did not open the review: \(labels(app))")
    }

    func testARatedItemOffersEditingUnderItsPhoto() {
        let app = launch(language: "en", open: "order:NL-WALK-001", as: "claimed")
        let edit = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Edit your review: "))
        XCTAssertTrue(edit.firstMatch.waitForExistence(timeout: 20), "A rated item offers no Edit under it: \(labels(app))")
        XCTAssertEqual(edit.count, 2, "Each of the two rated items should offer Edit, \(edit.count) did.")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "Rate 4K monitor")).firstMatch.exists, "A rated item still offers Rate.")
    }

    private func check(language: String, dated: String, words: [String], track: String, tracker: String) {
        // The list: the main facts of each order, no status.
        let list = launch(language: language, open: "orders", as: "shopper")
        let date = list.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", dated)).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 20), "My orders drew no order (\(language)).")
        XCTAssertEqual(statuses(list).count, 0, "My orders still draws a status on its rows (\(language)).")
        list.terminate()

        // The opened order: one band per item, under it, each its own.
        let order = launch(language: language, open: "order:NL-AS-PENDING", as: "pending")
        XCTAssertTrue(statuses(order).firstMatch.waitForExistence(timeout: 20), "The opened order draws no status under its items (\(language)).")
        let opened = statuses(order).allElementsBoundByIndex
        print("TEST-NOTE item status \(language): \(opened.map { "\($0.label) \($0.frame)" })")
        // The recorded pending order holds two items, one pending and one being prepared.
        XCTAssertEqual(opened.count, 2, "The opened order should draw one status per item (two), drew \(opened.count) (\(language)).")
        guard opened.count == 2 else { return }
        XCTAssertLessThan(opened[0].frame.maxY, opened[1].frame.minY, "The two items' statuses are not one under each item, in turn.")
        for (status, word) in zip(opened, words) {
            XCTAssertTrue(status.label.hasPrefix(word), "An item's status reads \(status.label), not \(word) first (\(language)).")
            // A press saying what it does, and which item it is about.
            XCTAssertEqual(status.elementType, .button, "An item's status is not a press (\(language)).")
            XCTAssertTrue(status.label.contains("\(track): "), "An item's status does not say Track order: \(status.label) (\(language)).")
        }
        // A band the item's width, under its photo.
        let width = order.windows.firstMatch.frame.width
        let photos = order.descendants(matching: .any).matching(identifier: "order-item-photo").allElementsBoundByIndex
        for (index, status) in opened.enumerated() {
            XCTAssertGreaterThan(status.frame.width, width * 0.6, "An item's status is not the item's width (\(status.frame)) (\(language)).")
            if index < photos.count {
                XCTAssertGreaterThanOrEqual(status.frame.minY, photos[index].frame.maxY - 1, "An item's status is not under its photo (\(language)).")
            }
        }
        // The press opens that item's tracker.
        opened[0].tap()
        XCTAssertTrue(order.navigationBars[tracker].waitForExistence(timeout: 8), "Track order did not open the item's tracker (\(language)).")
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
