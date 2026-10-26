/**
 * A parcel, which is the thing a delivery company actually carries.
 *
 * Requirements 2.2 and 3.4.2: of the five parties the specification names, the
 * delivery company was the one with no interface at all. This is the shape its
 * work takes, and it is pure for the reason the order arithmetic is — what it
 * decides is which vehicle is sent, and a dispatcher who is sent a motorcycle
 * for a sofa has had their day wasted by a rule nobody could check.
 *
 * ## What a parcel is
 *
 * **A seller and a destination**, which is the same definition delivery pricing
 * already uses (`Shared/commerce/addresses.ts`). One order from three shops to
 * two doors is not one delivery: it is parcels leaving different warehouses for
 * different addresses, and each is collected, carried and handed over on its
 * own.
 *
 * **Derived, never stored.** There is no `parcels` table, because a parcel is
 * exactly the lines of an order grouped two ways, and a table would be a
 * fourth thing to keep in step with those lines — the same argument
 * `sliceByVendor` already makes for the per-vendor view. What *is* stored is
 * the one fact the grouping cannot derive: which company was asked to carry it.
 *
 * **Its state is the least advanced line in it.** A parcel is not shipped
 * because one of the two things in it is: it is shipped when the last of them
 * is. Taking the furthest-along line would tell a driver a box is on its way
 * while half of it is still on a shelf.
 *
 * **A settled line is out of the parcel, not part of it.** A cancelled line is
 * not being carried, so it cannot hold the parcel at `pending` for ever; a
 * parcel whose every line is cancelled has nothing to collect and is not
 * listed. Returns are their own journey and are not dispatch work here.
 */
import { FULFILMENT_STATES, isSettled, type FulfilmentState } from "./fulfilment.js";
import { vehicleForQuantity, VEHICLES, type Vehicle } from "./vehicle.js";
import type { FrozenDestination } from "./addresses.js";
import { parcelKey } from "./addresses.js";

/** One order line, reduced to what dispatch needs to know about it. */
export type ParcelLine = {
  lineId: number;
  vendorId: number | null;
  vendorName: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  fulfilment: FulfilmentState;
  /** How big the seller said it is, frozen at the sale. */
  sizeClass?: string | null;
  /** How heavy, in grams, frozen at the sale. */
  weightGrams?: number | null;
  /** Where it goes, when not where the order goes. */
  destination?: FrozenDestination | null;
  /** Which company was asked to carry it. Null until somebody assigns one. */
  courierId?: number | null;
  /** The NetLet centre it came off, frozen at the sale (4.2); null or absent is the seller's own. */
  centreId?: number | null;
  /** The trip the shopper chose (3.2.5), frozen at the sale; absent or regular is the ordinary one. */
  deliveryChoice?: string | null;
};

export type Parcel = {
  /** Stable across reads, so a page can key on it and a call can name it. */
  key: string;
  vendorId: number | null;
  vendorName: string | null;
  /** Null means the order's own address, which the caller already has. */
  destination: FrozenDestination | null;
  lines: ParcelLine[];
  /** The least advanced line in it. */
  state: FulfilmentState;
  /**
   * What is needed to carry it, or null when nothing was measured.
   *
   * Null is a real answer and is shown as one: guessing small is how a sofa is
   * dispatched on a motorcycle, and the honest reading of a gap in our own
   * form is that we do not know.
   */
  vehicle: Vehicle | null;
  courierId: number | null;
  /** How many things are in it, which is what a driver counts at the door. */
  items: number;
  /** The NetLet centre it is collected from, or null when the seller hands it over (4.2). */
  centreId: number | null;
  /** True for a fast parcel (3.2.5): it leaves on its own trip, and goes first. */
  fast: boolean;
};

/**
 * The least advanced state among these lines.
 *
 * Settled lines are excluded by the caller; this is total over whatever it is
 * given, and answers `delivered` for an empty list only because a parcel with
 * nothing left in it has nothing outstanding — the caller drops those.
 */
export function parcelState(lines: { fulfilment: FulfilmentState }[]): FulfilmentState {
  let furthest = FULFILMENT_STATES.length - 1;
  for (const line of lines) {
    const at = FULFILMENT_STATES.indexOf(line.fulfilment);
    if (at >= 0 && at < furthest) furthest = at;
  }
  return FULFILMENT_STATES[furthest];
}

/**
 * Group an order's lines into the parcels it actually consists of.
 *
 * Order is first-seen, so a board does not reshuffle under somebody reading it.
 */
