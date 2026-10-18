import { describe, expect, it } from "vitest";
import { addMoney } from "../money.js";
import { byMonth, byVendor, lineOutcome, summarise, takeRate, type FinanceLine } from "./finance.js";

const line = (over: Partial<FinanceLine> = {}): FinanceLine => ({
  orderStatus: "paid",
  placedAt: new Date("2026-09-15T10:00:00Z"),
  vendorId: 1,
  vendorName: "Acme",
  lineTotal: "100.000",
  commissionAmount: "10.000",
  vendorNet: "90.000",
  ...over,
});

describe("what counts", () => {
  it("adds up paid lines", () => {
    const totals = summarise([line(), line({ lineTotal: "50.000", commissionAmount: "5.000", vendorNet: "45.000" })]);
    expect(totals.gross).toBe("150.000");
    expect(totals.commission).toBe("15.000");
    expect(totals.vendorNet).toBe("135.000");
    expect(totals.paidLines).toBe(2);
  });

  /*
   * A basket abandoned at the card form is an intention, not revenue.
   * Counting it would report money the shop never took.
   */
  it("ignores an order that was never paid", () => {
    const totals = summarise([line({ orderStatus: "pending_payment" }), line({ orderStatus: "cancelled" })]);
    expect(totals).toMatchObject({ gross: "0.000", commission: "0.000", paidLines: 0 });
  });

  /*
   * Gross, refunded and net are three numbers. One blended figure hides the
   * refund rate, which is among the first things a finance panel exists to
   * show.
   */
  it("shows refunds rather than blending them away", () => {
    const totals = summarise([line(), line({ orderStatus: "refunded" })]);
    // Two sales of 100 completed and one of them reversed, so 200 was charged,
    // 100 went back, and 100 stuck. Leaving the refunded line out of gross
    // *and* subtracting it would report a net of zero on a shop that kept half.
    expect(totals.gross).toBe("200.000");
    expect(totals.refunded).toBe("100.000");
    expect(totals.net).toBe("100.000");
    expect(totals.paidLines).toBe(1);
    expect(totals.refundedLines).toBe(1);
  });

  /*
   * The identity the panel rests on, and the one that would have caught the
   * bug above on its own: the commission split freezes
   * `commission + net === lineTotal` on every line, so across any set of them
   * NetLet's cut plus what the sellers are owed is exactly what stuck.
   */
  it("reconciles: commission plus what sellers are owed is the net", () => {
    const totals = summarise([
      line(),
      line({ lineTotal: "24.375", commissionAmount: "2.437", vendorNet: "21.938" }),
      line({ orderStatus: "refunded", lineTotal: "40.000" }),
      line({ orderStatus: "cancelled" }),
    ]);
    expect(addMoney(totals.commission, totals.vendorNet)).toBe(totals.net);
    expect(totals.net).toBe("124.375");
  });

  /*
   * If the money went back, NetLet did not keep its cut. Booking commission
   * on a refunded order reports revenue the platform does not have.
   */
  it("reverses commission with the sale", () => {
    const totals = summarise([line({ orderStatus: "refunded" })]);
    expect(totals.commission).toBe("0.000");
    expect(totals.vendorNet).toBe("0.000");
    // It was still charged, and still refunded in full — so nothing stuck.
    expect(totals.gross).toBe("100.000");
    expect(totals.net).toBe("0.000");
  });

  /*
   * Summed in fils. Adding decimal strings pairwise rounds at every step, and
   * a report out by a fil a line is out by real money across a month.
   */
  it("is exact over amounts a float would lose", () => {
    const totals = summarise(Array.from({ length: 3 }, () =>
      line({ lineTotal: "24.375", commissionAmount: "2.437", vendorNet: "21.938" })));
    expect(totals.gross).toBe("73.125");
    expect(totals.commission).toBe("7.311");
    expect(totals.vendorNet).toBe("65.814");
  });

  it("answers zero for no lines at all", () => {
    expect(summarise([])).toMatchObject({ gross: "0.000", net: "0.000", paidLines: 0 });
  });
});

