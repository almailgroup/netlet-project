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
        XCTAssertEqual(actions([waiting]), ["quantity", "buyAgain", "help", "cancelItems"])
        XCTAssertEqual(actions([single]), ["buyAgain", "help", "cancelItems"])
        XCTAssertEqual(actions([arrived]), ["return", "warranty", "rate", "buyAgain", "help"])
        XCTAssertEqual(actions([gone]), ["help"])
    }

    func testSeveralAreOfferedARefundAcrossThemNeverOneItemsReturnForm() {
        XCTAssertEqual(actions([arrived, waiting]), ["refund", "warranty", "quantity", "rate", "buyAgain", "help", "cancelItems"])
    }

    func testEachActSaysWhichOfTheChosenItIsAbout() {
        let offers = OrderSelection.offers([waiting, single, arrived, gone], cancelled: false)
        let about = Dictionary(uniqueKeysWithValues: offers.map { ($0.action.rawValue, $0.lineIds) })
        XCTAssertEqual(about, [
            "refund": [3],
            "warranty": [3],
            "quantity": [1],
            "rate": [3],
            "buyAgain": [1, 2, 3],
            "help": [1, 2, 3, 4],
            "cancelItems": [1, 2],
        ])
    }

    func testAnOrderCancelledWholeIsOfferedOnlyWhatIsLeftToDo() {
        XCTAssertEqual(actions([gone], cancelled: true), ["help"])
        XCTAssertEqual(actions([OrderSelection.Line(id: 5)], cancelled: true), ["buyAgain", "help"])
    }

    private func wholeActions(_ chosen: [OrderSelection.Line], _ whole: OrderSelection.Whole = .init(), every: Bool = true, cancelled: Bool = false) -> [String] {
        OrderSelection.offers(chosen, cancelled: cancelled, whole: whole, everyChosen: every).map(\.action.rawValue)
    }

    private let open = OrderSelection.Whole(modifiable: true, address: true, cancellable: true)

    func testEveryItemChosenAddsTheOrdersOwnActsAndCancelsTheOrderItself() {
        XCTAssertEqual(
            wholeActions([waiting, single], open),
            ["modify", "buyAgain", "address", "help", "cancelOrder"]
        )
    }

    /// The owner's screenshot crossed them out: where each item is shows under
    /// its photo, the way to pay is changed once for the whole order, and the
    /// receipt is the order's one PDF at its top.
    func testTrackPaymentAndReceiptAreNeverOffered() {
        for chosen in [[waiting], [single], [arrived], [gone], [waiting, single, arrived, gone]] {
            for every in [true, false] {
                let offered = OrderSelection.offers(chosen, cancelled: false, whole: open, everyChosen: every).map(\.action.rawValue)
                for act in ["track", "payment", "receipt"] {
                    XCTAssertFalse(offered.contains(act), "\(act) is offered for \(chosen.map(\.id))")
                }
            }
        }
    }

    /// The owner's screenshots: one item of an unpaid order of two offered
    /// four acts, and both offered eight.
    func testOneChosenItemOfSeveralIsOfferedTheOrdersActsTooAndOnlyCancelItems() {
        XCTAssertEqual(
            wholeActions([single], open, every: false),
            ["modify", "buyAgain", "address", "help", "cancelItems"]
        )
        XCTAssertEqual(
            wholeActions([waiting], open, every: false),
            ["quantity", "modify", "buyAgain", "address", "help", "cancelItems"]
        )
        let one = Set(wholeActions([single], open, every: false))
        for action in wholeActions([waiting, single], open) {
            XCTAssertTrue(one.contains(action) || action == "cancelOrder", action)
        }
    }

    func testTheOrdersActsAreAboutEverythingChosenTheItemsAboutTheItem() {
        let offers = OrderSelection.offers([waiting], cancelled: false, whole: open, everyChosen: false)
        let about = Dictionary(uniqueKeysWithValues: offers.map { ($0.action.rawValue, $0.lineIds) })
        XCTAssertEqual(about["cancelItems"], [1])
        XCTAssertNil(about["cancelOrder"])
        XCTAssertEqual(about["modify"], [1])
    }

    /// The owner's screenshot: five of eight chosen offered Cancel items and
    /// Cancel order side by side. The order is cancelled only from All.
    func testCancelOrderOnlyWithEveryItemChosenNeverBesideCancelItems() {
        XCTAssertFalse(wholeActions([waiting, single], open, every: false).contains("cancelOrder"))
        XCTAssertTrue(wholeActions([waiting, single], open, every: false).contains("cancelItems"))
        XCTAssertTrue(wholeActions([waiting, single], open).contains("cancelOrder"))
        XCTAssertFalse(wholeActions([waiting, single], open).contains("cancelItems"))
    }

    func testOnlyWhatTheOrderAllowsIsOffered() {
        XCTAssertEqual(wholeActions([arrived]), ["return", "warranty", "rate", "buyAgain", "help"])
        XCTAssertEqual(wholeActions([arrived], every: false), ["return", "warranty", "rate", "buyAgain", "help"])
        XCTAssertEqual(wholeActions([gone], cancelled: true), ["help"])
    }

    func testTheOrdersChangeFormIsOfferedWhileAnyItemOfTheOrderMayChange() {
        XCTAssertTrue(wholeActions([arrived], .init(modifiable: true), every: false).contains("modify"))
        XCTAssertFalse(wholeActions([arrived], .init(modifiable: false), every: false).contains("modify"))
    }

    func testEveryItemChosenCancelsTheItemsThatMayWhenTheOrderCannotBeCancelledWhole() {
        XCTAssertEqual(
            wholeActions([waiting, arrived], .init(modifiable: true, address: true)),
            ["refund", "warranty", "modify", "rate", "buyAgain", "address", "help", "cancelItems"]
        )
        let offers = OrderSelection.offers([waiting, arrived], cancelled: false, whole: .init(modifiable: true), everyChosen: true)
        XCTAssertEqual(offers.first { $0.action == .cancelItems }?.lineIds, [1])
        XCTAssertEqual(offers.first { $0.action == .modify }?.lineIds, [1, 3])
        XCTAssertNil(offers.first { $0.action == .address })
    }

    func testOnlyTheItemsActsWithoutTheOrdersFacts() {
        XCTAssertEqual(actions([waiting, single]), ["quantity", "buyAgain", "help", "cancelItems"])
        XCTAssertFalse(actions([waiting, single]).contains("modify"))
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
