/**
 * Subscribe & Save (3.1.19), the database half. The rules are in
 * `Shared/commerce/subscriptions.ts`.
 *
 * **Every query is scoped by the shopper inside the data layer.** A
 * subscription id is a serial, so "pause subscription 4" has to be refused by
 * the query itself; another shopper's is "not found".
 *
 * **A run is claimed before it is placed.** The scheduler may be called twice
 * at once — a retry, two instances, somebody pressing "run now" during the
 * cron — so each due subscription is claimed by an `UPDATE` whose predicate is
 * the date it was due on: the first caller moves the date on, and the second
 * finds nothing to move and places nothing. Moving the date first also means a
 * run that fails half-way does not retry every minute and place three orders.
 *
 * **A run is an ordinary order.** It goes through `placeOrder` on a cart made
 * for the purpose, so stock, the cash-on-delivery ceiling, each seller's
 * delivery fee, the invoice and the dispatch board all treat it as they treat
 * an order somebody pressed a button for.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";
import { outer } from "./sqlRefs.js";
import {
  cartItems,
  carts,
  customerAddresses,
  productImages,
  productVariants,
  products,
  subscriptions,
  users,
  vendors,
} from "../../database/schema.js";
import { addDays, kuwaitToday } from "../../../Shared/commerce/adBookings.js";
import {
  MAX_SUBSCRIPTIONS,
  nextRunAfter,
  savingPercent,
  subscriberPrice,
  subscriptionProblem,
  withinCeiling,
  type PauseReason,
  type RunOutcome,
  type SubscriptionInterval,
  type SubscriptionProblem,
} from "../../../Shared/commerce/subscriptions.js";
import { discountAllowed } from "../../../Shared/inventory/discountLicence.js";
import { getDb } from "./db.js";
import { OrderRefused, placeOrder } from "./orders.js";
import { violatesUnique } from "../core/describeError.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type SubscriptionRefusal =
  | SubscriptionProblem
  | "subscriptions.notFound"
  | "subscriptions.unavailable"
  | "subscriptions.notOffered"
  | "subscriptions.unknownAddress"
  | "subscriptions.alreadyOpen"
  | "subscriptions.tooMany"
  | "subscriptions.cancelled"
  | "subscriptions.notPaused"
  | "subscriptions.priceChanged";

export class SubscriptionRefused extends Error {
  constructor(readonly reason: SubscriptionRefusal) {
    super(reason);
    this.name = "SubscriptionRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** What a variant costs a subscriber right now, or null when it cannot be subscribed to at all. */
async function liveTerms(db: Db, variantId: number) {
  const [row] = await db
    .select({
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      price: productVariants.price,
      productId: products.id,
      productTitle: products.title,
      productStatus: products.status,
      vendorId: vendors.id,
      vendorStatus: vendors.status,
      percent: vendors.subscriptionPercent,
      licenceNumber: vendors.discountLicenceNumber,
      licenceExpiresAt: vendors.discountLicenceExpiresAt,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (!row || row.productStatus !== "published" || row.vendorStatus !== "approved") return { kind: "unavailable" as const };
  const percent = savingPercent(row.percent, discountAllowed({ number: row.licenceNumber, expiresAt: row.licenceExpiresAt }).allowed);
  if (percent === null) return { kind: "notOffered" as const };
  return { kind: "ok" as const, row, percent, price: subscriberPrice(row.price, percent) };
}

/** The shopper's own address, or null. */
async function addressOf(db: Db, userId: number, addressId: number) {
  const [address] = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.userId, userId)))
    .limit(1);
  return address ?? null;
}

export type SubscribeRequest = {
  variantId: number;
  quantity: number;
  intervalWeeks: number;
  addressId: number;
  firstRunOn: string;
};

/**
 * Start a standing order. The price the shopper sees now becomes the ceiling
 * no run may charge above.
 */
