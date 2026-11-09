import SwiftUI
import XCTest
@testable import NetLet

/// The ring that spreads where the map's pin lands (`PinMark`). A keyframe
/// animator starts its first run from the initial value and every later run
/// from where the last one ended, so the ring is evaluated from both: it must
/// stay between its smallest and largest size and fade from three quarters to
/// nothing, never rising on the way. It once swung to about −12 times its
/// size on the second drop and stayed fully opaque for most of every run.
@MainActor
final class PinRingTests: XCTestCase {
    private func samples(from start: PinMark.Ring) -> [PinMark.Ring] {
        let timeline = KeyframeTimeline(initialValue: start) { PinMark.ringKeyframes(start) }
        return stride(from: 0.0, through: timeline.duration, by: timeline.duration / 70).map { timeline.value(time: $0) }
    }

    private func check(from start: PinMark.Ring, _ name: String) {
        let values = samples(from: start)
        XCTAssertGreaterThan(values.count, 10, name)
        for (index, value) in values.enumerated() {
            XCTAssertGreaterThanOrEqual(value.scale, 0.2 - 0.001, "\(name): scale \(value.scale) at sample \(index)")
            XCTAssertLessThanOrEqual(value.scale, 1.4 + 0.001, "\(name): scale \(value.scale) at sample \(index)")
            XCTAssertGreaterThanOrEqual(value.opacity, -0.001, "\(name): opacity \(value.opacity) at sample \(index)")
            XCTAssertLessThanOrEqual(value.opacity, 0.75 + 0.001, "\(name): opacity \(value.opacity) at sample \(index)")
        }
        for (earlier, later) in zip(values, values.dropFirst()) {
            XCTAssertLessThanOrEqual(later.opacity, earlier.opacity + 0.001, "\(name): the ring grew stronger on the way")
            XCTAssertGreaterThanOrEqual(later.scale, earlier.scale - 0.001, "\(name): the ring shrank on the way")
        }
        XCTAssertEqual(values.first?.scale ?? 0, 0.2, accuracy: 0.01, name)
        XCTAssertEqual(values.first?.opacity ?? 0, 0.75, accuracy: 0.01, name)
        XCTAssertEqual(values.last?.scale ?? 0, 1.4, accuracy: 0.01, name)
        XCTAssertEqual(values.last?.opacity ?? 1, 0, accuracy: 0.01, name)
        XCTAssertEqual(KeyframeTimeline(initialValue: start) { PinMark.ringKeyframes(start) }.duration, 0.7, accuracy: 0.001, name)
    }

    func testTheFirstDropSpreadsAndFades() {
        check(from: PinMark.Ring(), "first drop")
    }

    func testEveryLaterDropStartsFromTheLastOnesEndAndStillSpreadsAndFades() {
        check(from: PinMark.Ring(scale: 1.4, opacity: 0), "later drop")
    }
}
