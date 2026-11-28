import XCTest

/// An order on My orders is its pictures, its number, the day it was ordered,
/// what it comes to and how it is paid, and Track order — on the owner's word
/// ("more than one picture of the orders, also order number and date and the
/// amount and payment method and track order only"). It led with its first
/// item's name ("… and 3 more") beside one photo, under Request a refund and
/// Rate your items. Track order opens the order on where its parcels are.
final class OrdersListUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAnOrderRowIsItsFactsAndTrackOrder() {
        for language in ["en", "ar"] {
            let app = XCUIApplication()
            app.launchArguments = [
                "-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES",
                "-NetLetOpen", "orders", "-NetLetDemoAs", "shopper",
            ]
            app.launch()

            let track = app.buttons["orders-track"].firstMatch
            XCTAssertTrue(track.waitForExistence(timeout: 20), "[\(language)] An order has no Track order: \(buttonLabels(app))")
            // The recorded first order is NL-20261019-GNVRV, of four items.
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "NL-20261019-GNVRV")).firstMatch.exists,
                          "[\(language)] The order's number is not on its row.")
            if language == "en" {
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Ordered on ")).firstMatch.exists, "An order does not say when it was ordered.")
                XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", ".* and [0-9]+ more.*")).firstMatch.exists, "An order is still named by its first item and how many more.")
                for gone in ["Request a refund", "Rate your items"] {
                    XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", gone)).firstMatch.exists, "The list still offers \(gone).")
                }
            }

            track.tap()
            let title = language == "en" ? "Track your order" : "تتبّع طلبك"
            let sheet = app.navigationBars[title].firstMatch
            let words = app.staticTexts[title].firstMatch
            XCTAssertTrue(sheet.waitForExistence(timeout: 20) || words.exists, "[\(language)] Track order did not open the order's tracker: \(buttonLabels(app))")
            app.terminate()
        }
    }

    private func buttonLabels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
