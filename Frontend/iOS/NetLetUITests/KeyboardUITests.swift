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
        // Slow swipes, so the page moves by the swipe and does not fling: a
        // fling stops wherever the page's length lets it, and could carry the
        // box up under the pinned search row, where nothing can press it.
        for _ in 0..<8 where !box.isHittable { app.swipeUp(velocity: .slow) }
        XCTAssertTrue(box.isHittable, "The quantity box never came into reach.")
        box.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Pressing the quantity box brought up no keyboard.")

        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "No Done above the number pad.")
        box.typeText("3")
        XCTAssertTrue(done.isHittable, "Done is above the number pad but cannot be pressed.")
        done.tap()

        // The keyboard goes, and the number typed is the quantity.
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 6), .completed, "The keyboard stayed up after Done.")
        let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "3"), object: box)
        XCTAssertEqual(XCTWaiter().wait(for: [applied], timeout: 6), .completed, "Done put the keyboard away but the 3 typed was not applied.")
    }
}
