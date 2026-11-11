import AVFoundation
import SwiftUI
import XCTest
@testable import NetLet

/// The Deals tab's burst (`DealsBurstScene`), which is a function of the time
/// since the press: the bag has to leave from the tab at the icon's own size,
/// come to rest in the middle whole and upright, and be home in the tab again
/// before it goes; the pieces have to fly up and out before they fall, every
/// one of them, and be gone by the end; and its sound has to be in the app.
final class DealsBurstTests: XCTestCase {
    private let screen = CGSize(width: 390, height: 844)
    private let small = DealsBurstScene.tabSide / DealsBurstScene.bagSide

    private var tab: CGPoint { DealsBurstScene.origin(in: screen, bottomInset: 34) }

    private func bag(at time: Double) -> DealsBurstScene.BagState {
        DealsBurstScene.bagState(at: time, from: tab, to: DealsBurstScene.rest(in: screen))
    }

    func testTheBagLeavesFromTheMiddleOfTheTabBarAtTheIconsSize() {
        let start = bag(at: 0)
        XCTAssertEqual(start.centre.x, 195, accuracy: 0.5)
        XCTAssertEqual(start.centre.y, 844 - 34 - 28, accuracy: 0.5)
        XCTAssertEqual(start.scale, small, accuracy: 0.01)
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
        // A moment later it crouches: wider and shorter.
        let crouched = bag(at: DealsBurstScene.landing + 0.08)
        XCTAssertGreaterThan(crouched.stretch.width, 1.1)
        XCTAssertLessThan(crouched.stretch.height, 0.9)
        // The spring that throws the pieces stands it taller than itself.
        XCTAssertGreaterThan(bag(at: DealsBurstScene.pop + 0.12).stretch.height, 1.1)
        // And it is itself again between the throw and the hop home.
        let settled = bag(at: DealsBurstScene.landing + 0.5)
        XCTAssertEqual(settled.stretch.width, 1, accuracy: 0.01)
        XCTAssertEqual(settled.stretch.height, 1, accuracy: 0.01)
        XCTAssertEqual(settled.turn, 0, accuracy: 0.02)
    }

    func testItTurnsOverOnceOnTheWayUp() {
        XCTAssertEqual(bag(at: 0).turn, -2 * Double.pi, accuracy: 0.001)
        XCTAssertLessThan(bag(at: DealsBurstScene.landing * 0.3).turn, -0.5)
    }

    func testItOvershootsOnTheWayAndNeverLeavesTheScreen() {
        let rest = DealsBurstScene.rest(in: screen)
        var highest = CGFloat.greatestFiniteMagnitude
        for step in 0...Int(DealsBurstScene.length * 100) {
            let state = bag(at: Double(step) / 100)
            highest = min(highest, state.centre.y)
            XCTAssertGreaterThan(state.centre.y, 0, "above the screen at \(step)")
            XCTAssertLessThan(state.centre.y, screen.height, "below the screen at \(step)")
            XCTAssertGreaterThan(state.centre.x, 0, "off the left at \(step)")
            XCTAssertLessThan(state.centre.x, screen.width, "off the right at \(step)")
            XCTAssertGreaterThan(state.scale, 0.2, "too small to see at \(step)")
            XCTAssertLessThan(state.scale, 1.2, "larger than itself at \(step)")
            XCTAssertGreaterThanOrEqual(state.opacity, 0)
            XCTAssertLessThanOrEqual(state.opacity, 1)
        }
        XCTAssertLessThan(highest, rest.y, "the leap goes a little past where it rests")
    }

    func testItComesHomeToTheTabAndIsGoneByTheEnd() {
        // Whole until it is home.
        XCTAssertEqual(bag(at: DealsBurstScene.leaving).opacity, 1, accuracy: 0.001)
        let rest = DealsBurstScene.rest(in: screen)
        XCTAssertEqual(bag(at: DealsBurstScene.leaving).centre.y, rest.y, accuracy: 1)
        // Home: where it left from, at the icon's own size, upright again.
        let home = bag(at: DealsBurstScene.home)
        XCTAssertEqual(home.centre.x, tab.x, accuracy: 0.5)
        XCTAssertEqual(home.centre.y, tab.y, accuracy: 0.5)
        XCTAssertEqual(home.scale, small, accuracy: 0.01)
        XCTAssertEqual(home.opacity, 1, accuracy: 0.001)
        XCTAssertEqual(cos(home.turn), 1, accuracy: 0.001)
        // Half-way home it is between the two, and smaller than it was.
        let midway = bag(at: (DealsBurstScene.leaving + DealsBurstScene.home) / 2)
        XCTAssertGreaterThan(midway.centre.y, rest.y - 60)
        XCTAssertLessThan(midway.centre.y, tab.y)
        XCTAssertLessThan(midway.scale, 0.9)
        // Then the tab's own bag is the bag, and the drawn one goes.
        XCTAssertEqual(bag(at: DealsBurstScene.length).opacity, 0, accuracy: 0.001)
        // The beats, in their order.
        XCTAssertLessThan(DealsBurstScene.landing, DealsBurstScene.pop)
        XCTAssertLessThan(DealsBurstScene.pop, DealsBurstScene.second)
        XCTAssertLessThan(DealsBurstScene.second, DealsBurstScene.leaving)
        XCTAssertLessThan(DealsBurstScene.leaving, DealsBurstScene.home)
        XCTAssertLessThan(DealsBurstScene.home, DealsBurstScene.length)
    }

