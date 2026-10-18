/**
 * The delivery company's half of NetLet.
 *
 * Requirement 2.2 names five parties — buyer, seller, admin, the person who
 * processes orders, and the delivery company — and until this landed the fifth
 * had no interface anywhere. `Shared/commerce/parcels.ts` is the rules and is
 * pure; this is the part that needs a database. Outside `db.ts` for the reason
 * `orders.ts`, `finance.ts` and `profile.ts` are: functions inside `db.ts` call
 * its module-local `getDb`, so anything living there cannot be tested against a
 * real Postgres.
 *
 * **Every query is scoped by `actor.courierId` inside the data layer**, never
 * filtered in the router. A courier id is a serial, and "show me company 2's
 * board" has to be refused by the query itself rather than by a check a second
 * caller could skip — the same rule the vendor scope already follows.
 *
 * **A parcel is derived and assignment is stored.** There is no `parcels` table:
 * a parcel is an order's lines grouped by seller and door, and a table would be
 * a fourth thing to keep in step with those lines. The one fact the grouping
 * cannot derive — which company was asked to carry it — lives on the line.
 */
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  courierMembers,
  couriers,
  fulfilmentCentres,
  orderItems,
  orders,
  users,
} from "../../database/schema.js";
import {
  courierMoves,
  parcelState,
  parcelsOf,
  type Parcel,
  type ParcelLine,
} from "../../../Shared/commerce/parcels.js";
import type { FulfilmentState } from "../../../Shared/commerce/fulfilment.js";
import { assertCan, readableCouriers, type Actor } from "../../../Shared/inventory/permissions.js";
import { getDb } from "./db.js";
import { stillOwedFor } from "./owed.js";
import { tellOrderMoved } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Refused for a reason the caller can act on, as a message key. */
export class DispatchError extends Error {}

/**
 * How many orders back the board looks.
 *
 * A dispatch board is about work outstanding, not history, and a courier
 * scrolling a year of delivered parcels is reading the wrong screen. Read from
 * the newest orders and said out loud when the ceiling was hit, the way the
 * finance panel reports its own.
 */
export const ORDER_CEILING = 300;

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

export type CourierRow = {
  id: number;
  name: string;
  nameAr: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: string;
};

/** Every delivery company, for an admin assigning work. */
export async function listCouriers(actor: Actor): Promise<CourierRow[]> {
  assertCan(actor, "delivery.view");
  const db = await handle();
  return db
    .select({
      id: couriers.id,
      name: couriers.name,
      nameAr: couriers.nameAr,
      contactPhone: couriers.contactPhone,
      contactEmail: couriers.contactEmail,
      status: couriers.status,
    })
    .from(couriers)
    /* A company's people see their own company and no other. They could list
       every rival with its phone and email — the one thing the rest of this
       file is careful never to say about a rival. */
    .where(actor.kind === "courier" ? eq(couriers.id, actor.courierId) : undefined)
    .orderBy(couriers.name);
}

export async function createCourier(
  actor: Actor,
  input: { name: string; nameAr?: string | null; contactPhone?: string | null; contactEmail?: string | null },
): Promise<CourierRow> {
  assertCan(actor, "delivery.assign");
  const name = input.name.trim();
  if (!name) throw new DispatchError("dispatch.needsName");

  const db = await handle();
  const [row] = await db
    .insert(couriers)
    .values({
      name,
      nameAr: input.nameAr?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
    })
    .returning();
  return row;
}

/**
 * Suspend a company, or bring it back.
 *
 * Suspending rather than deleting, for the reason a vendor is suspended: the
 * parcels it already carried are part of an order's history, and a suspended
 * company keeps them while dropping out of the list of companies work can be
 * given to.
 */
export async function setCourierStatus(actor: Actor, courierId: number, status: "active" | "suspended"): Promise<void> {
  assertCan(actor, "delivery.assign");
  const db = await handle();
  const [row] = await db
    .update(couriers)
    .set({ status })
    .where(eq(couriers.id, courierId))
    .returning({ id: couriers.id });
  if (!row) throw new DispatchError("dispatch.unknownCourier");
}

/**
 * Who has a login on this company, by name and address.
 *
 * It used to answer with account numbers alone, so the page listed "#12" and
 * "#31" and nobody could say who those were without a database client. Every
 * caller is an administrator (`delivery.assign` is admin-only), who reads the
 * same names on `/admin/people`.
 */
