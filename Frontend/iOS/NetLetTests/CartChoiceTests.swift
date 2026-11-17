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

    // Unticking moves to Saved for later — `untickPlan`'s own cases. Line 2
    // carries an extra, 5 has no product said, and 6 and 7 are a set (bundle
    // 8) whose second line has none.
    private let shelf = [
        CartChoice.Savable(lineId: "1", productId: "p1"),
        CartChoice.Savable(lineId: "2", productId: "p2", plain: false),
        CartChoice.Savable(lineId: "3", bundleId: "9", productId: "p3", plain: false),
        CartChoice.Savable(lineId: "4", bundleId: "9", productId: "p4", plain: false),
        CartChoice.Savable(lineId: "5"),
        CartChoice.Savable(lineId: "6", bundleId: "8", productId: "p6"),
        CartChoice.Savable(lineId: "7", bundleId: "8"),
        CartChoice.Savable(lineId: "8", productId: "p1"),
    ]

    func testAnUntickedPlainLineMovesToSavedWithUndo() {
        XCTAssertEqual(CartChoice.untick(shelf, ["1"]), .init(move: ["1"], productIds: ["p1"], leave: [], undoable: true))
    }

    func testExtrasAndASetMoveWithoutUndoTheSetWhole() {
        XCTAssertEqual(CartChoice.untick(shelf, ["2"]), .init(move: ["2"], productIds: ["p2"], leave: [], undoable: false))
        XCTAssertEqual(CartChoice.untick(shelf, ["4"]), .init(move: ["3", "4"], productIds: ["p3", "p4"], leave: [], undoable: false))
    }

    func testWhatCannotBeSavedIsLeftOutAndSuchASetStaysTogether() {
        XCTAssertEqual(CartChoice.untick(shelf, ["5"]), .init(move: [], productIds: [], leave: ["5"], undoable: false))
        XCTAssertEqual(CartChoice.untick(shelf, ["6"]), .init(move: [], productIds: [], leave: ["6", "7"], undoable: false))
    }

    func testAProductIsSavedOnceAndUnknownIdsAreIgnored() {
        XCTAssertEqual(CartChoice.untick(shelf, ["1", "8", "77"]), .init(move: ["1", "8"], productIds: ["p1"], leave: [], undoable: true))
        XCTAssertEqual(CartChoice.untick(shelf, []), .init(move: [], productIds: [], leave: [], undoable: false))
    }

    func testUntickingAllMovesEverythingThatCanBeSaved() {
        let all = CartChoice.untick(shelf, shelf.map(\.lineId))
        XCTAssertEqual(all.move, ["1", "2", "3", "4", "8"])
        XCTAssertEqual(all.productIds, ["p1", "p2", "p3", "p4"])
        XCTAssertEqual(all.leave, ["5", "6", "7"])
        XCTAssertFalse(all.undoable)
    }

    func testTheRecordedBagSaysEachLinesProduct() async throws {
        let read = try await Fixtures.client.call(API.cart, .init(cartId: "demo"))
        let cart = try XCTUnwrap(read)
        let lines = CartChoice.savable(cart.items)
        XCTAssertFalse(lines.isEmpty)
        let plan = CartChoice.untick(lines, [cart.items[0].lineId])
        XCTAssertEqual(plan.move.count, 1, "a recorded line carries its product, so unticking it moves it")
        XCTAssertTrue(Phrasebook.shared.has("cart.movedToSaved") && Phrasebook.shared.has("cart.untickNote"))
    }
}
