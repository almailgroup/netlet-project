import { describe, expect, it } from "vitest";
import {
  baseUnitsFor,
  EACH,
  isMeasured,
  isValidMeasure,
  measureOf,
  unitPrice,
  type Measure,
} from "./units.js";

const bagOfRice: Measure = { unit: "g", stepAmount: 500 };      // a 500 g pack
const looseTomatoes: Measure = { unit: "g", stepAmount: 250 };  // quarter-kilo steps
const oil: Measure = { unit: "ml", stepAmount: 750 };           // a 750 ml bottle
const kettle: Measure = EACH;

describe("counted versus measured", () => {
  it("treats a product with no unit as the shop has always treated it", () => {
    expect(isMeasured(kettle)).toBe(false);
    expect(unitPrice("24.375", kettle)).toBeNull();
    expect(measureOf(kettle, 3)).toBeNull();
    expect(baseUnitsFor(kettle, 3)).toBe(3);
  });

  it("knows mass and volume are measured", () => {
    expect(isMeasured(bagOfRice)).toBe(true);
    expect(isMeasured(oil)).toBe(true);
  });
});

describe("price per canonical unit", () => {
  /* The number the law and the shopper both care about. */
  it("quotes mass per kilo and volume per litre", () => {
    // 500 g for KWD 1.200 is KWD 2.400 a kilo.
    expect(unitPrice("1.200", bagOfRice)).toEqual({ amount: "2.400", unit: "kg" });
    // 750 ml for KWD 3.000 is KWD 4.000 a litre.
    expect(unitPrice("3.000", oil)).toEqual({ amount: "4.000", unit: "l" });
  });

  it("is exact where a float would not be", () => {
    // 250 g at KWD 0.600 → KWD 2.400/kg. In floats this is 2.4000000000000004.
    expect(unitPrice("0.600", looseTomatoes)).toEqual({ amount: "2.400", unit: "kg" });
    // A dinar has three decimals and a binary fraction cannot hold 24.375.
    expect(unitPrice("24.375", { unit: "kg", stepAmount: 1 })).toEqual({ amount: "24.375", unit: "kg" });
  });

  it("rounds once, at the end, to the dinar's three places", () => {
    // 3 × 0.333... — the division happens in fils and rounds half up.
    expect(unitPrice("1.000", { unit: "g", stepAmount: 300 })).toEqual({ amount: "3.333", unit: "kg" });
    expect(unitPrice("1.000", { unit: "g", stepAmount: 600 })).toEqual({ amount: "1.667", unit: "kg" });
  });

  it("already quoted per kilo stays as it is", () => {
    expect(unitPrice("2.400", { unit: "kg", stepAmount: 1 })).toEqual({ amount: "2.400", unit: "kg" });
  });

  it("handles a step larger than the canonical unit", () => {
    // A 2 kg sack at KWD 3.000 is KWD 1.500 a kilo.
    expect(unitPrice("3.000", { unit: "kg", stepAmount: 2 })).toEqual({ amount: "1.500", unit: "kg" });
  });
});

describe("how much a shopper is buying", () => {
  /*
   * The reason quantity can stay an integer: six quarter-kilos is exactly
   * 1.5 kg, with no float anywhere in the path.
   */
  it("adds steps into a whole amount, exactly", () => {
    expect(baseUnitsFor(looseTomatoes, 6)).toBe(1500);
    expect(measureOf(looseTomatoes, 6)).toEqual({ value: 1.5, unit: "kg" });
  });

  it("stays in the small unit below one kilo, the way a label does", () => {
    expect(measureOf(looseTomatoes, 1)).toEqual({ value: 250, unit: "g" });
    expect(measureOf(bagOfRice, 1)).toEqual({ value: 500, unit: "g" });
    // Exactly a kilo switches over.
    expect(measureOf(looseTomatoes, 4)).toEqual({ value: 1, unit: "kg" });
  });

  it("does the same for volume", () => {
    expect(measureOf(oil, 1)).toEqual({ value: 750, unit: "ml" });
    expect(measureOf(oil, 2)).toEqual({ value: 1.5, unit: "l" });
  });

  it("keeps three decimals and no more", () => {
    expect(measureOf({ unit: "g", stepAmount: 1 }, 1001)).toEqual({ value: 1.001, unit: "kg" });
  });
});

describe("what the shop may sell", () => {
  it("refuses a step that is zero or negative", () => {
    expect(isValidMeasure({ unit: "g", stepAmount: 0 })).toBe(false);
    expect(isValidMeasure({ unit: "g", stepAmount: -250 })).toBe(false);
  });

  /*
   * A half-gram step would put the float back in through the other door:
   * `baseUnitsFor` would round, and the arithmetic would stop being exact.
   */
  it("refuses a step that is not a whole number of base units", () => {
    expect(isValidMeasure({ unit: "g", stepAmount: 0.5 })).toBe(false);
    expect(isValidMeasure({ unit: "kg", stepAmount: 0.25 })).toBe(true);   // 250 g, whole
    expect(isValidMeasure({ unit: "kg", stepAmount: 0.0001 })).toBe(false); // a tenth of a gram
  });

  it("insists a counted product has a step of one", () => {
    expect(isValidMeasure({ unit: "each", stepAmount: 1 })).toBe(true);
    expect(isValidMeasure({ unit: "each", stepAmount: 3 })).toBe(false);
  });

  it("refuses a unit it does not know", () => {
    expect(isValidMeasure({ unit: "furlong" as never, stepAmount: 1 })).toBe(false);
  });

  it("refuses a step that is not a number at all", () => {
    expect(isValidMeasure({ unit: "g", stepAmount: Number.NaN })).toBe(false);
    expect(isValidMeasure({ unit: "g", stepAmount: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
