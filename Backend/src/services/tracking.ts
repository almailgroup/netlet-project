/**
 * Live tracking (3.4.3), the database half. The rules are
 * `Shared/commerce/tracking.ts`.
 *
 * Two doors, and each is narrow on purpose:
 *
 * - **A driver writes their own position**, and only a courier actor may —
 *   not a seller, not an administrator acting for somebody. One row per driver,
 *   overwritten; stopping deletes it.
 * - **A shopper reads only their own order**, scoped by account inside the
 *   query, and only for parcels collected and not yet handed over by the driver
 *   whose position it is, while that driver still works for the company
 *   carrying them. Nothing about the driver but where they are and which
 *   company they drive for — no name, no other parcels, no history.
 */
import { and, eq, lt, ne, or } from "drizzle-orm";
import { courierMembers, couriers, driverPositions, orderItems, orders } from "../../database/schema.js";
import { pinProblem, storedPin, type Pin } from "../../../Shared/commerce/geo.js";
import { MIN_SHARE_INTERVAL_MS, etaFor, isFresh, type Eta } from "../../../Shared/commerce/tracking.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export class TrackingError extends Error {
  constructor(readonly reason: "tracking.notDriver" | "tracking.outsideKuwait" | "tracking.notFound") {
    super(reason);
    this.name = "TrackingError";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

function driverOf(actor: Actor) {
  if (actor.kind !== "courier") throw new TrackingError("tracking.notDriver");
  assertCan(actor, "delivery.move");
  return actor;
}

/**
 * Record where this driver is. A position closer in time than
 * `MIN_SHARE_INTERVAL_MS` to the last one is dropped rather than written —
 * the predicate is in the upsert, so a phone reporting every second costs one
 * write in ten.
 */
export async function sharePosition(actor: Actor, at: { lat: number; lng: number; accuracy?: number | null }, now = new Date()): Promise<{ kept: boolean }> {
  const driver = driverOf(actor);
  const problem = pinProblem(at);
  /* A driver abroad, or a phone reporting nonsense, is not a delivery in Kuwait. */
  if (problem) throw new TrackingError("tracking.outsideKuwait");
  const position = storedPin(at)!;
  const accuracyM = at.accuracy !== undefined && at.accuracy !== null && Number.isFinite(at.accuracy)
    ? Math.min(100_000, Math.max(0, Math.round(at.accuracy)))
    : null;
  const db = await handle();
  const written = await db
    .insert(driverPositions)
    .values({ userId: driver.userId, courierId: driver.courierId, position, accuracyM, recordedAt: now })
    .onConflictDoUpdate({
      target: driverPositions.userId,
      set: { courierId: driver.courierId, position, accuracyM, recordedAt: now },
      setWhere: or(
        lt(driverPositions.recordedAt, new Date(now.getTime() - MIN_SHARE_INTERVAL_MS)),
        /* Moved to another company since: the row follows the driver at once. */
        ne(driverPositions.courierId, driver.courierId),
      ),
    })
    .returning({ userId: driverPositions.userId });
  return { kept: written.length > 0 };
}

/** Stop sharing: the row goes, so there is nothing left to show anybody. */
export async function stopSharing(actor: Actor): Promise<void> {
  const driver = driverOf(actor);
  const db = await handle();
  await db.delete(driverPositions).where(eq(driverPositions.userId, driver.userId));
}

/** Whether this driver is sharing, and when they last reported. */
export async function mySharing(actor: Actor): Promise<{ sharing: boolean; recordedAt: Date | null }> {
  const driver = driverOf(actor);
  const db = await handle();
  const [row] = await db.select({ recordedAt: driverPositions.recordedAt }).from(driverPositions).where(eq(driverPositions.userId, driver.userId)).limit(1);
  return { sharing: Boolean(row), recordedAt: row?.recordedAt ?? null };
}

export type Tracked = {
  courierName: string;
  sellers: string[];
  /** The door's own label when the parcel went to a second address, or null for the order's. */
  doorLabel: string | null;
  driver: Pin | null;
  recordedAt: Date | null;
  door: Pin | null;
  eta: Eta | null;
};

/**
 * What a shopper may see of the parcels on one order that are on the road.
 * Empty when nothing is in transit; a parcel whose driver is not sharing comes
 * back with no position, so the panel can say so rather than show nothing.
 */
export async function trackOrder(userId: number, reference: string, now = new Date()): Promise<Tracked[]> {
  const db = await handle();
  const [order] = await db
    .select({ id: orders.id, deliveryPin: orders.deliveryPin })
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  if (!order) throw new TrackingError("tracking.notFound");

  const lines = await db
    .select({
      vendorName: orderItems.vendorName,
      destination: orderItems.destination,
      carriedBy: orderItems.carriedBy,
      courierId: orderItems.courierId,
      courierName: couriers.name,
    })
    .from(orderItems)
    .leftJoin(couriers, eq(orderItems.courierId, couriers.id))
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.fulfilment, "shipped")));

  /* One entry per driver and door: a driver carrying two of this order's
     parcels to two addresses is two journeys with two estimates. */
  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = `${line.carriedBy ?? "-"}|${line.courierId ?? "-"}|${line.destination?.label ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const result: Tracked[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const door = storedPin(first.destination ? first.destination.pin ?? null : order.deliveryPin);
    let driver: Pin | null = null;
    let recordedAt: Date | null = null;
    if (first.carriedBy && first.courierId) {
      /* Still with the company carrying it, and sharing for that company. */
      const [row] = await db
        .select({ position: driverPositions.position, recordedAt: driverPositions.recordedAt })
        .from(driverPositions)
        .innerJoin(courierMembers, and(eq(courierMembers.userId, driverPositions.userId), eq(courierMembers.courierId, driverPositions.courierId)))
        .where(and(eq(driverPositions.userId, first.carriedBy), eq(driverPositions.courierId, first.courierId)))
        .limit(1);
      if (row && isFresh(row.recordedAt, now)) {
        driver = row.position;
        recordedAt = row.recordedAt;
      }
    }
    result.push({
      courierName: first.courierName ?? "",
      sellers: [...new Set(group.map(line => line.vendorName).filter((name): name is string => Boolean(name)))],
      doorLabel: first.destination?.label ?? null,
      driver,
      recordedAt,
      door,
      eta: driver && door ? etaFor(driver, door) : null,
    });
  }
  return result;
}
