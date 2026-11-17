import XCTest
@testable import NetLet

/// The product page's price for the quantity chosen: the app's
/// `QuantityPrice` is `Shared/commerce/quantityPrice.ts`, on
/// `quantityPrice.test.ts`'s own cases.
final class QuantityPriceTests: XCTestCase {
    private func kwd(_ amount: String) -> Money { Money(amount: amount)! }

    func testAtOneItIsThePriceWithTheUnitTheSame() {
        let quote = QuantityPrice(price: kwd("12.500"), quantity: 1)
        XCTAssertEqual(quote.total, kwd("12.500"))
        XCTAssertEqual(quote.unit, kwd("12.500"))
        XCTAssertEqual(quote.quantity, 1)
        XCTAssertNil(quote.wasTotal)
        XCTAssertFalse(quote.withExtras)
        XCTAssertNil(quote.step)
        XCTAssertEqual(quote.lineKey, "product.priceEach")
    }

    func testItMultipliesInFilsNeverInFloats() {
        XCTAssertEqual(QuantityPrice(price: kwd("12.375"), quantity: 3).total, kwd("37.125"))
        XCTAssertEqual(QuantityPrice(price: kwd("0.100"), quantity: 3).total, kwd("0.300"))
        XCTAssertEqual(QuantityPrice(price: kwd("24.990"), quantity: 99).total, kwd("2474.010"))
        XCTAssertEqual(QuantityPrice(price: kwd("12.375"), quantity: 3).lineKey, "product.priceEachTimes")
    }

    func testTheExtrasTickedAreInEachUnitAndSaidSo() {
        let quote = QuantityPrice(price: kwd("120.000"), quantity: 2, extras: [kwd("15.000"), kwd("9.500")])
        XCTAssertEqual(quote.unit, kwd("144.500"))
        XCTAssertEqual(quote.total, kwd("289.000"))
        XCTAssertTrue(quote.withExtras)
        XCTAssertEqual(quote.lineKey, "product.priceEachTimesExtras")
        XCTAssertEqual(QuantityPrice(price: kwd("120.000"), quantity: 1, extras: [kwd("15.000")]).lineKey, "product.priceEachExtras")
    }

    func testTheWasPriceIsStruckForTheSameManyExtrasAlike() {
        let quote = QuantityPrice(price: kwd("40.000"), compareAt: kwd("50.000"), quantity: 3, extras: [kwd("5.000")])
        XCTAssertEqual(quote.total, kwd("135.000"))
        XCTAssertEqual(quote.wasTotal, kwd("165.000"))
    }

    func testNothingIsStruckWhenTheWasPriceIsNotAboveThePrice() {
        XCTAssertNil(QuantityPrice(price: kwd("40.000"), compareAt: kwd("40.000"), quantity: 2).wasTotal)
        XCTAssertNil(QuantityPrice(price: kwd("40.000"), compareAt: kwd("35.000"), quantity: 2).wasTotal)
        XCTAssertNil(QuantityPrice(price: kwd("40.000"), compareAt: nil, quantity: 2).wasTotal)
    }

    func testTheQuantityIsAtLeastOne() {
        for quantity in [0, -3] {
            XCTAssertEqual(QuantityPrice(price: kwd("5.000"), quantity: quantity).quantity, 1)
        }
    }

    func testSomethingSoldByWeightNamesItsStepNotEach() {
        let quote = QuantityPrice(price: kwd("0.500"), quantity: 3, measure: Measure(unit: "g", stepAmount: 500))
        XCTAssertEqual(quote.step, QuantityPrice.Step(value: 500, unit: "g"))
        XCTAssertEqual(quote.total, kwd("1.500"))
        XCTAssertEqual(quote.lineKey, "product.pricePerStepTimes")
        let kilo = QuantityPrice(price: kwd("2.000"), quantity: 1, measure: Measure(unit: "kg", stepAmount: 1))
        XCTAssertEqual(kilo.step, QuantityPrice.Step(value: 1, unit: "kg"))
        XCTAssertEqual(kilo.lineKey, "product.pricePerStep")
        XCTAssertNil(QuantityPrice(price: kwd("2.000"), quantity: 1, measure: Measure(unit: "each", stepAmount: 1)).step)
    }
}
