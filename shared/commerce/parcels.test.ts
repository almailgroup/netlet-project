import { describe, expect, it } from "vitest";
import {
  courierMoves,
  inTransit,
  parcelState,
  parcelsOf,
  readyToCollect,
  vehicleForParcel,
  type ParcelLine,
} from "./parcels.js";
import { can, readableCouriers, type Actor } from "../inventory/permissions.js";

const line = (over: Partial<ParcelLine> = {}): ParcelLine => ({
  lineId: 1,
  vendorId: 1,
  vendorName: "Acme",
  productTitle: "Harbour Desk Lamp",
  variantTitle: null,
  quantity: 1,
  fulfilment: "preparing",
  ...over,
});

const office = {
  label: "Office",
  contactName: null,
  contactPhone: null,
  governorate: "capital",
  addressLine: "Block 1, Street 2",
  addressNotes: null,
};

describe("what a parcel is", () => {
  it("is one per seller per door", () => {
    const parcels = parcelsOf([
      line({ lineId: 1 }),
      line({ lineId: 2, destination: office }),
      line({ lineId: 3, vendorId: 2, vendorName: "Other" }),
    ]);
    expect(parcels).toHaveLength(3);
    expect(parcels.map(p => p.destination?.label ?? null)).toEqual([null, "Office", null]);
  });

  it("puts two lines to the same door in one parcel", () => {
    const parcels = parcelsOf([
      line({ lineId: 1, destination: office, quantity: 2 }),
      line({ lineId: 2, destination: { ...office }, quantity: 3 }),
    ]);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].items).toBe(5);
  });

  it("tells two doors apart even when a shopper called both the same", () => {
    const parcels = parcelsOf([
      line({ lineId: 1, destination: { ...office, label: "Home", addressLine: "Block 4" } }),
      line({ lineId: 2, destination: { ...office, label: "Home", addressLine: "Block 9" } }),
    ]);
    expect(parcels).toHaveLength(2);
  });

  /* The key goes to the board and back through `dispatch.move`, and every input
     carrying a NUL is refused before a router sees it. It used to carry one, so
     every parcel bound for a second door could not be moved at all. */
  it("names a parcel with a key that survives the trip through the API", () => {
    const [parcel] = parcelsOf([line({ lineId: 1, destination: office })]);
    expect(parcel.key).not.toContain("\u0000");
  });
});

describe("a parcel's state is its least advanced line", () => {
  it("is not shipped because one thing in it is", () => {
    expect(parcelState([{ fulfilment: "shipped" }, { fulfilment: "preparing" }])).toBe("preparing");
  });

  it("is delivered only when the last line is", () => {
    expect(parcelState([{ fulfilment: "delivered" }, { fulfilment: "delivered" }])).toBe("delivered");
  });

  it("leaves a cancelled line out rather than stuck at the front of the queue", () => {
    const parcels = parcelsOf([
      line({ lineId: 1, fulfilment: "cancelled" }),
      line({ lineId: 2, fulfilment: "shipped" }),
    ]);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].lines).toHaveLength(1);
    expect(parcels[0].state).toBe("shipped");
  });

  it("does not list a parcel whose every line is cancelled", () => {
    expect(parcelsOf([line({ fulfilment: "cancelled" }), line({ lineId: 2, fulfilment: "returned" })])).toEqual([]);
  });
});

describe("the vehicle", () => {
  it("takes the largest line, and quantity counts", () => {
    expect(vehicleForParcel([line({ sizeClass: "small" }), line({ lineId: 2, sizeClass: "oversize" })])).toBe("truck");
    // Ten of something a bike carries is not a bike delivery.
    expect(vehicleForParcel([line({ weightGrams: 4_000, quantity: 10 })])).toBe("van");
  });

  it("skips a line nobody measured rather than counting it small", () => {
    expect(vehicleForParcel([line({ sizeClass: null, weightGrams: null }), line({ lineId: 2, sizeClass: "large" })])).toBe("van");
  });

  it("answers null when nothing was measured, rather than guessing", () => {
    expect(vehicleForParcel([line()])).toBeNull();
  });
});

describe("what a driver may do", () => {
  it("collects a packed parcel and hands over one in transit", () => {
    expect(readyToCollect({ state: "preparing" })).toBe(true);
    expect(inTransit({ state: "shipped" })).toBe(true);
    expect(courierMoves({ state: "preparing" })).toEqual(["shipped"]);
    expect(courierMoves({ state: "shipped" })).toEqual(["delivered"]);
  });

  it("is not asked to collect a box that does not exist yet", () => {
    expect(readyToCollect({ state: "pending" })).toBe(false);
    expect(courierMoves({ state: "pending" })).toEqual([]);
  });

  /* Walking a line backwards is a seller correcting a mis-click; cancelling is
     the seller's or the shopper's decision. Neither is the driver's. */
  it("cannot walk a parcel back or cancel it", () => {
    expect(courierMoves({ state: "delivered" })).toEqual([]);
    expect(courierMoves({ state: "preparing" })).not.toContain("cancelled");
    expect(courierMoves({ state: "shipped" })).not.toContain("preparing");
  });
});

describe("what a delivery company may reach", () => {
  const courier: Actor = { kind: "courier", userId: 9, courierId: 3 };
  const owner: Actor = { kind: "vendor", userId: 4, vendorId: 1, role: "owner" };
  const admin: Actor = { kind: "admin", userId: 1 };

  it("is dispatch and nothing else", () => {
    expect(can(courier, "delivery.view")).toBe(true);
    expect(can(courier, "delivery.move")).toBe(true);
    for (const capability of ["product.view", "stock.adjust", "product.edit", "platform.viewAll", "vendor.setCommission"] as const) {
      expect(can(courier, capability)).toBe(false);
    }
  });

  it("never includes deciding who carries what", () => {
    expect(can(courier, "delivery.assign")).toBe(false);
    expect(can(owner, "delivery.assign")).toBe(false);
    expect(can(admin, "delivery.assign")).toBe(true);
  });

  it("does not reach the board at all from a seller's account", () => {
    expect(can(owner, "delivery.view")).toBe(false);
    expect(can({ kind: "customer", userId: 2 }, "delivery.view")).toBe(false);
  });

  it("is scoped to its own company", () => {
    expect(readableCouriers(courier)).toEqual([3]);
    expect(readableCouriers(admin)).toBe("all");
    expect(readableCouriers(owner)).toEqual([]);
  });
});