export async function listCourierMembers(actor: Actor, courierId: number) {
  assertCan(actor, "delivery.assign");
  const db = await handle();
  return db
    .select({ id: courierMembers.id, userId: courierMembers.userId, courierId: courierMembers.courierId, email: users.email, name: users.name })
    .from(courierMembers)
    .innerJoin(users, eq(users.id, courierMembers.userId))
    .where(eq(courierMembers.courierId, courierId))
    .orderBy(asc(courierMembers.id));
}

/**
 * Attach an existing account to a delivery company, by its address.
 *
 * `platform.manageUsers` as well as `delivery.assign`: giving somebody a login
 * that reaches a NetLet interface is administering NetLet, which is the same
 * line `vendors.addNewMember` draws — an owner ranks their own people, and
 * minting access is a different act.
 *
 * By address rather than by account number, which is what a store's team page
 * already takes. The worry that kept it to numbers — that an address lookup
 * tells somebody which addresses are registered — does not apply to the one
 * person who may call it, who can already search every account; and an id
 * that named no account reached the insert and came back as a foreign-key 500.
 */
export async function addCourierMember(actor: Actor, courierId: number, email: string): Promise<void> {
  assertCan(actor, "delivery.assign");
  assertCan(actor, "platform.manageUsers");
  const db = await handle();

  const [company] = await db.select({ id: couriers.id }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
  if (!company) throw new DispatchError("dispatch.unknownCourier");

  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!account) throw new DispatchError("admin.noSuchAccount");

  await db.insert(courierMembers).values({ courierId, userId: account.id }).onConflictDoNothing();
}

export async function removeCourierMember(actor: Actor, courierId: number, userId: number): Promise<void> {
  assertCan(actor, "delivery.assign");
  assertCan(actor, "platform.manageUsers");
  const db = await handle();
  await db
    .delete(courierMembers)
    .where(and(eq(courierMembers.courierId, courierId), eq(courierMembers.userId, userId)));
}

/** The company this account works for, if any. Used to resolve the actor. */
export async function courierFor(userId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ courierId: courierMembers.courierId })
    .from(courierMembers)
    .where(eq(courierMembers.userId, userId))
    .limit(1);
  return row?.courierId ?? null;
}

export type BoardParcel = Parcel & {
  orderId: number;
  reference: string;
  placedAt: Date;
  /** How the shopper pays, so a driver knows whether cash is expected. */
  paymentMethod: string | null;
  paymentCollectedAt: Date | null;
  /**
   * What the shopper owes on the whole order.
   *
   * The *order's* figure and not this parcel's, deliberately: cash on delivery
   * is one payment however many boxes it arrives in, and a driver handed a
   * per-parcel share would ask for a number the shopper has never seen.
   *
   * **And what it owes now, not what it was placed for.** This read the frozen
   * grand total, so a seller cancelling the sofa out of a basket left the driver
   * told to collect KWD 267.400 for cushions and olive oil. It is
   * `stillOwedFor` now — the same figure the shopper's own order page shows.
   */
  orderTotal: string;
  /** Who is carrying it, by name, so a board reads without a second lookup. */
  courierName: string | null;
  /**
   * Where to collect it when it is not the seller's door: the NetLet centre
   * it was sold off (4.2), named and addressed, so a driver goes to the
   * warehouse that is holding the box rather than to a seller who is not.
   */
  collectFrom: { name: string; addressLine: string; governorate: string } | null;
  /** Placed by a member (4.1), frozen on the order: first in the queue for the next driver. */
  member: boolean;
  /** The order's own address, which is where a parcel with no door of its own goes. */
  orderAddress: {
    contactName: string | null;
    contactPhone: string | null;
    governorate: string | null;
    addressLine: string | null;
    addressNotes: string | null;
    /** The pin dropped at checkout, so a driver can open it in Maps (3.2.7). */
    pin: { lat: number; lng: number } | null;
  };
};

export type Board = {
  parcels: BoardParcel[];
  /** True when the read stopped at `ORDER_CEILING`, so the page can say so. */
  truncated: boolean;
};

/**
 * The parcels this actor may see.
 *
 * An admin sees every parcel, assigned or not — somebody has to be able to
 * give the work out. A courier sees only what is assigned to their own
 * company: an unassigned parcel is not theirs to collect, and showing it would
 * be inviting two companies to race for the same box.
 *
 * `state` narrows to what is actually outstanding by default, because a board
 * is work rather than history.
 */
