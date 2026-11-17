/**
 * Each store's delivery in the bag, chosen together (migration 0085, on the
 * owner's word): Standard or Express for all its lines, one address for all
 * of them, and a day and time of day the shopper would like.
 *
 * The rule for which days and windows may be chosen is
 * `Shared/commerce/deliverySlots.ts`; this is the database half. **One reader
 * decides for the bag and the order alike** (`storeSlotsFor`), so the days
 * the bag offers are the days the order accepts — the reason `getCart` and
 * `placeOrder` share `shopperPrice`.
 *
 * Every write is scoped by the bag, like every bag write: a guessed store id
 * changes nothing in somebody else's bag. An address must be this shopper's,
 * asked inside the write as `setLineDestination` asks.
 *
 * **Closed, not broken, until 0085 is pasted.** The bag reads no slots and
 * says `ready: false`, so the day and the time are not drawn and Standard,
 * Express and the address go on working; a write of a day says so in a
 * sentence; an order is placed without one.
 */
import { and, eq, inArray } from "drizzle-orm";
import { cartDeliverySlots, cartItems, customerAddresses, orderDeliverySlots, productVariants, products, vendors } from "../../database/schema.js";
import { skippedLineIds } from "../../../Shared/commerce/cartChoice.js";
import { effectiveChoice } from "../../../Shared/commerce/delivery.js";
import { isDeliverySpeed, speedForLine } from "../../../Shared/commerce/deliverySpeed.js";
import {
  isDeliveryWindow,
  slotDays,
  slotState,
  slotStillOffered,
  storeSlotSpeed,
  type DeliverySlot,
  type SlotDay,
  type SlotLine,
} from "../../../Shared/commerce/deliverySlots.js";
import { isMissingTable } from "../core/describeError.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export class StoreDeliveryRefused extends Error {
  constructor(
    public readonly reason:
      | "delivery.noStore"
      | "delivery.slotNotOffered"
      | "delivery.slotUnavailable"
      | "address.needsAccount"
      | "address.unknown",
  ) {
    super(reason);
    this.name = "StoreDeliveryRefused";
  }
}

export type StoreSlots = {
  /** Whether migration 0085 is in: until it is, no day or time is drawn or kept. */
  ready: boolean;
  stores: Map<number, { days: SlotDay[]; slot: DeliverySlot | null; state: "unset" | "kept" | "gone" }>;
};

/**
 * The days each store in this bag offers and the one the shopper chose.
 *
 * The days are of the lines chosen for this checkout (not in `skip`), the lines the
 * order will place; a store none of whose lines is chosen is read over all of
 * them, so its row still says what it would offer. Only the bag's buyable
 * lines count, `getCart`'s rule.
 */
export async function storeSlotsFor(
  db: Db,
  cartId: string,
  skip: readonly string[] = [],
  now: Date = new Date(),
): Promise<StoreSlots> {
  const rows = await db
    .select({
      lineId: cartItems.id,
      bundleId: cartItems.bundleId,
      vendorId: vendors.id,
      quantity: cartItems.quantity,
      deliveryChoice: cartItems.deliveryChoice,
      fastDeliveryFee: vendors.fastDeliveryFee,
      fastDeliverySpeed: vendors.fastDeliverySpeed,
      vendorSpeed: vendors.deliverySpeed,
      productSpeed: products.deliverySpeed,
      stock: productVariants.stock,
      preorderStock: productVariants.preorderStock,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(cartItems.cartId, cartId), eq(products.status, "published"), eq(vendors.status, "approved")));

  /* The lines left out of this checkout, a set whole (`cartChoice.ts`). */
  const skipped = skippedLineIds(
    rows.map(row => ({ lineId: String(row.lineId), bundleId: row.bundleId === null ? null : String(row.bundleId) })),
    skip,
  );
  const byStore = new Map<number, { all: SlotLine[]; chosen: SlotLine[] }>();
  for (const row of rows) {
    const line: SlotLine = {
      choice: effectiveChoice(row.deliveryChoice, { fastFlat: row.fastDeliveryFee }),
      /* A line the shelf cannot cover is a pre-order, whose promise is its release date. */
      speed: speedForLine(
        { preordered: row.stock < row.quantity && (row.preorderStock ?? 0) >= row.quantity },
        row.vendorSpeed,
        row.productSpeed,
      ),
      fastSpeed: isDeliverySpeed(row.fastDeliverySpeed) ? row.fastDeliverySpeed : null,
    };
    const held = byStore.get(row.vendorId) ?? { all: [], chosen: [] };
    held.all.push(line);
    if (!skipped.has(String(row.lineId))) held.chosen.push(line);
    byStore.set(row.vendorId, held);
  }

  let saved: { vendorId: number; date: string; window: string }[] = [];
  let ready = true;
  try {
    saved = await db
      .select({ vendorId: cartDeliverySlots.vendorId, date: cartDeliverySlots.deliveryDate, window: cartDeliverySlots.timeWindow })
      .from(cartDeliverySlots)
      .where(eq(cartDeliverySlots.cartId, cartId));
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    ready = false;
  }

  const stores: StoreSlots["stores"] = new Map();
  for (const [vendorId, lines] of byStore) {
    const days = ready ? slotDays(storeSlotSpeed(lines.chosen.length ? lines.chosen : lines.all), now) : [];
    const row = saved.find(entry => entry.vendorId === vendorId);
    const slot = row && isDeliveryWindow(row.window) ? { date: row.date, window: row.window } : null;
    stores.set(vendorId, { days, slot, state: slotState(slot, days) });
  }
  return { ready, stores };
}

