import XCTest
@testable import NetLet

/// `OrderSelection` against the cases `Shared/commerce/orderSelection.test.ts`
/// runs, so the chosen items of an order offer the same acts on both.
final class OrderSelectionTests: XCTestCase {
    /// Not yet with a driver, three of it.
    private let waiting = OrderSelection.Line(id: 1, quantity: 3, changeable: true)
    /// Not yet with a driver, one of it.
    private let single = OrderSelection.Line(id: 2, changeable: true)
    private let arrived = OrderSelection.Line(id: 3, fulfilment: "delivered", returnable: true, warranty: true, rateable: true)
    private let gone = OrderSelection.Line(id: 4, fulfilment: "cancelled", rebuyable: false)

    private func actions(_ chosen: [OrderSelection.Line], cancelled: Bool = false) -> [String] {
        OrderSelection.offers(chosen, cancelled: cancelled).map(\.action.rawValue)
    }

    func testNothingIsOfferedUntilSomethingIsChosen() {
        XCTAssertEqual(OrderSelection.offers([], cancelled: false), [])
    }

    func testOneItemIsOfferedExactlyItsOwnActsInTheBarsOrder() {
        XCTAssertEqual(actions([waiting]), ["track", "quantity", "buyAgain", "help", "cancelItems"])
        XCTAssertEqual(actions([single]), ["track", "buyAgain", "help", "cancelItems"])
        XCTAssertEqual(actions([arrived]), ["track", "return", "warranty", "rate", "buyAgain", "help"])
        XCTAssertEqual(actions([gone]), ["help"])
    }

    func testSeveralAreOfferedARefundAcrossThemNeverOneItemsReturnForm() {
        XCTAssertEqual(actions([arrived, waiting]), ["track", "refund", "warranty", "quantity", "rate", "buyAgain", "help", "cancelItems"])
    }

    func testEachActSaysWhichOfTheChosenItIsAbout() {
        let offers = OrderSelection.offers([waiting, single, arrived, gone], cancelled: false)
        let about = Dictionary(uniqueKeysWithValues: offers.map { ($0.action.rawValue, $0.lineIds) })
        XCTAssertEqual(about, [
            "track": [1, 2, 3],
            "refund": [3],
            "warranty": [3],
            "quantity": [1],
            "rate": [3],
            "buyAgain": [1, 2, 3],
            "help": [1, 2, 3, 4],
            "cancelItems": [1, 2],
        ])
    }

    func testNothingToFollowOnAnOrderCancelledWhole() {
        XCTAssertEqual(actions([gone], cancelled: true), ["help"])
        XCTAssertEqual(actions([OrderSelection.Line(id: 5)], cancelled: true), ["buyAgain", "help"])
    }

    func testTheAllCircleReadsAllSomeOrNone() {
        XCTAssertEqual(OrderSelection.state(all: [1, 2, 3], chosen: []), .none)
        XCTAssertEqual(OrderSelection.state(all: [1, 2, 3], chosen: [2]), .some)
        XCTAssertEqual(OrderSelection.state(all: [1, 2, 3], chosen: [3, 1, 2]), .all)
        XCTAssertEqual(OrderSelection.state(all: [1, 2], chosen: [1, 9]), .some)
    }

    func testRateOpensTheFirstNotYetReviewedElseTheFirst() {
        let lines: [(id: Int, reviewed: Bool)] = [(1, true), (2, false), (3, false)]
        XCTAssertEqual(OrderSelection.firstToRate(lines, among: [1, 2, 3]), 2)
        XCTAssertEqual(OrderSelection.firstToRate(lines, among: [3, 1]), 3)
        XCTAssertEqual(OrderSelection.firstToRate(lines, among: [1]), 1)
        XCTAssertNil(OrderSelection.firstToRate(lines, among: []))
    }
}
