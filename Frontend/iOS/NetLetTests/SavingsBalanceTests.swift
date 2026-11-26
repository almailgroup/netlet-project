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
