import Foundation

/// What the product page's price says for the quantity chosen, on the
/// owner's word ("the main price should update automatically based on the
/// selected quantity … clearly display the individual unit price below or
/// beside the total price") — the web's `priceForQuantity`
/// (`Shared/commerce/quantityPrice.ts`), on its own cases
/// (`QuantityPriceTests`).
///
/// The headline is the total: the price of one plus the extras ticked for
/// it (installation and a warranty plan are per unit, as the bag charges
/// them), times how many. The was-price is the same sum on the was-price, so
/// the struck figure less the total is the real saving. The unit line is
/// always drawn, at one too, so the stepper never moves under the thumb when
/// a second line would appear. Whole fils throughout.
struct QuantityPrice: Equatable, Sendable {
    struct Step: Equatable, Sendable {
        let value: Double
        let unit: String
    }

    /// What this many cost, extras included.
    let total: Money
    /// The was-price for this many, extras alike; nil when there is no saving to show.
    let wasTotal: Money?
    /// One of them, extras included — what the unit line names.
    let unit: Money
    /// How many the total is for, at least one.
    let quantity: Int
    let withExtras: Bool
    /// One step of something sold by weight or volume ("500 g"); nil for a counted product.
    let step: Step?

    init(price: Money, compareAt: Money? = nil, quantity: Int, extras: [Money] = [], measure: Measure? = nil) {
        let count = max(1, quantity)
        let extrasEach = extras.reduce(0) { $0 + $1.fils }
        let one = Money(fils: price.fils + extrasEach, currencyCode: price.currencyCode)
        self.unit = one
        self.quantity = count
        self.total = one * count
        if let compareAt, compareAt.fils > price.fils {
            self.wasTotal = Money(fils: compareAt.fils + extrasEach, currencyCode: compareAt.currencyCode) * count
        } else {
            self.wasTotal = nil
        }
        self.withExtras = !extras.isEmpty
        if let measure, let single = ListingRules.shared.measureOf(unit: measure.unit, step: measure.stepAmount, quantity: 1) {
            self.step = Step(value: single.value, unit: single.unit)
        } else {
            self.step = nil
        }
    }

    /// The unit line's sentence, the web's `unitLineKey`.
    var lineKey: String {
        let many = quantity > 1
        if step != nil { return many ? "product.pricePerStepTimes" : "product.pricePerStep" }
        if withExtras { return many ? "product.priceEachTimesExtras" : "product.priceEachExtras" }
        return many ? "product.priceEachTimes" : "product.priceEach"
    }
}