export async function subscribe(userId: number, request: SubscribeRequest, now = new Date()) {
  const problem = subscriptionProblem(request, kuwaitToday(now));
  if (problem) throw new SubscriptionRefused(problem);
  const db = await handle();

  const terms = await liveTerms(db, request.variantId);
  if (terms.kind === "unavailable") throw new SubscriptionRefused("subscriptions.unavailable");
  if (terms.kind === "notOffered") throw new SubscriptionRefused("subscriptions.notOffered");
  if (!(await addressOf(db, userId, request.addressId))) throw new SubscriptionRefused("subscriptions.unknownAddress");

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), ne(subscriptions.status, "cancelled")));
  if (count >= MAX_SUBSCRIPTIONS) throw new SubscriptionRefused("subscriptions.tooMany");

  try {
    const [row] = await db
      .insert(subscriptions)
      .values({
        userId,
        variantId: terms.row.variantId,
        productId: terms.row.productId,
        vendorId: terms.row.vendorId,
        productTitle: terms.row.productTitle.slice(0, 255),
        variantTitle: terms.row.variantTitle?.slice(0, 255) ?? null,
        quantity: request.quantity,
        intervalWeeks: request.intervalWeeks,
        addressId: request.addressId,
        priceCeiling: terms.price,
        nextRunOn: request.firstRunOn,
      })
      .returning({ id: subscriptions.id, priceCeiling: subscriptions.priceCeiling, nextRunOn: subscriptions.nextRunOn });
    return row;
  } catch (error) {
    /* Two tabs, one variant: the partial unique index is what refuses the second. */
    if (violatesUnique(error, "subscriptions_one_open")) throw new SubscriptionRefused("subscriptions.alreadyOpen");
    throw error;
  }
}

export type SubscriptionView = {
  id: number;
  productTitle: string;
  variantTitle: string | null;
  productHandle: string | null;
  image: string | null;
  quantity: number;
  intervalWeeks: number;
  addressId: number | null;
  addressLabel: string | null;
  status: "active" | "paused" | "cancelled";
  pausedReason: PauseReason | null;
  nextRunOn: string;
  lastRunOn: string | null;
  lastOutcome: RunOutcome | null;
  /** The per-unit price agreed to, which no run charges above. */
  priceCeiling: string;
  /** What a run would charge per unit today, or null when it cannot run at all. */
  priceNow: string | null;
  savingPercent: number | null;
};

/** The shopper's standing orders, open ones first, newest first. */
export async function mySubscriptions(userId: number): Promise<SubscriptionView[]> {
  const db = await handle();
  const rows = await db
    .select({
      sub: subscriptions,
      handle: products.handle,
      addressLabel: customerAddresses.label,
      image: sql<string | null>`(select ${productImages.url} from ${productImages} where ${productImages.productId} = ${outer(subscriptions.productId)} and ${productImages.kind} = 'image' order by ${productImages.position}, ${productImages.id} limit 1)`,
    })
    .from(subscriptions)
    .leftJoin(products, eq(subscriptions.productId, products.id))
    .leftJoin(customerAddresses, and(eq(subscriptions.addressId, customerAddresses.id), eq(customerAddresses.userId, userId)))
    .where(eq(subscriptions.userId, userId))
    .orderBy(sql`${subscriptions.status} = 'cancelled'`, desc(subscriptions.id))
    .limit(MAX_SUBSCRIPTIONS * 2);

  const views: SubscriptionView[] = [];
  for (const { sub, handle: productHandle, addressLabel, image } of rows) {
    const terms = sub.variantId && sub.status !== "cancelled" ? await liveTerms(db, sub.variantId) : null;
    views.push({
      id: sub.id,
      productTitle: sub.productTitle,
      variantTitle: sub.variantTitle,
      productHandle,
      image,
      quantity: sub.quantity,
      intervalWeeks: sub.intervalWeeks,
      addressId: sub.addressId,
      addressLabel,
      status: sub.status,
      pausedReason: (sub.pausedReason as PauseReason | null) ?? null,
      nextRunOn: sub.nextRunOn,
      lastRunOn: sub.lastRunOn,
      lastOutcome: (sub.lastOutcome as RunOutcome | null) ?? null,
      priceCeiling: sub.priceCeiling,
      priceNow: terms?.kind === "ok" ? terms.price : null,
      savingPercent: terms?.kind === "ok" ? terms.percent : null,
    });
  }
  return views;
}

export type SubscriptionChange =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "skip" }
  | { action: "cancel" }
  /** Accept today's price as the new ceiling, and run again. */
  | { action: "acceptPrice"; price: string }
  | { action: "edit"; quantity?: number; intervalWeeks?: number; addressId?: number };

