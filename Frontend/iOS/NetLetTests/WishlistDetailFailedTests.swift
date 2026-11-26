import XCTest
@testable import NetLet

/// A wishlist whose products could not be read says so: it called every item
/// "no longer available" and Add from Saved "nothing saved yet".
@MainActor
final class WishlistDetailFailedTests: XCTestCase {
    /// The list answers with one item; the products behind it fail.
    private struct ListAPI: APICalling {
        func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
            switch procedure.path {
            case "wishlists.get":
                let detail = WishlistDetail(
                    list: .init(id: 7, title: "Birthday", visibility: "private", ownerName: nil),
                    items: [.init(id: 1, productId: "11", note: nil, quantity: 1)]
                )
                guard let answer = detail as? Output else { throw APIError.offline }
                return answer
            default:
                throw APIError.offline
            }
        }

        func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
            throw APIError.offline
        }
    }

    func testProductsThatCouldNotBeReadAreNotNoLongerAvailable() async {
        let account = FakeAccountService()
        account.saved = ["22"]
        let model = WishlistDetailModel(listId: 7, api: ListAPI(), account: account, language: .en)
        await model.load()
        XCTAssertNotNil(model.detail.value)
        XCTAssertTrue(model.productsUnread)
        XCTAssertFalse(model.settled, "Every item would read “no longer available”.")
        XCTAssertFalse(model.savedUnread)
    }

    func testSavedThatCouldNotBeReadIsNotNothingSaved() async {
        let account = FakeAccountService()
        account.savedError = .offline
        let model = WishlistDetailModel(listId: 7, api: ListAPI(), account: account, language: .en)
        await model.load()
        XCTAssertTrue(model.savedUnread)
    }
}
