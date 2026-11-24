import XCTest

/// Where each item is, on the owner's word ("in this page will show you only
/// the main info, once you click in it each items will show this one because
/// each item has different deliver time"): My orders' rows carry no road, and
/// the opened order draws one under every item, each read off that item alone.
final class OrderItemJourneyUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheListHasNoRoadAndEachItemHasItsOwnInEnglish() {
        check(language: "en", road: "Delivery progress", dated: "Ordered on ")
    }

    func testTheListHasNoRoadAndEachItemHasItsOwnInArabic() {
        check(language: "ar", road: "مراحل التوصيل", dated: "تاريخ الطلب:")
    }

    private func check(language: String, road: String, dated: String) {
        // The list: the main facts of each order, no road.
        let list = XCUIApplication()
        list.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
            "-NetLetOpen", "orders", "-NetLetDemoAs", "shopper",
        ]
        list.launch()
        let date = list.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", dated)).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 20), "My orders drew no order (\(language)).")
        let onList = roads(list, road).count
        print("TEST-NOTE journey list \(language): roads=\(onList)")
        XCTAssertEqual(onList, 0, "My orders still draws a road under its rows (\(language)): \(onList)")
        list.terminate()

        // The opened order: one road per item.
        let order = XCUIApplication()
        order.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
            "-NetLetOpen", "order:NL-AS-PENDING", "-NetLetDemoAs", "pending",
        ]
        order.launch()
        let first = roads(order, road).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20), "The opened order draws no road under its items (\(language)).")
        // The recorded pending order holds two items, one pending and one being prepared.
        let opened = roads(order, road).allElementsBoundByIndex
        print("TEST-NOTE journey order \(language): roads=\(opened.count) frames=\(opened.map(\.frame)) values=\(opened.map { $0.value as? String ?? "" })")
        XCTAssertEqual(opened.count, 2, "The opened order should draw one road per item (two), drew \(opened.count) (\(language)).")
        if opened.count == 2 {
            XCTAssertLessThan(opened[0].frame.maxY, opened[1].frame.minY, "The two items' roads are not one under each item, in turn.")
        }
    }

    private func roads(_ app: XCUIApplication, _ label: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
    }
}