    func testEveryPieceFliesUpAndOutThenFalls() {
        XCTAssertGreaterThanOrEqual(DealsBurstScene.pieces.count, 40)
        // All four kinds are in the burst, in both throws.
        XCTAssertEqual(Set(DealsBurstScene.pieces.map(\.kind)), [0, 1, 2, 3])
        XCTAssertEqual(Set(DealsBurstScene.pieces.map(\.wave)), [0, 1])
        for piece in DealsBurstScene.pieces {
            XCTAssertLessThan(sin(piece.angle), 0, "thrown downward")
            let early = DealsBurstScene.flight(piece, age: 0.15)
            let late = DealsBurstScene.flight(piece, age: 1)
            XCTAssertLessThan(early.y, 0, "not rising at first")
            XCTAssertGreaterThan(late.y, early.y, "not falling by the end")
            XCTAssertLessThan(abs(late.x), 420, "thrown too far to see")
            // The second throw waits for its beat, and nothing outlasts the burst.
            if piece.wave == 1 {
                XCTAssertGreaterThanOrEqual(piece.delay, DealsBurstScene.second - DealsBurstScene.pop)
            }
            XCTAssertLessThanOrEqual(DealsBurstScene.pop + piece.delay + DealsBurstScene.pieceLife, DealsBurstScene.length)
        }
        // Thrown to both sides of the bag.
        XCTAssertTrue(DealsBurstScene.pieces.contains { cos($0.angle) > 0.5 })
        XCTAssertTrue(DealsBurstScene.pieces.contains { cos($0.angle) < -0.5 })
    }

    func testTheSparklesTwinkleWhileTheBagIsThere() {
        XCTAssertGreaterThanOrEqual(DealsBurstScene.sparkles.count, 6)
        for sparkle in DealsBurstScene.sparkles {
            // Begun after the pop and over before the bag leaves for home.
            XCTAssertGreaterThanOrEqual(sparkle.begin, 0)
            XCTAssertLessThan(DealsBurstScene.pop + sparkle.begin + 0.46, DealsBurstScene.leaving + 0.25)
            // Beside the bag, not on it and not off a phone's screen.
            let away = (sparkle.x * sparkle.x + sparkle.y * sparkle.y).squareRoot()
            XCTAssertGreaterThan(away, 0.6)
            XCTAssertLessThan(abs(sparkle.x) * Double(DealsBurstScene.bagSide), 160)
        }
    }

    func testTheCurvesStartAndEndWhereTheySay() {
        XCTAssertEqual(DealsBurstScene.overshoot(0), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.overshoot(1), 1, accuracy: 0.0001)
        XCTAssertGreaterThan(DealsBurstScene.overshoot(0.8), 1)
        XCTAssertEqual(DealsBurstScene.easeOut(2), 1, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.easeIn(-1), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.smooth(0), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.smooth(0.5), 0.5, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.smooth(3), 1, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.bump(0), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.bump(0.5), 1, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.bump(1), 0, accuracy: 0.0001)
        XCTAssertEqual(DealsBurstScene.bump(-2), 0, accuracy: 0.0001)
    }

    /// The sound is in the app, and runs as long as the burst it was made for.
    func testTheSoundIsInTheAppAndAsLongAsTheBurst() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "deals-burst", withExtension: "wav"), "deals-burst.wav is not in the app.")
        let sound = try AVAudioPlayer(contentsOf: url)
        XCTAssertGreaterThanOrEqual(sound.duration, DealsBurstScene.length)
        XCTAssertLessThan(sound.duration, DealsBurstScene.length + 1)
    }
}
