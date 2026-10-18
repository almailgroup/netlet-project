import { describe, expect, it } from "vitest";
import { canRecordCollection, codAvailability, COD_DEFAULT, type CodGroup } from "./payment.js";

const group = (over: Partial<CodGroup> = {}): CodGroup => ({
  vendorName: "Acme",
  goods: "50.000",
  rule: COD_DEFAULT,
  ...over,
});

describe("whether cash on delivery is available", () => {
  /* On by default: a seller has to opt out, which is what the requirement says. */
  it("is available to a seller who has recorded nothing", () => {
    expect(codAvailability([group()])).toEqual({ available: true });
  });

  it("is refused by a seller who turned it off, and names them", () => {
    const verdict = codAvailability([
      group(),
      group({ vendorName: "Other", rule: { accepts: false, ceiling: null } }),
    ]);
    expect(verdict).toEqual({ available: false, because: { kind: "seller", vendorName: "Other" } });
  });

  /*
   * A basket is one payment. Quietly dropping the seller who said no would be
   * editing somebody's basket to make a button work.
   */
  it("refuses the whole basket for one refusing seller", () => {
    expect(codAvailability([group({ rule: { accepts: false, ceiling: null } }), group()]).available).toBe(false);
  });

  it("refuses a basket over a seller's ceiling, and names the ceiling", () => {
    const verdict = codAvailability([group({ goods: "300.000", rule: { accepts: true, ceiling: "200.000" } })]);
    expect(verdict).toEqual({
      available: false,
      because: { kind: "ceiling", vendorName: "Acme", ceiling: "200.000" },
    });
  });

  it("allows a basket exactly at the ceiling", () => {
    expect(codAvailability([group({ goods: "200.000", rule: { accepts: true, ceiling: "200.000" } })]).available).toBe(true);
  });

  /* A ceiling of zero is not "no cash at all" — `accepts` says that. */
  it("treats a missing or unreadable ceiling as none", () => {
    for (const ceiling of [null, "", "   ", "lots", "0.000"]) {
      expect(codAvailability([group({ goods: "9000.000", rule: { accepts: true, ceiling } })]).available).toBe(true);
    }
  });

  /*
   * The first reason only: a shopper cannot act on four refusals at once, and
   * fixing the first changes the rest.
   */
  it("gives one reason rather than a list", () => {
    const verdict = codAvailability([
      group({ vendorName: "First", rule: { accepts: false, ceiling: null } }),
      group({ vendorName: "Second", rule: { accepts: false, ceiling: null } }),
    ]);
    expect(verdict).toMatchObject({ because: { vendorName: "First" } });
  });
});

describe("what a cash order is", () => {
  /*
   * Nothing has been paid. Saying `paid` at checkout would be recording a
   * payment that has not happened, which the finance panel would then report
   * as revenue.
   */
  it("can be marked collected only while it is unpaid cash", () => {
    expect(canRecordCollection({ status: "pending_payment", paymentMethod: "cod" })).toBe(true);
    expect(canRecordCollection({ status: "paid", paymentMethod: "cod" })).toBe(false);
    expect(canRecordCollection({ status: "pending_payment", paymentMethod: null })).toBe(false);
  });
});
