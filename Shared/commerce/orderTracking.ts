/**
 * Where each parcel of an order has got to, as steps, for "Track order".
 *
 * **Per parcel, not per order, on the owner's word that a shopper should be
 * able to track what they bought.** One basket from three stores is three
 * parcels leaving three buildings, so one line of steps for the whole order
 * would say "on the way" while two of the three are still on a shelf. The
 * parcels are `parcelsOf`'s — the ones dispatch carries and the shopper rates
 * — so the page and the driver's board name the same boxes.
 *
 * **Four steps**: placed, being prepared, on the way, delivered. A parcel is
 * at the least advanced line in it (`parcelState`), so it is not "on the way"
 * while half of it is still being packed. A line the store cancelled is out of
 * its parcel; a line returned after arriving still arrived, so it counts as
 * delivered here, as it does for the delivery rating.
 *
 * **The dates are only the ones that are facts**: when the order was placed
 * and when each parcel arrived. The days a parcel was packed and sent are not
 * recorded, and a step is never given a date somebody guessed.
 *
 * **What is promised is the seller's, said as theirs**: a pre-order's release
 * date, "made to order", or the store's delivery band counted in business days
 * from when the order was placed — never a date NetLet makes up, which is the
 * rule the product page's delivery line follows. A window that has passed with
 * the parcel still coming says so (`late`) rather than quietly promising a day
 * already gone. Pure, so the web and the app draw the same steps.
 */
import { parcelsOf, type ParcelLine } from "./parcels.js";
import { arrivalFor, slowestSpeed, type DeliverySpeed } from "./deliverySpeed.js";
import type { FulfilmentState } from "./fulfilment.js";
import { kuwaitDay } from "../kuwaitDay.js";

export const TRACK_STEPS = ["placed", "preparing", "onTheWay", "delivered"] as const;
export type TrackStep = (typeof TRACK_STEPS)[number];

export type TrackLine = ParcelLine & {
  deliveredAt?: Date | string | null;
  preordered?: boolean;
  preorderReleaseAt?: Date | string | null;
  /** The seller's band for this line (the store's, a product's own, or its fast trip's), or null. */
  speed?: DeliverySpeed | null;
};

export type TrackPromise =
  | { kind: "window"; from: string; to: string; late: boolean }
  | { kind: "madeToOrder" }
  | { kind: "preorder"; at: string | null };

export type ParcelTrack = {
  key: string;
  vendorName: string | null;
  /** Where it goes, when not where the order goes. */
  destinationLabel: string | null;
  fast: boolean;
  lineIds: number[];
  items: number;
  step: TrackStep;
  deliveredAt: string | null;
  /** What the seller said about when, while it is still coming. */
  promise: TrackPromise | null;
};

export type OrderTrack = {
  placedAt: string;
  /** Nothing is coming: the whole order was cancelled. */
  cancelled: boolean;
  parcels: ParcelTrack[];
};

const STEP_OF: Record<FulfilmentState, TrackStep> = {
  pending: "placed",
  preparing: "preparing",
  shipped: "onTheWay",
  delivered: "delivered",
  /* Never reached: settled lines leave their parcel before this is read. */
  cancelled: "placed",
  returned: "delivered",
};

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.toISOString();

const time = (value: Date | string | null | undefined) => (value == null ? null : new Date(value).getTime());

export function stepsForOrder(order: { placedAt: Date | string; status: string }, lines: TrackLine[], now: Date = new Date()): OrderTrack {
  const placedAt = new Date(order.placedAt);
  /* Arrived is a date: a line sent back afterwards still arrived. */
  const carried = lines.map(line => ({
    ...line,
    fulfilment: line.fulfilment === "returned" && line.deliveredAt ? ("delivered" as const) : line.fulfilment,
  }));
  const parcels = order.status === "cancelled" ? [] : parcelsOf(carried);
  const today = kuwaitDay(now);

  return {
    placedAt: placedAt.toISOString(),
    cancelled: parcels.length === 0,
    parcels: parcels.map(parcel => {
      const held = parcel.lines as TrackLine[];
      const step = STEP_OF[parcel.state];
      const arrived = step === "delivered"
        ? held.map(line => time(line.deliveredAt)).filter((at): at is number => at !== null).sort((a, b) => a - b).at(-1) ?? null
        : null;
      return {
        key: parcel.key,
        vendorName: parcel.vendorName,
        destinationLabel: parcel.destination?.label ?? null,
        fast: parcel.fast,
        lineIds: held.map(line => line.lineId),
        items: parcel.items,
        step,
        deliveredAt: arrived === null ? null : new Date(arrived).toISOString(),
        promise: step === "delivered" ? null : promiseFor(held, placedAt, today),
      };
    }),
  };
}

/**
 * The seller's word on when, for a parcel still coming.
 *
 * Every line a pre-order: the latest release date, or none once that has
 * passed (a date from February read in September informs nobody). Otherwise
 * the slowest band among the rest, since a parcel arrives with its last thing.
 */
function promiseFor(lines: TrackLine[], placedAt: Date, today: string): TrackPromise | null {
  const ordinary = lines.filter(line => !line.preordered);
  if (ordinary.length === 0) {
    const release = lines.map(line => time(line.preorderReleaseAt)).filter((at): at is number => at !== null).sort((a, b) => a - b).at(-1) ?? null;
    const still = release !== null && kuwaitDay(new Date(release)) >= today ? iso(new Date(release)) : null;
    return { kind: "preorder", at: still };
  }
  const speed = slowestSpeed(ordinary.map(line => line.speed ?? null));
  if (!speed) return null;
  const arrival = arrivalFor(speed, placedAt);
  if (arrival.from === null) return { kind: "madeToOrder" };
  return {
    kind: "window",
    from: arrival.from.toISOString(),
    to: arrival.to.toISOString(),
    /* The band's last day is a Kuwaiti day held as its UTC midnight. */
    late: arrival.to.toISOString().slice(0, 10) < today,
  };
}
