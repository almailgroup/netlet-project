import XCTest
@testable import NetLet

/// Checkout's points balance, when it could not be read: unknown and said as
/// such, never zero — a failed read told an account with points it had none.
@MainActor
final class SavingsBalanceTests: XCTestCase {
    func testABalanceThatCouldNotBeReadIsNotZero() async {
        let savings = SavingsModel(api: OfflineAPI())
        await savings.loadBalance(signedIn: true)
        XCTAssertNil(savings.balance, "A failed read must not be a balance of zero.")
        XCTAssertTrue(savings.balanceFailed)
    }

    func testTheRecordedBalanceIsRead() async {
        let savings = SavingsModel(api: Fixtures.client)
        await savings.loadBalance(signedIn: true)
        XCTAssertNotNil(savings.balance)
        XCTAssertFalse(savings.balanceFailed)
    }

    func testAGuestHasNoneAndNothingFailed() async {
        let savings = SavingsModel(api: OfflineAPI())
        await savings.loadBalance(signedIn: false)
        XCTAssertEqual(savings.balance, 0)
        XCTAssertFalse(savings.balanceFailed)
    }
}

/// A held code asked about again when the goods change: a question that fails
/// keeps the last answer, so the bill and the order agree about the code.
@MainActor
final class SavingsRequoteTests: XCTestCase {
    /// Answers the quote until `fails` is set, then fails as a phone with no
    /// connection does.
    private final class QuoteAPI: APICalling, @unchecked Sendable {
        let quote = API.VoucherQuote(ok: true, kind: "discount", amount: Money(amount: "1.000")!, remaining: nil, reason: nil)
        var fails = false
        func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
            guard !fails, let answer = quote as? Output else { throw APIError.offline }
            return answer
        }
        func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output { throw APIError.offline }
    }

    func testAFailedRequoteKeepsTheCodesDiscount() async throws {
        let api = QuoteAPI()
        let savings = SavingsModel(api: api)
        let applied = await savings.apply("SAVE1", in: .discount, cartId: "c1")
        XCTAssertTrue(applied)
        XCTAssertEqual(savings.codeQuote?.amount, Money(amount: "1.000"))
        api.fails = true
        await savings.requote(cartId: "c1")
        XCTAssertEqual(savings.codeQuote?.amount, Money(amount: "1.000"),
                       "A re-check that failed dropped the discount while the order still sent the code.")
        XCTAssertEqual(savings.code, "SAVE1")
    }
}