/**
 * Change a standing order. Each action is one `UPDATE` scoped by the shopper,
 * and every predicate that matters — not cancelled, actually paused — is in it.
 */
export async function changeSubscription(userId: number, id: number, change: SubscriptionChange, now = new Date()): Promise<void> {
  const db = await handle();
  const today = kuwaitToday(now);
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!sub) throw new SubscriptionRefused("subscriptions.notFound");
  if (sub.status === "cancelled") throw new SubscriptionRefused("subscriptions.cancelled");
  const mine = and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), ne(subscriptions.status, "cancelled"));
  /* A run date already behind us would fire at the next tick; resuming starts tomorrow. */
  const resumeOn = sub.nextRunOn > today ? sub.nextRunOn : addDays(today, 1);

  switch (change.action) {
    case "pause":
      await db.update(subscriptions).set({ status: "paused", pausedReason: "byShopper" }).where(mine);
      return;
    case "resume": {
      if (sub.status !== "paused") throw new SubscriptionRefused("subscriptions.notPaused");
      /* A price that rose has to be looked at and accepted, not waved through. */
      if (sub.pausedReason === "priceRose") throw new SubscriptionRefused("subscriptions.priceChanged");
      await db.update(subscriptions).set({ status: "active", pausedReason: null, nextRunOn: resumeOn }).where(and(mine, eq(subscriptions.status, "paused")));
      return;
    }
    case "skip": {
      await db.update(subscriptions)
        .set({ nextRunOn: nextRunAfter(sub.nextRunOn, sub.intervalWeeks as SubscriptionInterval, today) })
        .where(and(mine, eq(subscriptions.nextRunOn, sub.nextRunOn)));
      return;
    }
    case "cancel":
      await db.update(subscriptions).set({ status: "cancelled", pausedReason: null }).where(mine);
      return;
    case "acceptPrice": {
      if (!sub.variantId) throw new SubscriptionRefused("subscriptions.unavailable");
      const terms = await liveTerms(db, sub.variantId);
      if (terms.kind !== "ok") throw new SubscriptionRefused(terms.kind === "notOffered" ? "subscriptions.notOffered" : "subscriptions.unavailable");
      /* The page showed a price; if it moved again since, the shopper has not
         agreed to *this* one. */
      if (terms.price !== change.price) throw new SubscriptionRefused("subscriptions.priceChanged");
      await db.update(subscriptions)
        .set({ priceCeiling: terms.price, status: "active", pausedReason: null, nextRunOn: resumeOn })
        .where(mine);
      return;
    }
    case "edit": {
      const next = {
        intervalWeeks: change.intervalWeeks ?? sub.intervalWeeks,
        quantity: change.quantity ?? sub.quantity,
        firstRunOn: resumeOn,
      };
      const problem = subscriptionProblem(next, today);
      if (problem && problem !== "subscriptions.tooFar") throw new SubscriptionRefused(problem);
      if (change.addressId !== undefined && !(await addressOf(db, userId, change.addressId))) {
        throw new SubscriptionRefused("subscriptions.unknownAddress");
      }
      await db.update(subscriptions).set({
        quantity: next.quantity,
        intervalWeeks: next.intervalWeeks,
        ...(change.addressId !== undefined ? { addressId: change.addressId } : {}),
        /* A new address answers "no address"; the shopper still has to resume. */
      }).where(mine);
      return;
    }
  }
}

/** How many standing orders there are and how many are due — for an administrator, never a shopper. */
export async function subscriptionOverview(now = new Date()) {
  const db = await handle();
  const today = kuwaitToday(now);
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')::int`,
      paused: sql<number>`count(*) filter (where ${subscriptions.status} = 'paused')::int`,
      due: sql<number>`count(*) filter (where ${subscriptions.status} = 'active' and ${subscriptions.nextRunOn} <= ${today})::int`,
    })
    .from(subscriptions);
  return { active: row?.active ?? 0, paused: row?.paused ?? 0, due: row?.due ?? 0 };
}

export type RunSummary = { due: number; placed: number; outOfStock: number; paused: number };

