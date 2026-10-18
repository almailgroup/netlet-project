import { describe, expect, it } from "vitest";
import { fraudFlags, riskOf, type OrderContext } from "./fraudSignals.js";

const order = (over: Partial<OrderContext> = {}): OrderContext => ({
  grandTotal: "25.000",
  paymentMethod: "cod",
  accountAgeHours: 900,
  ordersLastDay: 1,
  accountsAtAddress: 1,
  ordersAllTime: 6,
  refundedAllTime: 0,
  largestLineQuantity: 1,
  ...over,
});

const signals = (context: OrderContext) => fraudFlags(context).map(flag => flag.signal);

describe("an ordinary order", () => {
  it("is flagged for nothing", () => {
    expect(fraudFlags(order())).toEqual([]);
    expect(riskOf([])).toBe("low");
  });
});

describe("cash, which is where the exposure is", () => {
  /* The goods leave the warehouse before any money exists. */
  it("notices a large cash order", () => {
    expect(signals(order({ grandTotal: "200.000" }))).toContain("highValueCash");
    expect(riskOf(fraudFlags(order({ grandTotal: "400.000" })))).toBe("high");
  });

  /* A card charge-back is a dispute; an uncollected cash order is a van. */
  it("leaves a large card order alone, because that branch waits on payments", () => {
    expect(signals(order({ grandTotal: "400.000", paymentMethod: "card" }))).toEqual([]);
  });

  it("treats a new account paying cash for real money as serious", () => {
    const flags = fraudFlags(order({ accountAgeHours: 2, grandTotal: "80.000" }));
    expect(flags[0]).toMatchObject({ signal: "newAccountHighValue", serious: true });
    expect(flags[0].detail).toMatchObject({ hours: 2, total: "80.000" });
    expect(riskOf(flags)).toBe("high");
  });

  it("does not flag a new account buying something small", () => {
    expect(signals(order({ accountAgeHours: 2, grandTotal: "12.000" }))).toEqual([]);
  });
});

describe("patterns across accounts and time", () => {
  /* Ambiguous on purpose — a family, an office, or one person spreading
     orders — which is exactly why it is shown rather than acted on. */
  it("notices several accounts at one address, and carries the count", () => {
    const [flag] = fraudFlags(order({ accountsAtAddress: 5 }));
    expect(flag).toMatchObject({ signal: "addressManyAccounts", serious: false, detail: { accounts: 5 } });
  });

  it("notices a burst of orders in a day", () => {
    expect(signals(order({ ordersLastDay: 9 }))).toContain("rapidOrders");
  });

  /* One refund out of one order is somebody who changed their mind, and
     treating it as a pattern is how a first complaint becomes a black mark. */
  it("needs enough orders before a refund rate means anything", () => {
    expect(signals(order({ ordersAllTime: 1, refundedAllTime: 1 }))).not.toContain("refundHistory");
    expect(signals(order({ ordersAllTime: 6, refundedAllTime: 5 }))).toContain("refundHistory");
  });

  it("notices ten of one thing on a first order", () => {
    expect(signals(order({ ordersAllTime: 1, largestLineQuantity: 12 }))).toContain("firstOrderLargeQuantity");
    expect(signals(order({ ordersAllTime: 20, largestLineQuantity: 12 }))).not.toContain("firstOrderLargeQuantity");
  });
});

describe("how much attention it wants", () => {
  it("is a watch for one small oddity", () => {
    expect(riskOf(fraudFlags(order({ ordersLastDay: 9 })))).toBe("watch");
  });

  /* Several small oddities about one order is itself the pattern. */
  it("is high for three of anything, even with nothing serious", () => {
    const flags = fraudFlags(order({ ordersLastDay: 9, accountsAtAddress: 5, ordersAllTime: 6, refundedAllTime: 5 }));
    expect(flags.every(flag => !flag.serious)).toBe(true);
    expect(riskOf(flags)).toBe("high");
  });

  it("puts the serious one first", () => {
    const flags = fraudFlags(order({ accountAgeHours: 1, grandTotal: "500.000", ordersLastDay: 9 }));
    expect(flags[0].serious).toBe(true);
  });
});
