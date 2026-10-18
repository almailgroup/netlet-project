import { describe, expect, it } from "vitest";
import { grantWindow, isActive, memberPriceFor, memberPriceProblem, memberUntil, validMonths, waiveDelivery } from "./membership.js";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const row = (id: number, from: Date, to: Date, cancelledAt: Date | null = null) => ({ id, startsAt: from, endsAt: to, cancelledAt });

describe("who is a member", () => {
  it("is anybody inside a grant that was not ended", () => {
    expect(isActive(row(1, day(1), day(10)), day(5))).toBe(true);
    expect(isActive(row(1, day(1), day(10)), day(10))).toBe(false);
    expect(isActive(row(1, day(1), day(10), day(3)), day(5))).toBe(false);
  });

  it("runs to the end of back-to-back grants", () => {
    expect(memberUntil([row(1, day(1), day(10)), row(2, day(10), day(20))], day(5))).toEqual(day(20));
    expect(memberUntil([row(1, day(12), day(20))], day(5))).toBeNull();
  });
});

describe("a grant", () => {
  it("starts when the current membership ends, so it extends rather than overlaps", () => {
    expect(grantWindow([row(1, day(1), day(10))], 1, day(5))).toEqual({ startsAt: day(10), endsAt: new Date(Date.UTC(2026, 10, 10)) });
    expect(grantWindow([], 2, day(5))).toEqual({ startsAt: day(5), endsAt: new Date(Date.UTC(2026, 11, 5)) });
  });

  it("is whole months, one to twelve", () => {
    expect([0, 1, 12, 13, 1.5].map(validMonths)).toEqual([false, true, true, false, false]);
  });
});

describe("a member price", () => {
  it("is below the shelf and above nothing", () => {
    expect(memberPriceProblem("20.000", "20.000")).toBe("membership.priceNotBelow");
    expect(memberPriceProblem("20.000", "0.000")).toBe("membership.priceZero");
    expect(memberPriceProblem("20.000", "18.500")).toBeNull();
    expect(memberPriceProblem("20.000", null)).toBeNull();
  });

  it("reaches only a member, only while the permit is valid, only while it is still below the shelf", () => {
    const base = { member: true, listPrice: "20.000", memberPrice: "18.000", permitValid: true };
    expect(memberPriceFor(base)).toBe("18.000");
    expect(memberPriceFor({ ...base, member: false })).toBeNull();
    expect(memberPriceFor({ ...base, permitValid: false })).toBeNull();
    expect(memberPriceFor({ ...base, listPrice: "17.000" })).toBeNull();
  });
});

describe("a member's delivery", () => {
  const quote = {
    perVendor: [
      { vendorId: 1, vendorName: "Acme", goods: "12.000", fee: "1.500", free: false, toFree: "8.000" },
      { vendorId: 2, vendorName: "Beta", goods: "30.000", fee: "0.000", free: true, toFree: null },
    ],
    total: "1.500",
  };

  it("is waived, and what each seller charges is kept beside it", () => {
    const waived = waiveDelivery(quote, "42.000", null);
    expect(waived.total).toBe("0.000");
    expect(waived.waived).toBe("1.500");
    expect(waived.perVendor[0]).toMatchObject({ fee: "0.000", free: true, toFree: null, waived: "1.500" });
    expect(waived.perVendor[1]).not.toHaveProperty("waived");
  });

  it("is paid like anybody's under NetLet's minimum", () => {
    expect(waiveDelivery(quote, "42.000", "50.000")).toEqual({ ...quote, waived: "0.000" });
  });
});
