import { describe, expect, it } from "vitest";
import { orderProgress, type ProgressLine } from "./orderProgress";

const line = (fulfilment: ProgressLine["fulfilment"], extra: Partial<ProgressLine> = {}): ProgressLine => ({ fulfilment, ...extra });
const placed = { status: "pending_payment" };

describe("orderProgress", () => {
  it("is received until a seller starts on it", () => {
    expect(orderProgress(placed, [line("pending"), line("pending")])).toEqual({ kind: "received", preordered: false });
  });

  it("says pre-ordered only when everything still coming is", () => {
    expect(orderProgress(placed, [line("pending", { preordered: true })])).toEqual({ kind: "received", preordered: true });
    expect(orderProgress(placed, [line("pending", { preordered: true }), line("pending")])).toEqual({ kind: "received", preordered: false });
  });

  it("is being prepared, then on the way, by its furthest-behind line still coming", () => {
    expect(orderProgress(placed, [line("preparing"), line("pending")])).toEqual({ kind: "preparing" });
    expect(orderProgress(placed, [line("shipped"), line("preparing")])).toEqual({ kind: "onTheWay" });
  });

  it("is not delivered while one parcel is still out", () => {
    expect(orderProgress(placed, [line("delivered"), line("shipped")])).toEqual({ kind: "partlyDelivered", delivered: 1, of: 2 });
  });

  it("is delivered on the day the last of it arrived", () => {
    const progress = orderProgress({ status: "paid" }, [
      line("delivered", { deliveredAt: new Date("2026-10-04T09:00:00Z") }),
      line("delivered", { deliveredAt: "2026-10-06T12:00:00.000Z" }),
    ]);
    expect(progress).toEqual({ kind: "delivered", at: "2026-10-06T12:00:00.000Z" });
  });

  it("does not let a cancelled line hold the rest back", () => {
    expect(orderProgress({ status: "paid" }, [line("delivered"), line("cancelled")])).toEqual({ kind: "delivered", at: null });
    expect(orderProgress(placed, [line("cancelled"), line("shipped")])).toEqual({ kind: "onTheWay" });
  });

  it("is cancelled when nothing is coming or the order was closed", () => {
    expect(orderProgress(placed, [line("cancelled"), line("cancelled")])).toEqual({ kind: "cancelled" });
    expect(orderProgress({ status: "cancelled" }, [line("pending")])).toEqual({ kind: "cancelled" });
    expect(orderProgress(placed, [])).toEqual({ kind: "cancelled" });
  });

  it("is returned when everything that came went back", () => {
    expect(orderProgress({ status: "refunded" }, [line("returned"), line("cancelled")])).toEqual({ kind: "returned" });
    expect(orderProgress({ status: "paid" }, [line("returned"), line("delivered")])).toEqual({ kind: "delivered", at: null });
  });
});
