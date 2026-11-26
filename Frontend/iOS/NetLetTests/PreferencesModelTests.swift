import XCTest
@testable import NetLet

/// The notice groups' switches are the shopper's own or none: before they are
/// read, and when the read fails, nothing is drawn as on or off.
@MainActor
final class PreferencesModelTests: XCTestCase {
    func testSwitchesThatCouldNotBeReadAreNotTheDefaults() async {
        let model = PreferencesModel(api: OfflineAPI(), account: FakeAccountService())
        XCTAssertFalse(model.noticesRead)
        await model.load()
        XCTAssertFalse(model.noticesRead)
        XCTAssertEqual(model.noticesError, .offline)
    }

    func testSwitchesReadFromTheAccountAreDrawn() async {
        let model = PreferencesModel(api: Fixtures.client, account: FakeAccountService())
        await model.load()
        XCTAssertTrue(model.noticesRead)
        XCTAssertNil(model.noticesError)
    }
}
