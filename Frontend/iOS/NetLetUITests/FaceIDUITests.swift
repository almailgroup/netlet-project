import XCTest

/// Face ID is the third way to sign in, and only for an address this phone
/// holds a key for: the recorded demo's phone has one for the demo shopper,
/// so typing that address draws the tile and the Face ID button, and another
/// address takes them away again.
final class FaceIDUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTheTileShowsForTheAddressWithAKeyAndGoesForAnother() {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "faceId"]
        app.launch()

        let signIn = app.buttons["Sign in with Face ID"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 20), "The Face ID button is not drawn for the address with a key.")
        XCTAssertTrue(app.buttons["Face ID"].exists, "The third tile is not drawn.")
        XCTAssertFalse(app.secureTextFields.firstMatch.exists, "Face ID asks for no password.")

        let email = app.textFields.firstMatch
        XCTAssertTrue(email.exists)
        email.tap()
        let typed = (email.value as? String) ?? ""
        email.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count) + "someone@shop.test")
        XCTAssertTrue(gone(app.buttons["Face ID"]), "The tile stayed for an address this phone has no key for.")
        XCTAssertFalse(signIn.exists)
        XCTAssertTrue(app.secureTextFields.firstMatch.exists, "The password box is back.")
    }

    private func gone(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let wait = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [wait], timeout: timeout) == .completed
    }
}
