import XCTest
@testable import NetLet

/// Sets made by arrangement (3.3.11, migration 0091): the answers recorded off
/// the server's own service decode, and the app holds a store's answer to the
/// rule `bundleAnswerProblem` holds it to, on the TypeScript's cases.
final class BundleAgreementTests: XCTestCase {
    let client = Fixtures.client

    private func recorded(_ variant: String) -> TRPCClient {
        TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: variant))
    }

    func testTheOwnersSetSaysWhereEveryStoreStands() async throws {
        let rows = try await recorded("arranged").call(API.bundleRows)
        let set = try XCTUnwrap(rows.first)
        XCTAssertEqual(set.ownerName, "Acme")
        let agreement = try XCTUnwrap(set.agreement)
        XCTAssertFalse(agreement.agreed)
        XCTAssertTrue(agreement.declined)
        XCTAssertEqual(agreement.asked.map(\.state), ["waiting", "declined"])
        XCTAssertEqual(agreement.asked.last?.note, "The vase cannot go below 9.000")
    }

    func testAnAskedStoreSeesItsOwnAnswerAndItsShare() async throws {
        let asked = try await client.call(API.bundlesAsked)
        let set = try XCTUnwrap(asked.first)
        XCTAssertEqual(set.myState, "waiting")
        let rug = try XCTUnwrap(set.members.first { $0.productTitle == "Wool rug" })
        XCTAssertEqual(rug.unitPrice?.amount, "30.000")
        XCTAssertEqual(rug.bundleUnitPrice?.amount, "27.000")
        let waiting = try await client.call(API.bundlesWaiting)
        XCTAssertEqual(waiting.count, 1)
    }

    func testARecordingFromBeforeArrangementsStillDecodes() async throws {
        let rows = try await client.call(API.bundleRows)
        XCTAssertEqual(rows.count, 0)
    }

    func testANameIsShownInThePagesLanguageWhereItHasOne() {
        XCTAssertEqual(inLanguage("Rug", "سجادة", .ar), "سجادة")
        XCTAssertEqual(inLanguage("Rug", "سجادة", .en), "Rug")
        XCTAssertEqual(inLanguage("Rug", nil, .ar), "Rug")
        XCTAssertEqual(inLanguage("Rug", "", .ar), "Rug")
    }

    func testDecliningNeedsWordsAndAgreeingNone() {
        let rules = BundleRules.shared
        XCTAssertEqual(rules.noteMax, 500)
        XCTAssertNil(rules.answerProblem("agreed", nil))
        XCTAssertEqual(rules.answerProblem("declined", "  "), "bundle.declineNeedsNote")
        XCTAssertNil(rules.answerProblem("declined", "Our margin is too thin"))
        XCTAssertEqual(rules.answerProblem("agreed", String(repeating: "x", count: 501)), "bundle.noteTooLong")
    }
}
