import XCTest
@testable import NetLet

/// The number a family finds the lists by is the account's own or unread:
/// a failed read drew the "add a number" form and "a number is needed" under
/// every public list, over a number the account holds.
@MainActor
final class WishlistPhoneTests: XCTestCase {
    /// No lists; the number answers `number`, or fails when it is nil.
    private struct PhoneAPI: APICalling {
        let number: String?

        func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
            throw APIError.offline
        }

        func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
            switch procedure.path {
            case "wishlists.mine":
                guard let answer = [WishlistSummary]() as? Output else { throw APIError.offline }
                return answer
            case "wishlists.phone":
                guard let number, let answer = number as? Output else { throw APIError.offline }
                return answer
            default:
                throw APIError.offline
            }
        }
    }

    func testANumberThatCouldNotBeReadIsNotNone() async {
        let model = WishlistsModel(api: PhoneAPI(number: nil))
        await model.load()
        XCTAssertFalse(model.phoneRead, "The card asked for a number it had not read.")
        XCTAssertTrue(model.phoneUnread)
        XCTAssertNil(model.phone)
    }

    func testTheAccountsNumberIsRead() async {
        let model = WishlistsModel(api: PhoneAPI(number: "55001122"))
        await model.load()
        XCTAssertTrue(model.phoneRead)
        XCTAssertFalse(model.phoneUnread)
        XCTAssertEqual(model.phone, "55001122")
    }
}
