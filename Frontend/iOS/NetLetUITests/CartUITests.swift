import XCTest

/// The bag's line, cleaned up on the owner's word. Its name's row held three
/// 44 × 36 buttons stacked down its end — the menu, where the line goes and a
/// better price — about 108 points tall, so a one-line name was followed by a
/// gap and the price and the stepper sat far below it. Now the row holds the
/// "⋯" alone (the other two are in its menu), the price shares a row with the
/// stepper where both fit, and the stepper is the compact 36. A one-line bag
/// draws no search field: there is nothing to search through.
final class CartUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testALineKeepsItsPriceAndStepperUnderItsName() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
            "-NetLetOpen", "cart", "-NetLetDemoAs", "shopper",
        ]
        app.launch()

        let menu = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "More options for")).firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 15), "The line has no ⋯ menu: \(labels(app))")
        let name = String(menu.label.dropFirst("More options for ".count))
        let plus = app.buttons["More of \(name)"]
        XCTAssertTrue(plus.waitForExistence(timeout: 5), "The line has no plus: \(labels(app))")

        // From the top of the "⋯" to the middle of the stepper: about 80 now,
        // about 170 with the three buttons stacked under the "⋯".
        let rise = plus.frame.midY - menu.frame.minY
        print("TEST-NOTE cart line: menu=\(menu.frame) plus=\(plus.frame) rise=\(rise)")
        XCTAssertLessThan(rise, 120, "The stepper is \(rise) points under the line's menu: the name's row is stretched again. menu \(menu.frame) plus \(plus.frame)")
        XCTAssertLessThanOrEqual(plus.frame.height, 38, "The bag's stepper is not the compact 36: \(plus.frame)")

        // Where it goes and a better price are the menu's, not buttons of their own.
        XCTAssertFalse(app.buttons["Where \(name) goes"].exists, "The line still has its own address button.")
        XCTAssertFalse(app.buttons["Ask for a better price on \(name)"].exists, "The line still has its own price button.")

        // A one-line bag has nothing to search.
        XCTAssertFalse(app.textFields["Search your cart"].exists, "A one-line bag still draws its search field.")

        // The recorded bag's RICE10 takes 0.950 off, and the summary says so once.
        let saving = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "You're saving")).firstMatch
        XCTAssertTrue(saving.waitForExistence(timeout: 5), "The summary does not say what the bag saves.")
        XCTAssertTrue(saving.label.contains("0.950"), "The saving is not the code's 0.950: \(saving.label)")

        // And the menu offers where it goes, Remove last and in view.
        menu.tap()
        let remove = app.buttons["Remove from cart"]
        XCTAssertTrue(remove.waitForExistence(timeout: 6), "The line's menu has no Remove from cart.")
        XCTAssertTrue(app.buttons["Where it goes"].exists, "The line's menu does not offer where it goes: \(labels(app))")
        XCTAssertTrue(remove.isHittable, "Remove from cart is below the menu's foot: \(remove.frame) in \(app.frame)")
    }

    private func labels(_ app: XCUIApplication) -> String {
        app.buttons.allElementsBoundByIndex.prefix(40).map(\.label).joined(separator: " | ")
    }
}
