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

    /// The recorded bag: two of a rice at 4.750 with RICE10 taking 0.950 off,
    /// so it saves the code's figure and nothing else.
    func testABagSavesWhatItsCodesTakeOff() async throws {
        let read = try await Fixtures.client.call(API.cart, .init(cartId: "demo"))
        let cart = try XCTUnwrap(read)
        XCTAssertEqual(cart.codeDiscount?.fils, 950)
        XCTAssertEqual(cart.savings.fils, 950)
    }

    /// An agreed price below the shelf's saves the difference on every unit,
    /// a line left out of this checkout saves nothing, and a member's free
    /// delivery is counted with the rest.
    func testALinesOwnPriceCountsPerUnitAndOnlyWhileChosen() async throws {
        let read = try await Fixtures.client.call(API.cart, .init(cartId: "demo"))
        var cart = try XCTUnwrap(read)
        let line = try XCTUnwrap(cart.items.first)
        XCTAssertEqual(line.unitPrice.fils, 4_750)
        XCTAssertEqual(line.quantity, 2)
        cart.items[0].agreedFrom = Money(fils: 5_000)
        cart.items[0].priceReason = "agreed"
        XCTAssertEqual(cart.savings.fils, 950 + 250 * 2, "the code and 0.250 a unit on two")
        // A shelf price at or under what is charged is no saving.
        cart.items[0].agreedFrom = Money(fils: 4_750)
        XCTAssertEqual(cart.savings.fils, 950)
        cart.items[0].agreedFrom = Money(fils: 5_000)
        cart.items[0].chosen = false
        XCTAssertEqual(cart.savings.fils, 950, "a line left out saves nothing; the code's figure is the server's")
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
