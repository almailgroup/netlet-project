import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  fromFils,
  isNegativeMoney,
  isZeroMoney,
  money,
  multiplyMoney,
  percentOf,
  subtractMoney,
  toFils,
} from "./money.js";

describe("toFils", () => {
  it("reads the three places a dinar actually has", () => {
    expect(toFils("24.375")).toBe(24_375n);
    expect(toFils("0.001")).toBe(1n);
    expect(toFils("1")).toBe(1_000n);
    expect(toFils("1.5")).toBe(1_500n);
  });

  it("handles the shapes a database and a form both produce", () => {
    expect(toFils("")).toBe(0n);
    expect(toFils("  7.250  ")).toBe(7_250n);
    expect(toFils(".500")).toBe(500n);
    expect(toFils("-3.125")).toBe(-3_125n);
  });

  /*
   * Truncating rather than rounding is the direction that cannot overcharge:
   * a fourth decimal place is already wrong, and rounding it up would charge
   * more than whoever typed the price meant to.
   */
  it("truncates a fourth decimal place instead of rounding it up", () => {
    expect(toFils("1.9999")).toBe(1_999n);
    expect(toFils("0.0009")).toBe(0n);
  });
});

describe("fromFils", () => {
  it("always writes three places, so a column lines up", () => {
    expect(fromFils(24_375n)).toBe("24.375");
    expect(fromFils(1_000n)).toBe("1.000");
    expect(fromFils(5n)).toBe("0.005");
    expect(fromFils(0n)).toBe("0.000");
    expect(fromFils(-2_500n)).toBe("-2.500");
  });

  it("round-trips anything it produced", () => {
    for (const fils of [0n, 1n, 999n, 1_000n, 24_375n, -7_250n, 1_000_000n]) {
      expect(toFils(fromFils(fils))).toBe(fils);
    }
  });
});

describe("arithmetic", () => {
  /*
   * The case the whole module exists for: 0.1 + 0.2 in binary floating point
   * is 0.30000000000000004, and three of those in a basket is a total that
   * disagrees with the page by a fils.
   */
  it("adds the amounts a float gets wrong", () => {
    expect(addMoney("0.100", "0.200")).toBe("0.300");
    expect(Number("0.1") + Number("0.2")).not.toBe(0.3);
  });

  it("adds a whole basket at once", () => {
    expect(addMoney("24.375", "11.250", "0.005")).toBe("35.630");
    expect(addMoney()).toBe("0.000");
  });

  it("subtracts, including past zero", () => {
    expect(subtractMoney("10.000", "24.375")).toBe("-14.375");
    expect(subtractMoney("24.375", "24.375")).toBe("0.000");
  });

  it("multiplies by a quantity without drifting", () => {
    expect(multiplyMoney("24.375", 4)).toBe("97.500");
    expect(multiplyMoney("0.001", 1000)).toBe("1.000");
  });

  /* A line for −2 or 1.5 of something cannot be bought; it totals nothing. */
  it("refuses a quantity that is not a countable number of items", () => {
    expect(multiplyMoney("24.375", -3)).toBe("0.000");
    expect(multiplyMoney("24.375", 0)).toBe("0.000");
    expect(multiplyMoney("10.000", 2.9)).toBe("20.000");
  });
});

describe("percentOf", () => {
  it("keeps a fractional rate exact", () => {
    expect(percentOf("100.000", "12.5")).toBe("12.500");
    expect(percentOf("24.375", "10")).toBe("2.437");
    expect(percentOf("1.000", "0")).toBe("0.000");
  });

  /*
   * Truncation here rounds NetLet's own cut down rather than the vendor's
   * payout. If the platform is going to lose a fils to rounding, it should be
   * the platform's fils.
   */
  it("truncates its way, not the vendor's", () => {
    expect(percentOf("24.375", "10")).toBe("2.437");
    expect(subtractMoney("24.375", percentOf("24.375", "10"))).toBe("21.938");
  });

  it("treats an unreadable rate as none, rather than as NaN", () => {
    expect(percentOf("50.000", "")).toBe("0.000");
  });
});

describe("predicates", () => {
  it("answers about an amount without the caller parsing it twice", () => {
    expect(isZeroMoney("0.000")).toBe(true);
    expect(isZeroMoney("0")).toBe(true);
    expect(isZeroMoney("0.001")).toBe(false);
    expect(isNegativeMoney("-0.001")).toBe(true);
    expect(isNegativeMoney("0.000")).toBe(false);
  });

  it("compares like a sort comparator", () => {
    expect(compareMoney("1.000", "2.000")).toBe(-1);
    expect(compareMoney("2.000", "1.000")).toBe(1);
    expect(compareMoney("1.5", "1.500")).toBe(0);
    expect(["10.000", "2.000", "1.500"].sort(compareMoney)).toEqual(["1.500", "2.000", "10.000"]);
  });
});

describe("money", () => {
  it("normalises whatever a caller has to the canonical form", () => {
    expect(money("5")).toBe("5.000");
    expect(money("5.1")).toBe("5.100");
    expect(money(5)).toBe("5.000");
    expect(money("5.1000")).toBe("5.100");
  });
});