/** What a shopper may change about one store's delivery at once. */
export type StoreDeliveryChange = {
  choice?: "regular" | "fast";
  /** A saved address for every line of the store, or null for the order's own. */
  addressId?: number | null;
  /** A day and window, or null for no preference. */
  slot?: DeliverySlot | null;
};

/**
 * Change one store's delivery in this bag: the trip every one of its lines
 * takes, the door every one goes to, and the day and time it would like.
 * Each part is optional, so the sheet sends what was pressed.
 *
 * The day is checked against what the store offers *after* the rest of the
 * change, so choosing Express and a day Express offers in one press holds.
 */
export async function setStoreDelivery(
  cartId: string,
  userId: number | null | undefined,
  vendorId: number,
  change: StoreDeliveryChange,
  skip: readonly string[] = [],
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const lines = await db
    .select({ id: cartItems.id })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(cartItems.cartId, cartId), eq(products.vendorId, vendorId)));
  const ids = lines.map(line => line.id);
  if (!ids.length) throw new StoreDeliveryRefused("delivery.noStore");

  if (change.addressId !== undefined && change.addressId !== null) {
    if (!userId) throw new StoreDeliveryRefused("address.needsAccount");
    const [owned] = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, change.addressId), eq(customerAddresses.userId, userId)))
      .limit(1);
    if (!owned) throw new StoreDeliveryRefused("address.unknown");
  }

  const set: { deliveryChoice?: "regular" | "fast"; addressId?: number | null } = {};
  if (change.choice) set.deliveryChoice = change.choice;
  if (change.addressId !== undefined) set.addressId = change.addressId;
  if (Object.keys(set).length) {
    await db.update(cartItems).set(set).where(and(eq(cartItems.cartId, cartId), inArray(cartItems.id, ids)));
  }

  if (change.slot === undefined) return;
  try {
    if (change.slot === null) {
      await db.delete(cartDeliverySlots).where(and(eq(cartDeliverySlots.cartId, cartId), eq(cartDeliverySlots.vendorId, vendorId)));
      return;
    }
    const offered = await storeSlotsFor(db, cartId, skip);
    if (!offered.ready) throw new StoreDeliveryRefused("delivery.slotUnavailable");
    const days = offered.stores.get(vendorId)?.days ?? [];
    if (!slotStillOffered(change.slot, days)) throw new StoreDeliveryRefused("delivery.slotNotOffered");
    await db
      .insert(cartDeliverySlots)
      .values({ cartId, vendorId, deliveryDate: change.slot.date, timeWindow: change.slot.window })
      .onConflictDoUpdate({
        target: [cartDeliverySlots.cartId, cartDeliverySlots.vendorId],
        set: { deliveryDate: change.slot.date, timeWindow: change.slot.window, updatedAt: new Date() },
      });
  } catch (error) {
    if (isMissingTable(error)) throw new StoreDeliveryRefused("delivery.slotUnavailable");
    throw error;
  }
}

/**
 * Freeze the bag's kept days onto a new order, inside its transaction, and
 * clear them from the bag for the stores the order took. Only called once a
 * read has found the table, so a missing table never aborts an order.
 */
export async function freezeSlots(
  w: Db,
  cartId: string,
  orderId: number,
  slots: StoreSlots,
  vendorIds: number[],
): Promise<void> {
  if (!slots.ready) return;
  const kept = vendorIds.flatMap(vendorId => {
    const store = slots.stores.get(vendorId);
    return store?.slot && store.state === "kept" ? [{ orderId, vendorId, deliveryDate: store.slot.date, timeWindow: store.slot.window }] : [];
  });
  if (kept.length) await w.insert(orderDeliverySlots).values(kept);
  if (vendorIds.length) {
    await w.delete(cartDeliverySlots).where(and(eq(cartDeliverySlots.cartId, cartId), inArray(cartDeliverySlots.vendorId, vendorIds)));
  }
}

export type OrderSlot = { vendorId: number | null; date: string; window: string };

/**
 * The days frozen on some orders, by order — what the shopper's order page,
 * the store's desk and the driver's board say. A missing table reads as none.
 */
export async function slotsForOrders(db: Db, orderIds: number[]): Promise<Map<number, OrderSlot[]>> {
  const found = new Map<number, OrderSlot[]>();
  if (!orderIds.length) return found;
  try {
    const rows = await db
      .select({
        orderId: orderDeliverySlots.orderId,
        vendorId: orderDeliverySlots.vendorId,
        date: orderDeliverySlots.deliveryDate,
        window: orderDeliverySlots.timeWindow,
      })
      .from(orderDeliverySlots)
      .where(inArray(orderDeliverySlots.orderId, [...new Set(orderIds)]))
      .orderBy(orderDeliverySlots.id);
    for (const row of rows) {
      const list = found.get(row.orderId) ?? [];
      list.push({ vendorId: row.vendorId, date: row.date, window: row.window });
      found.set(row.orderId, list);
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return found;
}
