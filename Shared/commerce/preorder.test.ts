import { describe, expect, it } from "vitest";
import { buyable, fulfilmentFor, maxQuantityFor, offerFor, releaseDate, type StockLevels } from "./preorder.js";

const NOW = new Date("2026-09-23T10:00:00Z");
const SOON = new Date("2026-11-01T00:00:00Z");
const GONE = new Date("2026-02-03T00:00:00Z");

const levels = (stock: number, preorderStock: number, releaseAt: Date | string | null = null): StockLevels =>
  ({ stock, preorderStock, preorderReleaseAt: releaseAt });

describe("which pool serves a quantity", () => {
  it("takes from the shelf whenever the shelf covers it", () => {
    expect(fulfilmentFor(levels(5, 20, SOON), 3, NOW)).toEqual({ kind: "stock" });
    // Exactly enough is still enough — the predicate is >=, not >.
    expect(fulfilmentFor(levels(3, 20, SOON), 3, NOW)).toEqual({ kind: "stock" });
  });

  it("falls through to the pre-order allowance when the shelf cannot", () => {
    expect(fulfilmentFor(levels(0, 20, SOON), 3, NOW)).toEqual({ kind: "preorder", releaseAt: SOON });
  });

  /*
   * The rule the whole module turns on. Three stocked and an order for five is
   * refused, not served as three now and two later: the line is what carries a
   * fulfilment state and a promise, and nobody pressed a button asking for two
   * of those.
   */
  it("never splits a line across the two pools", () => {
    expect(fulfilmentFor(levels(3, 3, SOON), 5, NOW)).toEqual({ kind: "refused" });
    // Neither pool alone covers five, though six units exist between them.
    expect(maxQuantityFor(levels(3, 3))).toBe(3);
  });

  it("refuses when neither pool covers it", () => {
    expect(fulfilmentFor(levels(0, 0), 1, NOW)).toEqual({ kind: "refused" });
    expect(fulfilmentFor(levels(2, 2, SOON), 9, NOW)).toEqual({ kind: "refused" });
  });

  it("refuses a quantity that is not a positive whole number", () => {
    expect(fulfilmentFor(levels(10, 10), 0, NOW)).toEqual({ kind: "refused" });
    expect(fulfilmentFor(levels(10, 10), -2, NOW)).toEqual({ kind: "refused" });
    expect(fulfilmentFor(levels(10, 10), Number.NaN, NOW)).toEqual({ kind: "refused" });
  });
});

describe("what the shop offers before a quantity is picked", () => {
  it("calls a stocked variant stocked and a promised one a pre-order", () => {
    expect(offerFor(levels(4, 0), NOW)).toEqual({ kind: "stock" });
    expect(offerFor(levels(0, 4, SOON), NOW)).toEqual({ kind: "preorder", releaseAt: SOON });
    expect(offerFor(levels(0, 0), NOW)).toEqual({ kind: "refused" });
  });

  it("treats a variant with either pool as buyable", () => {
    expect(buyable(levels(0, 0))).toBe(false);
    expect(buyable(levels(0, 5))).toBe(true);
    expect(buyable(levels(5, 0))).toBe(true);
  });

  /*
   * The ceiling is the larger pool, never the sum, or the stepper would offer
   * a quantity that checkout then refuses — a page arguing with itself.
   */
  it("caps a line at the larger pool", () => {
    expect(maxQuantityFor(levels(3, 10))).toBe(10);
    expect(maxQuantityFor(levels(10, 3))).toBe(10);
    expect(maxQuantityFor(levels(0, 0))).toBe(0);
  });
});

describe("the expected date", () => {
  it("reports a future date", () => {
    expect(releaseDate(levels(0, 5, SOON), NOW)).toEqual(SOON);
  });

  /*
   * "Ships 3 February" read in September says the shop stopped paying
   * attention. Vaguer and true beats precise and stale.
   */
  it("treats a date that has already passed as no date at all", () => {
    expect(releaseDate(levels(0, 5, GONE), NOW)).toBeNull();
    expect(fulfilmentFor(levels(0, 5, GONE), 1, NOW)).toEqual({ kind: "preorder", releaseAt: null });
  });

  it("survives a missing or unparseable date rather than throwing", () => {
    expect(releaseDate(levels(0, 5, null), NOW)).toBeNull();
    expect(releaseDate(levels(0, 5, "not a date"), NOW)).toBeNull();
  });

  it("accepts the string a JSON boundary turns a date into", () => {
    expect(releaseDate(levels(0, 5, SOON.toISOString()), NOW)).toEqual(SOON);
  });
});
