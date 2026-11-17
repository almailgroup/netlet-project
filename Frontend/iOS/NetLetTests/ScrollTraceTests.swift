import XCTest
@testable import NetLet

/// The scroll trace's count of a page's height bouncing between two values —
/// what run 44063612974 saw on the home page before it stood still, a lazy
/// stack measuring the rows after the page's content and guessing them again.
final class ScrollTraceTests: XCTestCase {
    func testTheHomePagesBounceIsCounted() {
        // The heights as that run's trace noted them, every frame or two.
        let readings: [CGFloat] = [2452, 3739, 2452, 3742, 2452, 3746, 2452, 3749]
        XCTAssertEqual(ScrollTrace.flips(in: readings), 6)
    }

    func testSomethingArrivingIsNotABounce() {
        // The shelves landing and then a shelf of guides under them: the page
        // grows twice and never goes back.
        XCTAssertEqual(ScrollTrace.flips(in: [620, 620, 2452, 2452, 2810, 2810]), 0)
        // A skeleton giving way to a shorter shelf is one change, not a bounce.
        XCTAssertEqual(ScrollTrace.flips(in: [3100, 2452]), 0)
    }

    func testSmallChangesInBetweenDoNotHideABounce() {
        XCTAssertEqual(ScrollTrace.flips(in: [2452, 2455, 3739, 3739, 2458]), 1)
    }
}