export async function loadBoard(
  actor: Actor,
  filter: { state?: "waiting" | "transit" | "done"; courierId?: number } = {},
): Promise<Board> {
  assertCan(actor, "delivery.view");
  const db = await handle();

  const scope = readableCouriers(actor);
  /*
   * A courier's own id wins over anything the caller passed: a filter is a
   * convenience for an admin narrowing the board, never a way for a company to
   * ask about another's.
   */
  const wantedCourier = scope === "all" ? filter.courierId : scope[0];

  const recent = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      placedAt: orders.placedAt,
      paymentMethod: orders.paymentMethod,
      paymentCollectedAt: orders.paymentCollectedAt,
      orderTotal: orders.grandTotal,
      deliveryBreakdown: orders.deliveryBreakdown,
      contactName: orders.contactName,
      contactPhone: orders.contactPhone,
      governorate: orders.deliveryZoneId,
      addressLine: orders.addressLine,
      addressNotes: orders.addressNotes,
      pin: orders.deliveryPin,
      member: orders.member,
    })
    .from(orders)
    .orderBy(desc(orders.id))
    .limit(ORDER_CEILING + 1);

  const truncated = recent.length > ORDER_CEILING;
  const window = truncated ? recent.slice(0, ORDER_CEILING) : recent;
  if (window.length === 0) return { parcels: [], truncated: false };

  const lines = await db
    .select({
      lineId: orderItems.id,
      orderId: orderItems.orderId,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      fulfilment: orderItems.fulfilment,
      sizeClass: orderItems.sizeClass,
      weightGrams: orderItems.weightGrams,
      destination: orderItems.destination,
      courierId: orderItems.courierId,
      centreId: orderItems.centreId,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, window.map(row => row.id)))
    .orderBy(orderItems.id);

  /* One read for the names, rather than a join that would repeat them on every
     line — and it is a short table by nature. */
  const names = new Map(
    (await db.select({ id: couriers.id, name: couriers.name }).from(couriers)).map(row => [row.id, row.name]),
  );
  const centres = new Map(
    (await db.select({ id: fulfilmentCentres.id, name: fulfilmentCentres.name, addressLine: fulfilmentCentres.addressLine, governorate: fulfilmentCentres.governorate }).from(fulfilmentCentres))
      .map(row => [row.id, { name: row.name, addressLine: row.addressLine, governorate: row.governorate }]),
  );

  const owed = await stillOwedFor(db, window.map(order => ({
    id: order.id, grandTotal: order.orderTotal, deliveryBreakdown: order.deliveryBreakdown,
  })));

  const byOrder = new Map<number, ParcelLine[]>();
  for (const line of lines) {
    const held = byOrder.get(line.orderId) ?? [];
    held.push(line as ParcelLine);
    byOrder.set(line.orderId, held);
  }

  const board: BoardParcel[] = [];
  for (const order of window) {
    for (const parcel of parcelsOf(byOrder.get(order.id) ?? [])) {
      if (wantedCourier !== undefined && parcel.courierId !== wantedCourier) continue;
      /* A company that has been given nothing sees an empty board, not
         everybody's work. */
      if (scope !== "all" && parcel.courierId === null) continue;
      if (filter.state === "waiting" && parcel.state !== "preparing") continue;
      if (filter.state === "transit" && parcel.state !== "shipped") continue;
      if (filter.state === "done" && parcel.state !== "delivered") continue;
      board.push({
        ...parcel,
        orderId: order.id,
        reference: order.reference,
        placedAt: order.placedAt,
        paymentMethod: order.paymentMethod,
        paymentCollectedAt: order.paymentCollectedAt,
        orderTotal: owed.get(order.id)?.owed ?? order.orderTotal,
        courierName: parcel.courierId === null ? null : names.get(parcel.courierId) ?? null,
        collectFrom: parcel.centreId === null ? null : centres.get(parcel.centreId) ?? null,
        member: order.member,
        orderAddress: {
          contactName: order.contactName,
          contactPhone: order.contactPhone,
          governorate: order.governorate,
          addressLine: order.addressLine,
          addressNotes: order.addressNotes,
          pin: order.pin,
        },
      });
    }
  }

  /* A member's parcels still on their way go first (4.1) — "fast" is the next
     free driver taking theirs. A stable sort, so everything else keeps the
     board's own order and nothing reshuffles under somebody reading it. */
  const priority = (parcel: BoardParcel) => (parcel.member && parcel.state !== "delivered" ? 1 : 0);
  board.sort((a, b) => priority(b) - priority(a));
  return { parcels: board, truncated };
}

/**
 * Read one parcel back, having found it the way the board does.
 *
 * A parcel has no id of its own, so it is named by its order and its key — and
 * it is *re-derived* here rather than trusted from whatever the client sent,
 * because the key is a client-visible string and "the parcel I say this is" is
 * not a thing a caller may assert.
 */