async function pause(db: Db, id: number, reason: PauseReason) {
  await db.update(subscriptions).set({ status: "paused", pausedReason: reason }).where(eq(subscriptions.id, id));
}

/**
 * Place every standing order that has come due. Called by the scheduler
 * (`/api/cron/subscriptions`) and by an administrator's "run now".
 */
export async function runDueSubscriptions(now = new Date(), limit = 200): Promise<RunSummary> {
  const db = await handle();
  const today = kuwaitToday(now);
  const summary: RunSummary = { due: 0, placed: 0, outOfStock: 0, paused: 0 };

  const due = await db
    .select({ id: subscriptions.id, nextRunOn: subscriptions.nextRunOn, intervalWeeks: subscriptions.intervalWeeks })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), lte(subscriptions.nextRunOn, today)))
    .orderBy(asc(subscriptions.nextRunOn), asc(subscriptions.id))
    .limit(limit);

  for (const candidate of due) {
    /* Claimed by moving the date: a second caller finds it already moved. */
    const [sub] = await db
      .update(subscriptions)
      .set({ nextRunOn: nextRunAfter(candidate.nextRunOn, candidate.intervalWeeks as SubscriptionInterval, today), lastRunOn: today })
      .where(and(eq(subscriptions.id, candidate.id), eq(subscriptions.status, "active"), eq(subscriptions.nextRunOn, candidate.nextRunOn)))
      .returning();
    if (!sub) continue;
    summary.due++;

    try {
      const outcome = await runOne(db, sub);
      if (outcome === "placed") summary.placed++;
      else if (outcome === "outOfStock") summary.outOfStock++;
      else summary.paused++;
    } catch (error) {
      /* One shopper's broken run must not stop everybody else's. The date has
         already moved on, so it is not retried in a loop. */
      console.error(`[subscriptions] run ${sub.id} failed`, error);
    }
  }
  return summary;
}

async function runOne(db: Db, sub: typeof subscriptions.$inferSelect): Promise<RunOutcome | "paused"> {
  const address = sub.addressId ? await addressOf(db, sub.userId, sub.addressId) : null;
  if (!address) { await pause(db, sub.id, "noAddress"); return "paused"; }
  if (!sub.variantId) { await pause(db, sub.id, "unavailable"); return "paused"; }

  const terms = await liveTerms(db, sub.variantId);
  if (terms.kind !== "ok") { await pause(db, sub.id, "unavailable"); return "paused"; }
  if (!withinCeiling(terms.price, sub.priceCeiling)) { await pause(db, sub.id, "priceRose"); return "paused"; }

  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, sub.userId)).limit(1);
  if (!user) return "paused";

  const cartId = randomBytes(24).toString("base64url");
  await db.insert(carts).values({ id: cartId, userId: sub.userId });
  try {
    await db.insert(cartItems).values({ cartId, variantId: sub.variantId, quantity: sub.quantity });
    const placed = await placeOrder(cartId, {
      email: user.email,
      userId: sub.userId,
      contactName: address.contactName ?? user.name ?? null,
      contactPhone: address.contactPhone ?? null,
      deliveryZoneId: address.governorate ?? null,
      addressLine: address.addressLine,
      addressNotes: address.addressNotes ?? null,
      pin: address.pin ?? null,
      paymentMethod: "cod",
      subscription: { id: sub.id, variantId: sub.variantId, percent: terms.percent },
    });
    await db.update(subscriptions).set({ lastOutcome: "placed", lastOrderId: placed.order.id }).where(eq(subscriptions.id, sub.id));
    return "placed";
  } catch (error) {
    if (error instanceof OrderRefused) {
      /* Out of stock skips this delivery and keeps the order standing — the
         next one may well be on the shelf. Anything else (cash refused over
         the ceiling, the store no longer taking cash) needs the shopper. */
      if (error.reason === "order.outOfStock") {
        await db.update(subscriptions).set({ lastOutcome: "outOfStock" }).where(eq(subscriptions.id, sub.id));
        return "outOfStock";
      }
      await pause(db, sub.id, "refused");
      return "paused";
    }
    throw error;
  } finally {
    /* The cart existed only to carry this run. */
    await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
    await db.delete(carts).where(eq(carts.id, cartId));
  }
}
