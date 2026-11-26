import XCTest
@testable import NetLet

/// The Profile tab's tiles and phone, when their reads do not come back: a
/// tile says it could not load, never its empty line ("No orders yet" over
/// an account with orders), and the phone is left unasked rather than
/// offering "Add a phone" over a number the account holds.
@MainActor
final class AccountHomeTests: XCTestCase {
    func testReadsThatFailAreNotAnEmptyAccount() async {
        let account = FakeAccountService()
        account.detailsError = .offline
        let home = AccountHome(api: OfflineAPI(), account: account)
        await home.load(userId: 2, savedIds: ["12"], language: .en, affiliatesOn: true)
        XCTAssertEqual(home.failedTiles, [.orders, .saved, .frequent])
        XCTAssertNil(home.orderPhotos, "no orders were read, so none are drawn as none")
        XCTAssertNil(home.savedPhotos)
        XCTAssertNil(home.frequentPhotos)
        XCTAssertNil(home.phone, "an unread phone is unasked, never \"none saved\"")
    }

    func testReadsThatAnswerClearTheFailure() async {
        let account = FakeAccountService()
        account.detailsError = .offline
        let failing = AccountHome(api: OfflineAPI(), account: account)
        await failing.load(userId: 2, savedIds: [], language: .en, affiliatesOn: true)
        XCTAssertTrue(failing.failedTiles.contains(.orders))

        account.detailsError = nil
        let home = AccountHome(api: Fixtures.client, account: account)
        await home.load(userId: 2, savedIds: [], language: .en, affiliatesOn: true)
        XCTAssertFalse(home.failedTiles.contains(.orders))
        XCTAssertNotNil(home.orderPhotos)
        XCTAssertEqual(home.savedPhotos, [], "nothing saved is none to draw, and no failure")
        XCTAssertFalse(home.failedTiles.contains(.saved))
        XCTAssertNotNil(home.phone)
    }
}