async function parcelIn(db: Db, orderId: number, key: string): Promise<ParcelLine[]> {
  const lines = await db
    .select({
      lineId: orderItems.id,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      fulfilment: orderItems.fulfilment,
      sizeClass: orderItems.sizeClass,
      weightGrams: orderItems.weightGrams,
      destination: orderItems.destination,
      courierId: orderItems.courierId,
      centreId: orderItems.centreId,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);

  const parcel = parcelsOf(lines as ParcelLine[]).find(one => one.key === key);
  if (!parcel) throw new DispatchError("dispatch.unknownParcel");
  return parcel.lines;
}

/**
 * Give a parcel to a delivery company, or take it back.
 *
 * Every line in the parcel is written in one statement, so a parcel is never
 * half-assigned — a box cannot go on two vans. `null` un-assigns, which is how
 * a mistake is corrected rather than needing a second procedure.
 */
export async function assignParcel(
  actor: Actor,
  orderId: number,
  key: string,
  courierId: number | null,
): Promise<void> {
  assertCan(actor, "delivery.assign");
  const db = await handle();

  if (courierId !== null) {
    const [company] = await db
      .select({ id: couriers.id, status: couriers.status })
      .from(couriers)
      .where(eq(couriers.id, courierId))
      .limit(1);
    if (!company) throw new DispatchError("dispatch.unknownCourier");
    /* A suspended company is one NetLet has stopped working with, so it is not
       one work may be given to — the same lever suspending a vendor pulls. */
    if (company.status !== "active") throw new DispatchError("dispatch.courierSuspended");
  }

  const lines = await parcelIn(db, orderId, key);
  await db
    .update(orderItems)
    .set({ courierId })
    .where(inArray(orderItems.id, lines.map(line => line.lineId)));
}

/**
 * Collected, or handed over.
 *
 * The whole parcel moves at once, because a parcel half-shipped is not a thing
 * that happened: a driver either has the box or does not. `courierMoves` is the
 * same pure function the page draws its buttons from, so the API cannot accept
 * a move the board does not offer — and it is deliberately narrower than the
 * seller's own `nextStates`: walking a line backwards is a seller correcting a
 * mis-click, and cancelling is the seller's or the shopper's decision.
 *
 * `delivered_at` is stamped here as well as in `setLineFulfilment`, because it
 * is what the return window and review eligibility are both measured from and a
 * line saying "delivered" with no date is a parcel nobody can send back.
 */
export async function moveParcel(
  actor: Actor,
  orderId: number,
  key: string,
  to: FulfilmentState,
): Promise<void> {
  assertCan(actor, "delivery.move");
  const db = await handle();

  const lines = await parcelIn(db, orderId, key);

  const scope = readableCouriers(actor);
  if (scope !== "all") {
    /* Not their parcel: refused rather than answered, so a company cannot walk
       order ids to find out what another is carrying. */
    const theirs = lines.every(line => line.courierId === scope[0]);
    if (!theirs) throw new DispatchError("dispatch.notYours");
  }

  const allowed = courierMoves({ state: parcelState(lines) });
  if (!allowed.includes(to)) throw new DispatchError("dispatch.badMove");

  const deliveredAt = to === "delivered" ? new Date() : null;
  /*
   * Never over a line that left the parcel in the meantime. The parcel was read
   * above and the write follows, so a seller cancelling the sofa between the two
   * would have had it marked delivered — a cancelled line, unpaid for and
   * restocked, reading as handed over. The predicate is in the write for the
   * reason the stock take's is.
   */
  await db
    .update(orderItems)
    .set({
      fulfilment: to,
      deliveredAt,
      /* Who has it now (3.4.3): the driver who pressed "collected", so the
         shopper can be shown where that driver is. An administrator moving it
         on somebody's behalf names nobody. */
      ...(to === "shipped" && actor.kind === "courier" ? { carriedBy: actor.userId } : {}),
    })
    .where(and(
      inArray(orderItems.id, lines.map(line => line.lineId)),
      notInArray(orderItems.fulfilment, ["cancelled", "returned"]),
    ));
  /* The shopper hears the parcel left, or that everything arrived. */
  await tellOrderMoved(orderId, to);
}

/**
 * How many parcels are waiting for a driver, for a tile that hides at zero.
 *
 * Counted through `loadBoard`, so it counts exactly what the board would show
 * this actor — a tile with its own query is a tile that eventually disagrees
 * with the page it links to.
 */
export async function countWaitingParcels(actor: Actor): Promise<number> {
  const board = await loadBoard(actor, { state: "waiting" });
  return board.parcels.length;
}
