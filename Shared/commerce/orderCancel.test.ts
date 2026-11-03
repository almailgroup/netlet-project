import { describe, expect, it } from "vitest";
import { shopperCancelState } from "./orderCancel.js";

const unpaid = { status: "pending_payment" };

describe("shopperCancelState", () => {
  it("lets the shopper cancel while every line still coming is in the stores' hands", () => {
    expect(shopperCancelState(unpaid, [{ fulfilment: "pending" }, { fulfilment: "pending" }])).toEqual({ cancellable: true });
    /* Being packed is still before the driver has it (the owner's rule). */
    expect(shopperCancelState(unpaid, [{ fulfilment: "pending" }, { fulfilment: "preparing" }])).toEqual({ cancellable: true });
  });

  it("is not held back by a line the store already cancelled", () => {
    expect(shopperCancelState(unpaid, [{ fulfilment: "cancelled" }, { fulfilment: "pending" }])).toEqual({ cancellable: true });
  });

  it("refuses once a driver has collected any of it", () => {
    for (const started of ["shipped", "delivered"] as const) {
      expect(shopperCancelState(unpaid, [{ fulfilment: "pending" }, { fulfilment: started }])).toEqual({ cancellable: false, reason: "orders.cancelStarted" });
    }
  });

  it("refuses an order that is already over, or has nothing left in it", () => {
    expect(shopperCancelState({ status: "cancelled" }, [{ fulfilment: "cancelled" }])).toEqual({ cancellable: false, reason: "orders.cancelClosed" });
    expect(shopperCancelState({ status: "refunded" }, [{ fulfilment: "returned" }])).toEqual({ cancellable: false, reason: "orders.cancelClosed" });
    expect(shopperCancelState(unpaid, [{ fulfilment: "cancelled" }])).toEqual({ cancellable: false, reason: "orders.cancelClosed" });
  });

  it("refuses once the cash has been collected", () => {
    expect(shopperCancelState({ status: "paid" }, [{ fulfilment: "pending" }])).toEqual({ cancellable: false, reason: "orders.cancelPaid" });
  });
});
