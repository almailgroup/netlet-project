import { describe, expect, it } from "vitest";
import { commissionFor, resolveRule, totalCommission } from "./commission.js";

describe("which rule applies", () => {
  it("uses the vendor's when the product sets nothing", () => {
    expect(resolveRule({ percent: "10.00" }, null).source).toBe("vendor");
    expect(resolveRule({ percent: "10.00" }, { percent: null, fixed: null }).source).toBe("vendor");
  });

  it("lets a product override with either half alone", () => {
    expect(resolveRule({ percent: "10.00" }, { percent: "5.00" }).source).toBe("product");
    expect(resolveRule({ percent: "10.00" }, { fixed: "1.000" }).source).toBe("product");
  });

  // The distinction that protects the platform's revenue: a product asking for
  // zero commission is an override; a product asking for nothing is not.
  it("treats an explicit zero as an override, not as absence", () => {
    expect(resolveRule({ percent: "10.00" }, { percent: "0.00" }).source).toBe("product");
  });
});

describe("splitting a line", () => {
  it("takes a percentage exactly, with no float drift", () => {
    const split = commissionFor("24.375", 1, { percent: "10.00" });
    expect(split.gross).toBe("24.375");
    expect(split.commission).toBe("2.437");
    expect(split.net).toBe("21.938");
  });

  it("keeps the three dinar decimals across a quantity", () => {
    const split = commissionFor("24.375", 4, { percent: "12.50" });
    expect(split.gross).toBe("97.500");
    expect(split.commission).toBe("12.187");
  });

  it("charges a fixed fee per item, not per line", () => {
    const split = commissionFor("10.000", 3, { fixed: "0.500" });
    expect(split.commission).toBe("1.500");
  });

  it("adds a percentage and a fixed fee when both are set", () => {
    const split = commissionFor("100.000", 1, { percent: "10.00", fixed: "2.000" });
    expect(split.commission).toBe("12.000");
    expect(split.net).toBe("88.000");
  });

  // A rate card must never make a sale cost the vendor money.
  it("never takes more than the line is worth", () => {
    const split = commissionFor("1.000", 1, { fixed: "5.000" });
    expect(split.commission).toBe("1.000");
    expect(split.net).toBe("0.000");
  });

  it("prefers the product's rule and says so", () => {
    const split = commissionFor("100.000", 1, { percent: "20.00" }, { percent: "5.00" });
    expect(split.commission).toBe("5.000");
    expect(split.source).toBe("product");
  });

  it("charges nothing when no rule is set anywhere", () => {
    const split = commissionFor("50.000", 2, {});
    expect(split.commission).toBe("0.000");
    expect(split.net).toBe("100.000");
  });

  it("handles a zero quantity without producing a negative payout", () => {
    const split = commissionFor("50.000", 0, { percent: "10.00", fixed: "1.000" });
    expect(split.gross).toBe("0.000");
    expect(split.commission).toBe("0.000");
    expect(split.net).toBe("0.000");
  });
});

describe("totalling", () => {
  it("sums an order without drifting", () => {
    const lines = [
      commissionFor("24.375", 3, { percent: "10.00" }),
      commissionFor("12.250", 1, { percent: "10.00" }),
      commissionFor("0.125", 8, { percent: "10.00" }),
    ];
    const total = totalCommission(lines);
    // 73.125 + 12.250 + 1.000 = 86.375
    expect(total.gross).toBe("86.375");
    expect(Number(total.commission) + Number(total.net)).toBeCloseTo(86.375, 3);
  });
});

describe("the standard rate", () => {
  /* One policy in one place: a new store's default and what /sell quotes. */
  it("is what a new store is charged by default", async () => {
    const { vendors } = await import("../../Backend/database/schema.js");
    const { DEFAULT_COMMISSION_PERCENT } = await import("./commission.js");
    expect(vendors.commissionPercent.default).toBe(DEFAULT_COMMISSION_PERCENT);
  });
});
