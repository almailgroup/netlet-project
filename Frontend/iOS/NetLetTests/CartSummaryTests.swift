import XCTest
@testable import NetLet

/// The bag's summary says Free for a delivery that costs nothing, on the
/// owner's word: drawn by store, it printed the sum as it was, and a whole
/// dinar loses its decimals, so free delivery read "KWD 0".
final class CartSummaryTests: XCTestCase {
    @MainActor
    func testNothingToPayForDeliveryReadsFree() {
        let english = LanguageSettings(defaults: UserDefaults(suiteName: "CartSummaryTests-en")!)
        english.set(.en)
        let none = SummaryCard.deliveryValue(.zero, english)
        XCTAssertEqual(none.text, "Free")
        XCTAssertTrue(none.free)
        XCTAssertNotEqual(none.text, Money.zero.formatted(.en), "zero is never printed as a figure")
        // A store's own free delivery is Free whatever its fee says.
        let waived = SummaryCard.deliveryValue(Money(fils: 1_000), free: true, english)
        XCTAssertEqual(waived.text, "Free")
        XCTAssertTrue(waived.free)
    }

    @MainActor
    func testADeliveryThatCostsSomethingIsItsFigure() {
        let english = LanguageSettings(defaults: UserDefaults(suiteName: "CartSummaryTests-fee")!)
        english.set(.en)
        let fee = SummaryCard.deliveryValue(Money(fils: 750), english)
        XCTAssertFalse(fee.free)
        XCTAssertTrue(fee.text.contains("0.750"), fee.text)
    }

    @MainActor
    func testFreeIsSaidInArabicToo() {
        let arabic = LanguageSettings(defaults: UserDefaults(suiteName: "CartSummaryTests-ar")!)
        arabic.set(.ar)
        let none = SummaryCard.deliveryValue(.zero, arabic)
        XCTAssertTrue(none.free)
        XCTAssertEqual(none.text, arabic.t("cart.deliveryFree"))
        XCTAssertNotEqual(none.text, "Free")
    }
}
