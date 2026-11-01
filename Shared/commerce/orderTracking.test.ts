import { describe, expect, it } from "vitest";
import { stepsForOrder, type TrackLine } from "./orderTracking.js";

/* Sunday 1 November 2026, 10:00 in Kuwait. */
const placedAt = new Date("2026-11-01T07:00:00Z");
const order = { placedAt, status: "pending_payment" };

let next = 1;
const line = (over: Partial<TrackLine> = {}): TrackLine => ({
  lineId: next++,
  vendorId: 1,
  vendorName: "Acme",
  productTitle: "Lamp",
  variantTitle: null,
  quantity: 1,
  fulfilment: "pending",
  speed: "two_to_four",
  ...over,
});

describe("stepsForOrder", () => {
  it("draws one parcel per store, at its least advanced line", () => {
    const track = stepsForOrder(order, [
      line({ fulfilment: "shipped" }),
      line({ fulfilment: "preparing" }),
      line({ vendorId: 2, vendorName: "Gulf Grocers", fulfilment: "pending" }),
    ], placedAt);
    expect(track.cancelled).toBe(false);
    expect(track.parcels.map(parcel => [parcel.vendorName, parcel.step, parcel.lineIds.length])).toEqual([
      ["Acme", "preparing", 2],
      ["Gulf Grocers", "placed", 1],
    ]);
    expect(track.placedAt).toBe(placedAt.toISOString());
  });

  it("says when the store's band puts it, counted in business days from the order", () => {
    const [parcel] = stepsForOrder(order, [line()], placedAt).parcels;
    /* Two to four business days from a Sunday: Tuesday to Thursday. */
    expect(parcel.promise).toEqual({ kind: "window", from: "2026-11-03T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z", late: false });
  });

  it("says a window that has passed is late rather than promising a day gone", () => {
    const [parcel] = stepsForOrder(order, [line({ fulfilment: "shipped" })], new Date("2026-11-08T09:00:00Z")).parcels;
    expect(parcel.promise).toMatchObject({ kind: "window", late: true });
  });

  it("takes the slowest band in a parcel, and promises nothing the seller did not", () => {
    const [slow] = stepsForOrder(order, [line({ speed: "next_day" }), line({ speed: "up_to_week" })], placedAt).parcels;
    expect(slow.promise).toMatchObject({ kind: "window", to: "2026-11-10T00:00:00.000Z" });
    const [silent] = stepsForOrder(order, [line({ speed: null })], placedAt).parcels;
    expect(silent.promise).toBeNull();
    const [made] = stepsForOrder(order, [line({ speed: "made_to_order" })], placedAt).parcels;
    expect(made.promise).toEqual({ kind: "madeToOrder" });
  });

  it("gives a pre-order its release date, and none once that has passed", () => {
    const [ahead] = stepsForOrder(order, [line({ preordered: true, preorderReleaseAt: "2026-12-01T00:00:00Z" })], placedAt).parcels;
    expect(ahead.promise).toEqual({ kind: "preorder", at: "2026-12-01T00:00:00.000Z" });
    const [stale] = stepsForOrder(order, [line({ preordered: true, preorderReleaseAt: "2026-10-01T00:00:00Z" })], placedAt).parcels;
    expect(stale.promise).toEqual({ kind: "preorder", at: null });
  });

  it("dates a delivered parcel by its last arrival, and a returned line still arrived", () => {
    const [parcel] = stepsForOrder(order, [
      line({ fulfilment: "delivered", deliveredAt: "2026-11-03T12:00:00Z" }),
      line({ fulfilment: "returned", deliveredAt: "2026-11-04T12:00:00Z" }),
    ], placedAt).parcels;
    expect(parcel.step).toBe("delivered");
    expect(parcel.deliveredAt).toBe("2026-11-04T12:00:00.000Z");
    expect(parcel.promise).toBeNull();
  });

  it("leaves a cancelled line out, and a wholly cancelled order has nothing to track", () => {
    const [parcel] = stepsForOrder(order, [line({ fulfilment: "cancelled" }), line({ fulfilment: "shipped" })], placedAt).parcels;
    expect(parcel.lineIds).toHaveLength(1);
    expect(stepsForOrder(order, [line({ fulfilment: "cancelled" })], placedAt)).toMatchObject({ cancelled: true, parcels: [] });
    expect(stepsForOrder({ placedAt, status: "cancelled" }, [line()], placedAt).cancelled).toBe(true);
  });

  it("keeps a fast trip apart from the regular one", () => {
    const parcels = stepsForOrder(order, [line(), line({ deliveryChoice: "fast", speed: "same_day" })], placedAt).parcels;
    expect(parcels.map(parcel => parcel.fast)).toEqual([false, true]);
    expect(parcels[1].promise).toMatchObject({ kind: "window", from: "2026-11-01T00:00:00.000Z" });
  });
});
