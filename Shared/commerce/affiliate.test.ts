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

describe("a store's own affiliate rate (3.7.1)", () => {
  it("takes the share off the seller's net and passes it through the commission, so the line still adds up", async () => {
    const { withAffiliateShares, netletCommissionFils } = await import("./affiliate.js");
    const draft = {
      lines: [
        { productId: 1, lineTotal: "240.000", commissionAmount: "24.000", vendorNet: "216.000" },
        { productId: 2, lineTotal: "8.000", commissionAmount: "0.800", vendorNet: "7.200" },
      ],
      totals: { commissionTotal: "24.800", itemsTotal: "248.000" },
    };
    const shared = withAffiliateShares(draft, new Map([[1, "3.00"]]));
    expect(shared.lines[0]).toMatchObject({ commissionAmount: "31.200", vendorNet: "208.800", affiliateVendorPercent: "3.00" });
    expect(shared.lines[1]).toMatchObject({ commissionAmount: "0.800", vendorNet: "7.200", affiliateVendorPercent: null });
    expect(shared.totals).toEqual({ commissionTotal: "32.000", itemsTotal: "248.000" });
    /* NetLet's own commission is what it took before the pass-through. */
    expect(netletCommissionFils(shared.lines[0])).toBe(24_000n);
  });

  it("leaves a line out when the seller would net less than the share", async () => {
    const { withAffiliateShares } = await import("./affiliate.js");
    const shared = withAffiliateShares({
      lines: [{ productId: 1, lineTotal: "10.000", commissionAmount: "9.900", vendorNet: "0.100" }],
      totals: { commissionTotal: "9.900" },
    }, new Map([[1, "5.00"]]));
    expect(shared.lines[0]).toMatchObject({ commissionAmount: "9.900", vendorNet: "0.100", affiliateVendorPercent: null });
  });

  it("is a rate above nothing and up to the ceiling", async () => {
    const { storeAffiliateRate } = await import("./affiliate.js");
    expect(storeAffiliateRate("3")).toBe("3.00");
    expect(storeAffiliateRate("20")).toBe("20.00");
    for (const value of ["0", "20.01", "-1", "1.234", "x"]) expect(storeAffiliateRate(value)).toBeNull();
  });
});
