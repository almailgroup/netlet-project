import { describe, expect, it } from "vitest";
import {
  discountOf, giftCardPayment, giftCardRefusal, normaliseCode, settle, voucherRefusal,
  type DiscountCode,
} from "./vouchers.js";

const code = (over: Partial<DiscountCode> = {}): DiscountCode => ({
  code: "WELCOME10",
  kind: "percent",
  value: "10",
  minSpend: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perShopper: 1,
  ...over,
});

const context = (over: Partial<Parameters<typeof voucherRefusal>[1]> = {}) => ({
  goods: "100.000", used: 0, usedByShopper: 0, now: new Date("2026-06-01T12:00:00Z"), ...over,
});

describe("how people type a code", () => {
  /* A code is read off a screenshot or out loud. */
  it("folds case, spaces and dashes", () => {
    expect(normaliseCode(" welcome-10 ")).toBe("WELCOME10");
    expect(normaliseCode("WELCOME 10")).toBe("WELCOME10");
  });
});

describe("whether a code may be used", () => {
  it("takes a live one", () => {
    expect(voucherRefusal(code(), context())).toBeNull();
  });

  /* Not a stored state: the dates decide, so nothing has to run for a code to
     stop working — the decision the discount permit already makes. */
  it("refuses one whose window has passed, and one that has not opened", () => {
    expect(voucherRefusal(code({ endsAt: "2026-05-01" }), context())).toBe("voucher.expired");
    expect(voucherRefusal(code({ startsAt: "2026-07-01" }), context())).toBe("voucher.notYet");
  });

  it("refuses one that has been used up, and one this shopper has had", () => {
    expect(voucherRefusal(code({ maxRedemptions: 5 }), context({ used: 5 }))).toBe("voucher.allUsed");
    expect(voucherRefusal(code(), context({ usedByShopper: 1 }))).toBe("voucher.alreadyUsed");
  });

  it("lets a code be used more than once when it says so", () => {
    expect(voucherRefusal(code({ perShopper: 3 }), context({ usedByShopper: 2 }))).toBeNull();
  });

  /* Five different things a shopper can act on, rather than one shrug. */
  it("refuses a basket below the minimum, and says that is why", () => {
    expect(voucherRefusal(code({ minSpend: "150.000" }), context())).toBe("voucher.belowMinimum");
    expect(voucherRefusal(code({ minSpend: "100.000" }), context())).toBeNull();
  });
});

describe("what a code takes off", () => {
  it("works a percentage out in fils, exactly", () => {
    expect(discountOf({ kind: "percent", value: "10" }, "24.375")).toBe("2.437");
    expect(discountOf({ kind: "percent", value: "12.5" }, "100.000")).toBe("12.500");
  });

  /* Rounding a discount up invents money, the same as rounding a payout up. */
  it("rounds down rather than in anybody's favour", () => {
    expect(discountOf({ kind: "percent", value: "33" }, "0.010")).toBe("0.003");
  });

  /* A discount is not a payout. */
  it("never takes off more than the basket is worth", () => {
    expect(discountOf({ kind: "fixed", value: "5.000" }, "3.000")).toBe("3.000");
    expect(discountOf({ kind: "percent", value: "300" }, "10.000")).toBe("10.000");
  });

  it("is nothing on an empty basket", () => {
    expect(discountOf({ kind: "fixed", value: "5.000" }, "0.000")).toBe("0.000");
  });
});

describe("a gift card", () => {
  it("pays the lesser of what is left and what is owed", () => {
    expect(giftCardPayment("20.000", "12.500")).toBe("12.500");
    expect(giftCardPayment("5.000", "12.500")).toBe("5.000");
  });

  it("refuses an expired or an empty one, and says which", () => {
    expect(giftCardRefusal({ remaining: "10.000", expiresAt: "2026-01-01" }, new Date("2026-06-01"))).toBe("gift.expired");
    expect(giftCardRefusal({ remaining: "0.000", expiresAt: null })).toBe("gift.empty");
    expect(giftCardRefusal({ remaining: "10.000", expiresAt: null })).toBeNull();
  });
});

describe("the whole till", () => {
  /* A code is a discount, points are a discount, a gift card is money — so the
     card goes last, against what is still owed. */
  it("applies the code, then the points, then the card", () => {
    expect(settle({ goods: "100.000", delivery: "1.500", discount: "10.000", points: "1.500", giftCard: "20.000" }))
      .toEqual({ discount: "10.000", points: "1.500", giftCard: "20.000", payable: "70.000" });
  });

  it("never leaves a negative bill, whatever each of them could cover", () => {
    const settled = settle({ goods: "10.000", delivery: "1.500", discount: "20.000", points: "20.000", giftCard: "20.000" });
    expect(settled).toEqual({ discount: "11.500", points: "0.000", giftCard: "0.000", payable: "0.000" });
  });

  it("is the plain total when nothing was applied", () => {
    expect(settle({ goods: "24.500", delivery: "1.500" }).payable).toBe("26.000");
  });
});
