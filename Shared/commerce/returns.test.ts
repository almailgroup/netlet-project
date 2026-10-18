import { describe, expect, it } from "vitest";
import { orderHasReturnableLine, returnStateFor, RETURN_WINDOW_DAYS, type ReturnableLine, type ReturnableOrder } from "./returns.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const paid: ReturnableOrder = { status: "paid" };
const delivered = (deliveredAt: Date | null): ReturnableLine => ({ fulfilment: "delivered", deliveredAt });

describe("return eligibility", () => {
  it("opens a window on a paid, delivered line", () => {
    const state = returnStateFor(paid, delivered(daysAgo(2)), NOW);
    expect(state.returnable).toBe(true);
    if (!state.returnable) return;
    expect(state.daysLeft).toBe(RETURN_WINDOW_DAYS - 2);
    expect(state.closesAt.toISOString()).toBe(new Date(daysAgo(2).getTime() + RETURN_WINDOW_DAYS * DAY).toISOString());
  });

  it("closes the window the moment it expires, not a day later", () => {
    const exactlyClosed = returnStateFor(paid, delivered(daysAgo(RETURN_WINDOW_DAYS)), NOW);
    expect(exactlyClosed).toEqual({ returnable: false, reason: "returns.blockedWindowClosed" });

    const oneHourLeft = returnStateFor(paid, delivered(new Date(NOW.getTime() - RETURN_WINDOW_DAYS * DAY + 60 * 60 * 1000)), NOW);
    expect(oneHourLeft.returnable).toBe(true);
  });

  it("rounds a part-day up, so an open return never reads as zero days left", () => {
    const state = returnStateFor(paid, delivered(new Date(NOW.getTime() - RETURN_WINDOW_DAYS * DAY + 4 * 60 * 60 * 1000)), NOW);
    expect(state.returnable).toBe(true);
    if (!state.returnable) return;
    expect(state.daysLeft).toBe(1);
  });

  /*
   * The half the storefront gets wrong: offering a return on a parcel that has
   * not arrived. Paid is not enough.
   */
  it.each(["pending", "preparing", "shipped"] as const)("refuses a %s line even when the order is paid", fulfilment => {
    expect(returnStateFor(paid, { fulfilment, deliveredAt: null }, NOW))
      .toEqual({ returnable: false, reason: "returns.blockedNotDelivered" });
  });

  /* ...and the other half: a delivered line on an order nobody paid for. */
  it("refuses a delivered line on an unpaid order — there is nothing to refund", () => {
    expect(returnStateFor({ status: "pending_payment" }, delivered(daysAgo(1)), NOW))
      .toEqual({ returnable: false, reason: "returns.blockedUnpaid" });
  });

  it("names the line's own end state ahead of the order's", () => {
    // A returned line on a refunded order says "already returned", which is
    // what happened, rather than blaming the order's money state.
    expect(returnStateFor({ status: "refunded" }, { fulfilment: "returned", deliveredAt: daysAgo(1) }, NOW))
      .toEqual({ returnable: false, reason: "returns.blockedAlreadyReturned" });
    expect(returnStateFor({ status: "cancelled" }, { fulfilment: "cancelled", deliveredAt: null }, NOW))
      .toEqual({ returnable: false, reason: "returns.blockedCancelled" });
    expect(returnStateFor({ status: "refunded" }, delivered(daysAgo(1)), NOW))
      .toEqual({ returnable: false, reason: "returns.blockedRefunded" });
  });

  /*
   * `order_items` has no delivered_at column, so this is a real state rather
   * than a hypothetical. Our missing timestamp must not cost the shopper their
   * return.
   */
  it("treats an unknown delivery date as open, not as expired", () => {
    const state = returnStateFor(paid, delivered(null), NOW);
    expect(state.returnable).toBe(true);
    if (!state.returnable) return;
    expect(state.daysLeft).toBe(RETURN_WINDOW_DAYS);
  });

  it("takes the window from the caller, so a policy change is one number", () => {
    expect(returnStateFor(paid, delivered(daysAgo(20)), NOW, 30).returnable).toBe(true);
    expect(returnStateFor(paid, delivered(daysAgo(20)), NOW, 7).returnable).toBe(false);
  });
});

describe("orderHasReturnableLine", () => {
  it("is true when any one line can still go back", () => {
    expect(orderHasReturnableLine(paid, [
      { fulfilment: "returned", deliveredAt: daysAgo(1) },
      { fulfilment: "shipped", deliveredAt: null },
      delivered(daysAgo(1)),
    ], NOW)).toBe(true);
  });

  it("is false for an order with nothing delivered, and for no lines at all", () => {
    expect(orderHasReturnableLine(paid, [{ fulfilment: "shipped", deliveredAt: null }], NOW)).toBe(false);
    expect(orderHasReturnableLine(paid, [], NOW)).toBe(false);
  });
});
