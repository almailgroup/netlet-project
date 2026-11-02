import XCTest

/// Done above the keyboard, on the owner's word ("add an enter button for
/// setting a value … for all the input fields so that the number applies"):
/// it is there over a number pad, which has no return key of its own, and a
/// number typed into a quantity box applies when it is pressed.
final class KeyboardUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testDoneAppliesATypedQuantity() {
        let app = XCUIApplication()
        // The demo answers every product with its earbuds, which the demo bag
        // does not hold, so the box is "how many" and typing sets it.
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "product:wireless-earbuds"]
        app.launch()

        let box = app.textFields["Quantity of Wireless earbuds"]
        XCTAssertTrue(box.waitForExistence(timeout: 10), "No quantity box on the product page.")
        for _ in 0..<6 where !box.isHittable { app.swipeUp() }
        box.tap()

        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "No Done above the number pad.")
        box.typeText("3")
        done.tap()

        // The keyboard goes, and the number typed is the quantity.
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
        expectation(for: NSPredicate(format: "value == %@", "3"), evaluatedWith: box)
        waitForExpectations(timeout: 6)
    }
}
