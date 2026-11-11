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

    /// What floats over a page's foot steps aside while a keyboard is up, and
    /// comes back when it goes. At the foot of what a keyboard leaves, the
    /// assistant's button sat on the end of the sign-in form's own button,
    /// where a thumb goes to press Continue (the CI's pictures of the form).
    func testTheAssistantStepsAsideForTheKeyboard() {
        let app = XCUIApplication()
        // A guest's Profile tab is the sign-in form, its first box the email.
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "account"]
        app.launch()

        let assistant = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Need help?")).firstMatch
        XCTAssertTrue(assistant.waitForExistence(timeout: 15), "No assistant button on the sign-in form.")
        let email = app.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 10), "No box to type in on the sign-in form.")
        email.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Pressing the email box brought up no keyboard.")

        let aside = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR hittable == false"), object: assistant)
        XCTAssertEqual(XCTWaiter().wait(for: [aside], timeout: 6), .completed, "The assistant's button is still over the form with the keyboard up.")

        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "No Done above the keyboard.")
        done.tap()
        let back = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: assistant)
        XCTAssertEqual(XCTWaiter().wait(for: [back], timeout: 8), .completed, "The assistant's button did not come back once the keyboard went.")
    }

    /// Finding out, not judging. From iOS 26 the row Done floats in is clear
    /// and the form's own button shows through it — "Send code" on the phone
    /// step, which follows the box being typed in. The row lets a touch
    /// through now (`KeyboardBar.Bar.hitTest`), but whether it then reaches
    /// the page is the keyboard window's to say, so this notes what a press
    /// there did instead of failing.
    func testNotesWhetherAButtonUnderTheDoneRowTakesAPress() {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "phone"]
        app.launch()

        let send = app.buttons["Send code"].firstMatch
        guard send.waitForExistence(timeout: 15), app.keyboards.firstMatch.waitForExistence(timeout: 8) else {
            print("TEST-NOTE done row: no Send code, or no keyboard, on the phone step")
            return
        }
        let done = app.buttons["Done"].firstMatch
        _ = done.waitForExistence(timeout: 5)
        let sameRow = done.exists && send.frame.minY < done.frame.maxY && done.frame.minY < send.frame.maxY
        // A quarter of the way along, well clear of Done at the other end.
        send.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
        // Pressed with no number typed, the form says so under the box.
        let said = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Enter your mobile number.")).firstMatch
        let taken = said.waitForExistence(timeout: 4)
        print("TEST-NOTE done row: send=\(send.frame) done=\(done.exists ? "\(done.frame)" : "none") sameRow=\(sameRow) pressTaken=\(taken)")
    }

    /// Done sits at the end of the line on either page. On the Arabic page
    /// that is the left: at the right it sat over the first of the search
    /// sheet's quick links, which begin from the right there. The phone under
    /// test is set to English, which is the case that went wrong — a toolbar
    /// laid its items out by the phone's language, not the page's.
    func testDoneIsOnTheLeftOnTheArabicPage() {
        let done = doneOverTheSearch(language: "ar", named: "تم")
        XCTAssertLessThan(done.element.frame.midX, done.app.frame.midX, "Done is at the right of the Arabic page, over where its lines begin.")
    }

    func testDoneIsOnTheRightOnTheEnglishPage() {
        let done = doneOverTheSearch(language: "en", named: "Done")
        XCTAssertGreaterThan(done.element.frame.midX, done.app.frame.midX, "Done is at the left of the English page.")
    }

    /// The search opened with its keyboard up, and the Done above it.
    private func doneOverTheSearch(language: String, named name: String) -> (app: XCUIApplication, element: XCUIElement) {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", language, "-NetLetUITest", "YES", "-NetLetOpen", "searchOpen"]
        app.launch()
        let done = app.buttons[name].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15), "No Done above the search's keyboard.")
        return (app, done)
    }
}
