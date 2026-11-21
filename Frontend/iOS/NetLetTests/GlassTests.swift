import XCTest
@testable import NetLet

/// The face laid over the light blur adds only the white the blur does not:
/// together they are the figure asked for, the web's 60% and 45%.
final class GlassTests: XCTestCase {
    func testTheFaceAndTheBlurTogetherAreTheWhiteAskedFor() {
        for total in [0.45, 0.53, 0.6, 0.7, 0.82] {
            let face = GlassBlur.face(total)
            let together = GlassBlur.ownWhite + (1 - GlassBlur.ownWhite) * face
            XCTAssertEqual(together, total, accuracy: 0.0001, "\(total)")
        }
    }

    func testTheFaceNeverGoesBelowNothingOrPastWhite() {
        XCTAssertEqual(GlassBlur.face(0.1), 0)
        XCTAssertEqual(GlassBlur.face(GlassBlur.ownWhite), 0)
        XCTAssertEqual(GlassBlur.face(1), 1)
    }
}
