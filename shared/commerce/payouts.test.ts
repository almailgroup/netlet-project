import { describe, expect, it } from "vitest";
import { payoutsByVendor, totalOwed, weekStartOf, weeksFor, type PayoutLine } from "./payouts.js";

/* 2026-09-23 is a Wednesday; its week starts Sunday 2026-09-20. */
const line = (over: Partial<PayoutLine> = {}): PayoutLine => ({
  orderStatus: "paid",
  placedAt: new Date("2026-09-23T10:00:00Z"),
  vendorId: 1,
  vendorName: "Acme",
  lineTotal: "100.000",
  commissionAmount: "10.000",
  vendorNet: "90.000",
  ...over,
});

describe("the week", () => {
  /* Sunday, because the Kuwaiti weekend is Friday and Saturday — a week
     starting Monday would cut one in half. */
  it("runs Sunday to Saturday", () => {
    expect(weekStartOf(new Date("2026-09-23T10:00:00Z"))).toBe("2026-09-20"); // Wed
    expect(weekStartOf(new Date("2026-09-20T00:00:00Z"))).toBe("2026-09-20"); // Sun
    expect(weekStartOf(new Date("2026-09-26T23:59:00Z"))).toBe("2026-09-20"); // Sat
    expect(weekStartOf(new Date("2026-09-27T00:00:00Z"))).toBe("2026-09-27"); // next Sun
  });
});

describe("what a seller is owed", () => {
  it("sums the frozen net, week by week", () => {
    const weeks = weeksFor([line(), line(), line({ placedAt: new Date("2026-09-28T10:00:00Z") })]);
    expect(weeks.map(w => w.weekStart)).toEqual(["2026-09-20", "2026-09-27"]);
    expect(weeks[0]).toMatchObject({ owed: "180.000", commission: "20.000", lines: 2 });
    expect(weeks[1].owed).toBe("90.000");
  });

  /*
   * Subtracted from the week it was sold in. Moving a reversal into a later
   * week makes two weeks wrong to make one look tidy.
   */
  it("takes a refund off the week of the sale", () => {
    const weeks = weeksFor([line(), line({ orderStatus: "refunded" })]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ owed: "0.000", refunded: "100.000", gross: "200.000" });
  });

  /* A zero there is how a payout run quietly overpays. */
  it("shows a negative week rather than clamping it", () => {
    const weeks = weeksFor([line({ orderStatus: "refunded" })]);
    expect(weeks[0].owed).toBe("-90.000");
  });

  it("counts nothing from an order that never completed", () => {
    expect(weeksFor([line({ orderStatus: "pending_payment" }), line({ orderStatus: "cancelled" })])).toEqual([]);
  });

  /* A report padded with empty weeks buries the ones that matter. */
  it("leaves out a week with nothing in it", () => {
    const weeks = weeksFor([line(), line({ placedAt: new Date("2026-10-11T10:00:00Z") })]);
    expect(weeks.map(w => w.weekStart)).toEqual(["2026-09-20", "2026-10-11"]);
  });

  it("drops a line whose date cannot be read rather than inventing a week", () => {
    expect(weeksFor([line({ placedAt: "not a date" })])).toEqual([]);
  });

  it("accepts the string a JSON boundary turns a date into", () => {
    expect(weeksFor([line({ placedAt: "2026-09-23T10:00:00Z" })])[0].weekStart).toBe("2026-09-20");
  });
});

describe("across sellers", () => {
  it("groups by seller, most owed first", () => {
    const payouts = payoutsByVendor([
      line({ vendorId: 1, vendorName: "Acme", vendorNet: "90.000" }),
      line({ vendorId: 2, vendorName: "Other", vendorNet: "300.000" }),
    ]);
    expect(payouts.map(p => p.vendorName)).toEqual(["Other", "Acme"]);
    expect(totalOwed(payouts)).toBe("390.000");
  });

  /* Frozen on the line: a seller who has since left still has to appear in
     the week they sold in. */
  it("keeps a removed seller's name", () => {
    const payouts = payoutsByVendor([line({ vendorId: null, vendorName: "Gone Ltd" })]);
    expect(payouts[0]).toMatchObject({ vendorId: null, vendorName: "Gone Ltd" });
  });

  it("falls back to an id when even the name is gone", () => {
    expect(payoutsByVendor([line({ vendorId: 7, vendorName: null })])[0].vendorName).toBe("#7");
  });

  /*
   * The whole point of freezing: raising a rate in October must not change
   * what was owed in September. Proved by the figures coming off the line.
   */
  it("reads the frozen net rather than any rate", () => {
    const payouts = payoutsByVendor([line({ commissionAmount: "40.000", vendorNet: "60.000" })]);
    expect(payouts[0].owed).toBe("60.000");
  });
});
