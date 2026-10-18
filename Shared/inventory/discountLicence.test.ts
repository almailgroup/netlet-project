import { describe, expect, it } from "vitest";
import { daysUntilExpiry, discountAllowed, isOffer } from "./discountLicence.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");
const PAST = new Date("2026-09-14T00:00:00Z");

describe("may this vendor advertise a discount", () => {
  it("refuses a vendor who has recorded nothing", () => {
    expect(discountAllowed(null, NOW)).toEqual({ allowed: false, reason: "missing" });
    expect(discountAllowed({}, NOW)).toEqual({ allowed: false, reason: "missing" });
    expect(discountAllowed({ number: "   " }, NOW)).toEqual({ allowed: false, reason: "missing" });
  });

  it("allows a licence inside its window", () => {
    expect(discountAllowed({ number: "MOCI-2026-4471", expiresAt: FUTURE }, NOW)).toEqual({ allowed: true });
  });

  /*
   * The case the whole design turns on: a permit stops being valid without
   * anybody saving anything, so a check only at the moment an offer is created
   * would leave the shop advertising a struck-through price it may no longer
   * advertise.
   */
  it("refuses a licence that has run out, with no write in between", () => {
    expect(discountAllowed({ number: "MOCI-2026-4471", expiresAt: PAST }, NOW))
      .toEqual({ allowed: false, reason: "expired" });
  });

  it("treats the expiry day itself as still valid", () => {
    const today = new Date("2026-09-23T23:59:00Z");
    expect(discountAllowed({ number: "X", expiresAt: today }, NOW)).toEqual({ allowed: true });
  });

  /*
   * A missing expiry is a gap in our form rather than evidence the vendor has
   * no permit. Refusing on it punishes the seller for our missing field — the
   * direction `missingStoreDetails` and the return window both err in.
   */
  it("allows a number with no end date recorded", () => {
    expect(discountAllowed({ number: "MOCI-2026-4471" }, NOW)).toEqual({ allowed: true });
    expect(discountAllowed({ number: "MOCI-2026-4471", expiresAt: null }, NOW)).toEqual({ allowed: true });
    expect(discountAllowed({ number: "MOCI-2026-4471", expiresAt: "not a date" }, NOW)).toEqual({ allowed: true });
  });

  it("accepts the string a JSON boundary turns a date into", () => {
    expect(discountAllowed({ number: "X", expiresAt: FUTURE.toISOString() }, NOW)).toEqual({ allowed: true });
    expect(discountAllowed({ number: "X", expiresAt: PAST.toISOString() }, NOW).allowed).toBe(false);
  });
});

describe("what counts as an offer", () => {
  it("is only a compare-at price above the price", () => {
    expect(isOffer("20.000", "25.000")).toBe(true);
    expect(isOffer("20.000", "20.000")).toBe(false);
    expect(isOffer("20.000", "15.000")).toBe(false);
    expect(isOffer("20.000", null)).toBe(false);
    expect(isOffer("20.000", undefined)).toBe(false);
  });

  it("is not an offer when either figure is not a number", () => {
    expect(isOffer("20.000", "abc")).toBe(false);
    expect(isOffer("abc", "25.000")).toBe(false);
  });
});

describe("how long is left", () => {
  it("counts the days to expiry, and past it", () => {
    expect(daysUntilExpiry({ number: "X", expiresAt: FUTURE }, NOW)).toBe(69);
    expect(daysUntilExpiry({ number: "X", expiresAt: PAST }, NOW)).toBe(-9);
  });

  it("says nothing when there is no licence or no end date", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
    expect(daysUntilExpiry({ number: "X" }, NOW)).toBeNull();
    expect(daysUntilExpiry({ expiresAt: FUTURE }, NOW)).toBeNull();
  });
});