describe("per seller", () => {
  it("groups by vendor, biggest net first", () => {
    const rows = byVendor([
      line({ vendorId: 1, vendorName: "Acme", lineTotal: "50.000" }),
      line({ vendorId: 2, vendorName: "Other", lineTotal: "200.000" }),
      line({ vendorId: 1, vendorName: "Acme", lineTotal: "30.000" }),
    ]);
    expect(rows.map(r => r.vendorName)).toEqual(["Other", "Acme"]);
    expect(rows[1].gross).toBe("80.000");
  });

  /*
   * The name is read off the line, which froze it — a seller who has since
   * been removed or renamed still has to appear in the month they sold in.
   */
  it("keeps a removed vendor's frozen name", () => {
    const rows = byVendor([line({ vendorId: null, vendorName: "Gone Ltd" })]);
    expect(rows[0].vendorName).toBe("Gone Ltd");
    expect(rows[0].vendorId).toBeNull();
  });

  it("falls back to an id when even the name is gone", () => {
    expect(byVendor([line({ vendorId: 7, vendorName: null })])[0].vendorName).toBe("#7");
  });
});

describe("by month", () => {
  it("buckets oldest first as YYYY-MM", () => {
    const rows = byMonth([
      line({ placedAt: new Date("2026-10-02T09:00:00Z") }),
      line({ placedAt: new Date("2026-09-15T09:00:00Z") }),
      line({ placedAt: new Date("2026-09-28T09:00:00Z") }),
    ]);
    expect(rows.map(r => r.month)).toEqual(["2026-09", "2026-10"]);
    expect(rows[0].paidLines).toBe(2);
  });

  it("accepts the string a JSON boundary turns a date into", () => {
    expect(byMonth([line({ placedAt: "2026-09-15T09:00:00Z" })])[0].month).toBe("2026-09");
  });

  it("drops a line whose date cannot be read rather than inventing a bucket", () => {
    expect(byMonth([line({ placedAt: "not a date" })])).toEqual([]);
  });
});

describe("the take rate", () => {
  it("is commission over what stuck, to one decimal", () => {
    expect(takeRate(summarise([line()]))).toBe(10);
    expect(takeRate(summarise([line({ commissionAmount: "12.500" })]))).toBe(12.5);
  });

  /* "0.0%" reads as a fact about the shop. An empty month has no rate. */
  it("is null when nothing sold", () => {
    expect(takeRate(summarise([]))).toBeNull();
    expect(takeRate(summarise([line({ orderStatus: "refunded" })]))).toBeNull();
  });
});

/*
 * A line's own fate, not only its order's status.
 *
 * An order carries one status for every line in it, so a seller cancelling the
 * sofa out of a paid basket left it counted as a sale: NetLet booked commission
 * on it and the report called it revenue. Found by cancelling one line of a real
 * order and reading the panel.
 */
describe("a line that never sold, or came back", () => {
  it("leaves a cancelled line out of every figure, gross included", () => {
    const totals = summarise([line(), line({ fulfilment: "cancelled", lineTotal: "240.000", commissionAmount: "36.000", vendorNet: "204.000" })]);
    expect(totals.gross).toBe("100.000");
    expect(totals.commission).toBe("10.000");
    expect(totals.vendorNet).toBe("90.000");
    expect(totals.paidLines).toBe(1);
  });

  it("counts a returned line as charged and given back, with no cut and nothing owed", () => {
    const totals = summarise([line(), line({ fulfilment: "returned" })]);
    expect(totals.gross).toBe("200.000");
    expect(totals.refunded).toBe("100.000");
    expect(totals.commission).toBe("10.000");
    expect(totals.vendorNet).toBe("90.000");
  });

  /* The identity the report is tested on still holds with both in the mix. */
  it("keeps commission + vendorNet === net", () => {
    const totals = summarise([line(), line({ fulfilment: "cancelled" }), line({ fulfilment: "returned" }), line({ orderStatus: "refunded" })]);
    expect(addMoney(totals.commission, totals.vendorNet)).toBe(totals.net);
  });

  it("classifies by the order first and the line second", () => {
    expect(lineOutcome("pending_payment", "delivered")).toBe("uncounted");
    expect(lineOutcome("paid", "cancelled")).toBe("void");
    expect(lineOutcome("refunded", "cancelled")).toBe("void");
    expect(lineOutcome("paid", "returned")).toBe("refunded");
    expect(lineOutcome("paid", "delivered")).toBe("sold");
    expect(lineOutcome("paid")).toBe("sold");
  });
});