export function parcelsOf(lines: ParcelLine[]): Parcel[] {
  const byKey = new Map<string, Parcel>();

  for (const line of lines) {
    /* Not being carried: a cancelled line cannot hold a parcel at `pending`,
       and a returned one is a different journey. */
    if (isSettled(line.fulfilment) && line.fulfilment !== "delivered") continue;

    /* The destination's *label* keys it, because two lines sent to the same
       address carry two equal copies of it rather than one shared row. */
    /* And where it is collected from: a seller's own box and one off NetLet's
       shelf for the same door leave two buildings, so they are two parcels.
       Seller-shipped keys are unchanged, so ratings and claims filed against
       them before this still find their parcel. */
    const centreId = line.centreId ?? null;
    /* And how fast (3.2.5): a fast line and a regular one for the same door
       leave at different times, so they are two parcels. Regular keys are
       unchanged, for the reason seller-shipped ones are. */
    const fast = line.deliveryChoice === "fast";
    const key = parcelKey(line.vendorId, line.destination ? hashLabel(line.destination) : null) + (centreId === null ? "" : `|c${centreId}`) + (fast ? "|fast" : "");
    const held = byKey.get(key);
    if (held) {
      held.lines.push(line);
      continue;
    }
    byKey.set(key, {
      key,
      vendorId: line.vendorId,
      vendorName: line.vendorName,
      destination: line.destination ?? null,
      lines: [line],
      state: line.fulfilment,
      vehicle: null,
      courierId: line.courierId ?? null,
      items: 0,
      centreId,
      fast,
    });
  }

  return [...byKey.values()].map(parcel => ({
    ...parcel,
    state: parcelState(parcel.lines),
    vehicle: vehicleForParcel(parcel.lines),
    items: parcel.lines.reduce((count, line) => count + Math.max(0, Math.trunc(line.quantity)), 0),
    /* One parcel goes on one van, so a parcel whose lines disagree about the
       carrier is a parcel somebody assigned line by line. The first assignment
       wins rather than the answer being blank: a driver holding it needs to see
       it, and the assign call always writes every line in the parcel. */
    courierId: parcel.lines.find(line => line.courierId)?.courierId ?? null,
  }));
}

/**
 * The vehicle a parcel needs: the largest any line in it needs.
 *
 * Quantity counts — ten of something a bike carries is not a bike delivery —
 * and a line nobody measured is skipped rather than counted small, so one
 * unmeasured item cannot talk a dispatcher down from a van.
 */
export function vehicleForParcel(lines: ParcelLine[]): Vehicle | null {
  let needed: Vehicle | null = null;
  for (const line of lines) {
    const vehicle = vehicleForQuantity(
      { sizeClass: line.sizeClass, weightGrams: line.weightGrams },
      line.quantity,
    );
    if (!vehicle) continue;
    if (!needed || VEHICLES.indexOf(vehicle) > VEHICLES.indexOf(needed)) needed = vehicle;
  }
  return needed;
}

/**
 * Whether this parcel is packed and waiting for somebody to collect it.
 *
 * `preparing` is the seller saying they have it ready; `pending` is a box that
 * does not exist yet, and sending a driver for one is the wasted trip this
 * whole module exists to avoid.
 */
export function readyToCollect(parcel: Pick<Parcel, "state">): boolean {
  return parcel.state === "preparing";
}

/** Whether it is out with a driver. */
export function inTransit(parcel: Pick<Parcel, "state">): boolean {
  return parcel.state === "shipped";
}

/**
 * What a courier may move a parcel to, and nothing else.
 *
 * Deliberately narrower than `nextStates`: a seller correcting a mis-click may
 * walk a line backwards, and a delivery company may not — "collected" and
 * "handed over" are the two things they actually witness. Cancelling is the
 * seller's or the shopper's decision, never the driver's.
 */
export function courierMoves(parcel: Pick<Parcel, "state">): FulfilmentState[] {
  if (parcel.state === "preparing") return ["shipped"];
  if (parcel.state === "shipped") return ["delivered"];
  return [];
}

/**
 * A short label for the parcel, for a board and for a driver reading it aloud.
 *
 * The seller's name and the door, because those are the two facts that tell one
 * parcel from another on the same order.
 */
export function describeParcel(parcel: Parcel): { vendorName: string | null; destinationLabel: string | null } {
  return { vendorName: parcel.vendorName, destinationLabel: parcel.destination?.label ?? null };
}

/**
 * A stable key for a destination.
 *
 * The label alone is not enough — two addresses can both be called "Home" by
 * two different shoppers, and on one order that cannot happen, but the street
 * is what actually distinguishes them. So both go in, and the result is only
 * ever compared, never parsed.
 */
function hashLabel(destination: FrozenDestination): string {
  /* The unit separator, not NUL. The key travels to the board and comes back
     in `dispatch.assign` and `dispatch.move`, and every input carrying a NUL
     is refused before it reaches a router — Postgres `text` cannot hold one —
     so a NUL here made every parcel bound for a second door unmovable. */
  return `${destination.label}\u001f${destination.addressLine ?? ""}`;
}
