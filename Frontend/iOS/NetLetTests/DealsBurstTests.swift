import SwiftUI
import XCTest
@testable import NetLet

/// The Deals tab's burst (`DealsBurstScene`), which is a function of the time
/// since the press: the bag has to leave from the tab, come to rest in the
/// middle whole and upright, and be gone by the end; the pieces have to fly
/// up and out before they fall, every one of them.
final class DealsBurstTests: XCTestCase {
    private let screen = CGSize(width: 390, height: 844)

    private func bag(at time: Double) -> DealsBurstScene.BagState {
        DealsBurstScene.bagState(
            at: time,
            from: DealsBurstScene.origin(in: screen, bottomInset: 34),
            to: DealsBurstScene.rest(in: screen)
        )
    }

    func testTheBagLeavesFromTheMiddleOfTheTabBar() {
        let start = bag(at: 0)
        XCTAssertEqual(start.centre.x, 195, accuracy: 0.5)
        XCTAssertEqual(start.centre.y, 844 - 34 - 28, accuracy: 0.5)
        XCTAssertEqual(start.scale, 0.2, accuracy: 0.01)
        XCTAssertEqual(start.opacity, 1, accuracy: 0.001)
        // On an iPad the bar is along the top.
        XCTAssertEqual(DealsBurstScene.origin(in: screen, bottomInset: 0, barOnTop: true).y, 44, accuracy: 0.5)
    }

    func testItLandsWholeAndUprightInTheMiddle() {
        let landed = bag(at: DealsBurstScene.landing)
        let rest = DealsBurstScene.rest(in: screen)
        XCTAssertEqual(landed.centre.x, rest.x, accuracy: 0.5)
        XCTAssertEqual(landed.centre.y, rest.y, accuracy: 0.5)
        XCTAssertEqual(landed.scale, 1, accuracy: 0.01)
        XCTAssertEqual(landed.turn, 0, accuracy: 0.01)
        XCTAssertEqual(landed.stretch.width, 1, accuracy: 0.01)
        // A moment later it is squashed, and a moment after that itself again.
        XCTAssertGreaterThan(bag(at: DealsBurstScene.landing + 0.12).stretch.width, 1.1)
        XCTAssertEqual(bag(at: DealsBurstScene.landing + 0.3).stretch.width, 1, accuracy: 0.01)
    }

    func testItOvershootsOnTheWayAndNeverLeavesTheScreen() {
        let rest = DealsBurstScene.rest(in: screen)
        var highest = CGFloat.greatestFiniteMagnitude
        for step in 0...150 {
            let state = bag(at: Double(step) / 100)
            highest = min(highest, state.centre.y)
            XCTAssertGreaterThan(state.centre.y, 0, "above the screen at \(step)")
            XCTAssertLessThan(state.centre.y, screen.height, "below the screen at \(step)")
            XCTAssertGreaterThanOrEqual(state.opacity, 0)
            XCTAssertLessThanOrEqual(state.opacity, 1)
        }
        XCTAssertLessThan(highest, rest.y, "the leap goes a little past where it rests")
    }

    func testItIsGoneByTheEnd() {
        XCTAssertEqual(bag(at: DealsBurstScene.leaving).opacity, 1, accuracy: 0.001)
        XCTAssertEqual(bag(at: DealsBurstScene.length).opacity, 0, accuracy: 0.001)
        XCTAssertLessThan(DealsBurstScene.pop, DealsBurstScene.landing)
        XCTAssertLessThan(DealsBurstScene.leaving, DealsBurstScene.length)
    }

    func testEveryPieceFliesUpAndOutThenFalls() {
        XCTAssertGreaterThanOrEqual(DealsBurstScene.pieces.count, 24)
        // All four kinds are in the burst.
        XCTAssertEqual(Set(DealsBurstScene.pieces.map(\.kind)), [0, 1, 2, 3])
        for piece in DealsBurstScene.pieces {
            XCTAssertLessThan(sin(piece.angle), 0, "thrown downward")
            let early = DealsBurstScene.flight(piece, age: 0.15)
            let late = DealsBurstScene.flight(piece, age: 1)
            XCTAssertLessThan(early.y, 0, "not rising at first")
            XCTAssertGreaterThan(late.y, early.y, "not falling by the end")
            XCTAssertLessThan(abs(late.x), 420, "thrown too far to see")
        }
        // Thrown to both sides of the bag.
        XCTAssertTrue(DealsBurstScene.pieces.contains { cos($0.angle) > 0.5 })
        XCTAssertTrue(DealsBurstScene.pieces.contains { cos($0.angle) < -0.5 })
    }

    func testTheCurvesStartAndEndWhereTheySay() {
        XCTAssertEqual(DealsBurstScene.overshoot(0), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.overshoot(1), 1, accuracy: 0.0001)
        XCTAssertGreaterThan(DealsBurstScene.overshoot(0.8), 1)
        XCTAssertEqual(DealsBurstScene.easeOut(2), 1, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.easeIn(-1), 0, accuracy: 0.0001)
    }
}
