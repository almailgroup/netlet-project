import XCTest
@testable import NetLet

/// `CartChoice` against the cases `Shared/commerce/cartChoice.test.ts` runs, so
/// the app and the web choose a bag's lines by one rule.
final class CartChoiceTests: XCTestCase {
    /// Two plain lines, and a set of two (bundle 9).
    private let bag = [
        CartChoice.Line(lineId: "1"),
        CartChoice.Line(lineId: "2", bundleId: nil),
        CartChoice.Line(lineId: "3", bundleId: "9"),
        CartChoice.Line(lineId: "4", bundleId: "9"),
    ]

    func testEverythingIsChosenUntilSomethingIsLeftOut() {
        XCTAssertEqual(CartChoice.chosenIds(bag, []), ["1", "2", "3", "4"])
        XCTAssertEqual(CartChoice.state(bag, []), .all)
    }

    func testALineIsLeftOutAndASetWhole() {
        XCTAssertEqual(CartChoice.chosenIds(bag, ["2"]), ["1", "3", "4"])
        XCTAssertEqual(CartChoice.skipped(bag, ["3"]), ["3", "4"])
    }

    func testTogglingALineASetAndPuttingThemBack() {
        let off = CartChoice.choose(bag, [], ["1"], chosen: false)
        XCTAssertEqual(off, ["1"])
        let setOff = CartChoice.choose(bag, off, ["4"], chosen: false)
        XCTAssertEqual(setOff, ["1", "3", "4"])
        XCTAssertEqual(CartChoice.choose(bag, setOff, ["3"], chosen: true), ["1"])
        XCTAssertEqual(CartChoice.choose(bag, setOff, ["1", "2", "3", "4"], chosen: true), [])
    }

    func testAllNoneOrSome() {
        XCTAssertEqual(CartChoice.state(bag, ["1"], of: ["1", "2"]), .some)
        XCTAssertEqual(CartChoice.state(bag, ["1", "2"], of: ["1", "2"]), .none)
        XCTAssertEqual(CartChoice.state(bag, ["1"]), .some)
        XCTAssertEqual(CartChoice.state(bag, ["1", "2", "3"]), .none)
        XCTAssertEqual(CartChoice.state([], []), .none)
    }

    func testBuyNowChoosesOneLineAlone() {
        XCTAssertEqual(CartChoice.only(bag, ["2"]), ["1", "3", "4"])
        XCTAssertEqual(CartChoice.only(bag, []), ["1", "2", "3", "4"])
        XCTAssertEqual(CartChoice.only(bag, ["3"]), ["1", "2"])
    }

    func testForgetsIdsTheBagNoLongerHas() {
        XCTAssertEqual(CartChoice.prune(bag, ["1", "77"]), ["1"])
        XCTAssertEqual(CartChoice.prune(bag, ["4"]), ["3", "4"])
        XCTAssertEqual(CartChoice.prune([], ["1"]), [])
    }

    /// Unticking every line leaves each in the bag, none chosen, on the
    /// owner's word — nothing moves to Saved for later; ticking one back
    /// chooses it alone (the web's case of the same name).
    func testUntickingEveryLineLeavesEachInTheBagAndNoneChosen() {
        let all = bag.map(\.lineId)
        let none = CartChoice.choose(bag, [], all, chosen: false)
        XCTAssertEqual(none, ["1", "2", "3", "4"])
        XCTAssertEqual(CartChoice.chosenIds(bag, none), [])
        XCTAssertEqual(CartChoice.state(bag, none), .none)
        let one = CartChoice.choose(bag, none, ["2"], chosen: true)
        XCTAssertEqual(CartChoice.chosenIds(bag, one), ["2"])
    }

    /// The recorded bag's lines are chosen to start with, and unticking one
    /// keeps every line in the bag.
    func testTheRecordedBagKeepsAnUntickedLine() async throws {
        let read = try await Fixtures.client.call(API.cart, .init(cartId: "demo"))
        let cart = try XCTUnwrap(read)
        let lines = CartChoice.lines(cart.items)
        XCTAssertFalse(lines.isEmpty)
        let skip = CartChoice.choose(lines, [], [cart.items[0].lineId], chosen: false)
        XCTAssertTrue(skip.contains(cart.items[0].lineId))
        XCTAssertEqual(CartChoice.chosenIds(lines, skip).count + skip.count, lines.count)
        XCTAssertFalse(Phrasebook.shared.has("cart.untickNote"), "the note saying an unticked line moves to Saved is gone")
    }
}
