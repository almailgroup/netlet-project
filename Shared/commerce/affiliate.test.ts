import { describe, expect, it } from "vitest";
import { acceptableRate, affiliateCodeFor, canPayOut, lineShareFils, orderShareFils, userIdFromAffiliateCode, withinAttribution } from "./affiliate.js";
import { referralCodeFor, userIdFromCode } from "./referral.js";

describe("codes", () => {
  it("round-trip, and cannot be mistaken for a referral code", () => {
    for (const id of [1, 29, 30, 4242, 999_999]) expect(userIdFromAffiliateCode(affiliateCodeFor(id))).toBe(id);
    expect(affiliateCodeFor(7)).toMatch(/^AF/);
    expect(userIdFromAffiliateCode(referralCodeFor(7))).toBeNull();
    expect(userIdFromCode(affiliateCodeFor(7))).not.toBe(7);
    expect(userIdFromAffiliateCode("AF0O1I")).toBeNull();
    expect(userIdFromAffiliateCode("AFAAAAAAAAAAAA")).toBeNull();
  });
});

describe("the share", () => {
  it("is the rate on the line, rounded down", () => {
    expect(lineShareFils({ lineTotal: "39.500", commissionAmount: "3.950" }, "3.00")).toBe(1185n);
    expect(lineShareFils({ lineTotal: "0.333", commissionAmount: "0.100" }, "3.00")).toBe(9n);
  });

  it("never exceeds what NetLet earned on the line", () => {
    expect(lineShareFils({ lineTotal: "100.000", commissionAmount: "2.000" }, "10.00")).toBe(2000n);
    expect(lineShareFils({ lineTotal: "100.000", commissionAmount: "0.000" }, "10.00")).toBe(0n);
  });

  it("counts only what was sold", () => {
    expect(orderShareFils([
      { lineTotal: "100.000", commissionAmount: "10.000", fulfilment: "delivered" },
      { lineTotal: "50.000", commissionAmount: "5.000", fulfilment: "cancelled" },
      { lineTotal: "20.000", commissionAmount: "2.000", fulfilment: "pending" },
    ], "5.00")).toBe(6000n);
  });
});

describe("attribution", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("lasts thirty days and not a moment from the future", () => {
    expect(withinAttribution("2026-09-03T12:00:00Z", now)).toBe(true);
    expect(withinAttribution("2026-09-01T12:00:00Z", now)).toBe(false);
    expect(withinAttribution("2026-10-05T12:00:00Z", now)).toBe(false);
    expect(withinAttribution("nonsense", now)).toBe(false);
  });
});

describe("rates and payouts", () => {
  it("takes a percentage up to the ceiling, and nothing that is not one", () => {
    expect(acceptableRate("3.00")).toBe(true);
    expect(acceptableRate("20")).toBe(true);
    expect(acceptableRate("20.01")).toBe(false);
    expect(acceptableRate("-1")).toBe(false);
    expect(acceptableRate("3.005")).toBe(false);
  });

  it("pays out from KWD 5, and says how far short a smaller balance is", () => {
    expect(canPayOut(5000n)).toEqual({ ok: true });
    expect(canPayOut(4200n)).toEqual({ ok: false, shortBy: "0.800" });
    expect(canPayOut(-300n)).toEqual({ ok: false, shortBy: "5.000" });
  });
});
