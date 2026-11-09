import XCTest
@testable import NetLet

/// The Preferences switch that turns every haptic in the app off: on until the
/// shopper turns it off, and read from the same key the card writes.
@MainActor
final class HapticsTests: XCTestCase {
    func testHapticsAreOnUntilTurnedOff() {
        UserDefaults.standard.removeObject(forKey: Haptics.enabledKey)
        defer { UserDefaults.standard.removeObject(forKey: Haptics.enabledKey) }
        XCTAssertTrue(Haptics.enabled)
        UserDefaults.standard.set(false, forKey: Haptics.enabledKey)
        XCTAssertFalse(Haptics.enabled)
        // Playing one while off is nothing at all, never a crash.
        Haptics.tap()
        Haptics.refused()
        UserDefaults.standard.set(true, forKey: Haptics.enabledKey)
        XCTAssertTrue(Haptics.enabled)
    }
}
