import { describe, expect, it } from "vitest";
import { priceForQuantity, unitLineKey } from "./quantityPrice.js";

const kwd = (amount: string) => ({ amount, currencyCode: "KWD" });

/* The app's QuantityPriceTests holds the same cases. */
describe("priceForQuantity", () => {
  it("is the price at one, with the unit the same", () => {
    const quote = priceForQuantity({ price: kwd("12.500"), quantity: 1 });
    expect(quote).toMatchObject({ total: kwd("12.500"), unit: kwd("12.500"), quantity: 1, wasTotal: null, withExtras: false, step: null });
    expect(unitLineKey(quote)).toBe("product.priceEach");
  });

  it("multiplies in fils, never in floats", () => {
    expect(priceForQuantity({ price: kwd("12.375"), quantity: 3 }).total).toEqual(kwd("37.125"));
    expect(priceForQuantity({ price: kwd("0.100"), quantity: 3 }).total).toEqual(kwd("0.300"));
    expect(priceForQuantity({ price: kwd("24.990"), quantity: 99 }).total).toEqual(kwd("2474.010"));
    expect(unitLineKey(priceForQuantity({ price: kwd("12.375"), quantity: 3 }))).toBe("product.priceEachTimes");
  });

  it("puts the extras ticked in each unit, and says so", () => {
    const quote = priceForQuantity({ price: kwd("120.000"), quantity: 2, extras: [kwd("15.000"), kwd("9.500")] });
    expect(quote.unit).toEqual(kwd("144.500"));
    expect(quote.total).toEqual(kwd("289.000"));
    expect(quote.withExtras).toBe(true);
    expect(unitLineKey(quote)).toBe("product.priceEachTimesExtras");
    expect(unitLineKey(priceForQuantity({ price: kwd("120.000"), quantity: 1, extras: [kwd("15.000")] }))).toBe("product.priceEachExtras");
  });

  it("strikes the was-price for the same many, extras alike, so the gap is the saving", () => {
    const quote = priceForQuantity({ price: kwd("40.000"), compareAt: kwd("50.000"), quantity: 3, extras: [kwd("5.000")] });
    expect(quote.total).toEqual(kwd("135.000"));
    expect(quote.wasTotal).toEqual(kwd("165.000"));
  });

  it("strikes nothing when the was-price is not above the price", () => {
    expect(priceForQuantity({ price: kwd("40.000"), compareAt: kwd("40.000"), quantity: 2 }).wasTotal).toBeNull();
    expect(priceForQuantity({ price: kwd("40.000"), compareAt: kwd("35.000"), quantity: 2 }).wasTotal).toBeNull();
    expect(priceForQuantity({ price: kwd("40.000"), compareAt: null, quantity: 2 }).wasTotal).toBeNull();
  });

  it("holds the quantity to a whole number of at least one", () => {
    for (const quantity of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(priceForQuantity({ price: kwd("5.000"), quantity }).quantity).toBe(1);
    }
    expect(priceForQuantity({ price: kwd("5.000"), quantity: 2.7 }).total).toEqual(kwd("10.000"));
  });

  it("names the step for something sold by weight, not 'each'", () => {
    const quote = priceForQuantity({ price: kwd("0.500"), quantity: 3, measure: { unit: "g", stepAmount: 500 } });
    expect(quote.step).toEqual({ value: 500, unit: "g" });
    expect(quote.total).toEqual(kwd("1.500"));
    expect(unitLineKey(quote)).toBe("product.pricePerStepTimes");
    const kilo = priceForQuantity({ price: kwd("2.000"), quantity: 1, measure: { unit: "kg", stepAmount: 1 } });
    expect(kilo.step).toEqual({ value: 1, unit: "kg" });
    expect(unitLineKey(kilo)).toBe("product.pricePerStep");
    expect(priceForQuantity({ price: kwd("2.000"), quantity: 1, measure: { unit: "each", stepAmount: 1 } }).step).toBeNull();
  });
});
