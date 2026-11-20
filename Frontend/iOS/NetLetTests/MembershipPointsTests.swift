import XCTest
@testable import NetLet

/// Membership bought with NetLet points (4.1, on the owner's word): the
/// answers recorded off the server's own service decode, and the app asks
/// what stands in the way, and reads a price NetLet types, on the
/// TypeScript's own cases (`buyProblem`, `pointsPriceOf`).
final class MembershipPointsTests: XCTestCase {
    let client = Fixtures.client

    private func recorded(_ variant: String) -> TRPCClient {
        TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: variant))
    }

    func testAShopperIsOfferedMonthsAtNetLetsPrice() async throws {
        let mine = try await recorded("points").call(API.myMembership)
        XCTAssertFalse(mine.member)
        XCTAssertEqual(mine.pointsPerMonth, 2500)
        XCTAssertEqual(mine.points, 9400)
        let terms = try await recorded("points").call(API.membershipTerms)
        XCTAssertEqual(terms.pointsPerMonth, 2500)
    }

    func testBuyingSaysUntilWhenAndWhatItCost() async throws {
        let bought = try await recorded("points").call(API.buyMembership, .init(months: 3))
        XCTAssertEqual(bought.points, 7500)
        let member = try await recorded("member").call(API.myMembership)
        XCTAssertTrue(member.member)
        XCTAssertEqual(member.until, bought.endsAt)
        XCTAssertEqual(member.points, 1900)
    }

    func testTermsFromBeforePointsStillDecode() async throws {
        let terms = try await client.call(API.membershipTerms)
        XCTAssertEqual(terms.pointsPerMonth, 0)
    }

    func testWhatStandsInTheWayFirstThePriceThenTheMonthsThenThePoints() {
        XCTAssertEqual(MembershipRules.buyProblem(pointsPerMonth: 0, months: 1, balance: 1_000_000_000), "membership.notForSale")
        XCTAssertEqual(MembershipRules.buyProblem(pointsPerMonth: 1000, months: 13, balance: 1_000_000_000), "membership.badMonths")
        XCTAssertEqual(MembershipRules.buyProblem(pointsPerMonth: 1000, months: 3, balance: 2999), "membership.notEnoughPoints")
        XCTAssertNil(MembershipRules.buyProblem(pointsPerMonth: 1000, months: 3, balance: 3000))
        XCTAssertEqual(MembershipRules.cost(5000, 3), 15_000)
    }

    func testAPriceIsWholePointsUnderTheCeiling() {
        XCTAssertEqual(MembershipRules.pointsPrice(" 5000 "), 5000)
        XCTAssertEqual(MembershipRules.pointsPrice("0"), 0)
        XCTAssertEqual(MembershipRules.pointsPrice("٥٠٠٠"), 5000)
        XCTAssertNil(MembershipRules.pointsPrice("5.5"))
        XCTAssertNil(MembershipRules.pointsPrice("-1"))
        XCTAssertNil(MembershipRules.pointsPrice(""))
        XCTAssertNil(MembershipRules.pointsPrice(String(MembershipRules.maxPointsPerMonth + 1)))
    }
}
