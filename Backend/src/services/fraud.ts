/**
 * Gathering what the fraud signals need to judge an order.
 *
 * Requirement 3.6.5. `Shared/commerce/fraudSignals.ts` is the judgement and is
 * pure; this is the counting it cannot do — how old the account was, how many
 * other accounts have used that address, how often this one refunds.
 *
 * Outside `db.ts` for the reason `orders.ts`, `applications.ts` and
 * `finance.ts` are: functions inside it reach its module-local `getDb`, which
 * nothing outside can redirect, so anything living there cannot be tested
 * against a real database.
 *
 * **Admin-only, and the guard is beside the query.** The signals name other
 * accounts' behaviour — "four accounts have used this address" is a fact about
 * people who are not this seller's customers — so a vendor reading their own
 * order desk does not get them. What a seller needs to know about a risky cash
 * order is a separate, narrower question, and inventing an answer to it by
 * leaking this one would be the wrong way round.
 */
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notifications, orderItems, orders, referrals, reviews, users, vendorMembers } from "../../database/schema.js";
import {
  fraudFlags,
  referralFlags,
  reviewFlags,
  riskOf,
  type Flag,
  type ReferralFlag,
  type ReviewFlag,
  type RiskLevel,
} from "../../../Shared/commerce/fraudSignals.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { describeError } from "../core/describeError.js";
import { getDb } from "./db.js";
import { notifyStaff } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type OrderRisk = { orderId: number; risk: RiskLevel; flags: Flag[] };

/**
 * Judge a set of orders the caller already has on screen.
 *
 * Takes ids rather than running its own query, the way the product review
 * triage does: this is a second opinion about a page somebody is looking at,
 * not a separate view of which orders exist.
 */
export async function riskForOrders(actor: Actor, orderIds: number[]): Promise<OrderRisk[]> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db || orderIds.length === 0) return [];
  return judgeOrders(db, orderIds);
}

/** The judgement itself, unguarded: the page's door above and the alerts below. */
async function judgeOrders(db: Db, orderIds: number[]): Promise<OrderRisk[]> {

  const rows = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      grandTotal: orders.grandTotal,
      paymentMethod: orders.paymentMethod,
      addressLine: orders.addressLine,
      placedAt: orders.placedAt,
      accountCreatedAt: users.createdAt,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(inArray(orders.id, orderIds));

  const judged: OrderRisk[] = [];
  for (const row of rows) {
    /*
     * One query each rather than one clever aggregate: these run over a page
     * of twenty at most, and an aggregate joining a shopper's whole history to
     * an address history to a refund count is the kind of query that is wrong
     * in a way nobody notices for a year.
     */
    /*
     * The day before this order, and the comparison built with `gt` rather
     * than written into the fragment by hand.
     *
     * Two separate traps here, and the second is the one this codebase has
     * already been bitten by. `${date} - interval '1 day'` binds the date as
     * an untyped parameter with no column beside it to infer from, and
     * Postgres refuses the whole query. Interpolating a bare JS `Date` into a
     * raw fragment skips the column's own mapper — which **PGlite accepts and
     * postgres.js throws on**, so every test passes and every real request
     * 500s. That is the wishlist's `lt(column, date)` lesson exactly, and it
     * was reproduced here by calling the endpoint rather than by reasoning.
     */
    const dayBefore = new Date(row.placedAt.getTime() - 24 * 60 * 60 * 1000);
    const [history] = row.userId
      ? await db
          .select({
            all: sql<string>`count(*)`,
            refunded: sql<string>`count(*) filter (where ${orders.status} = 'refunded')`,
            lastDay: sql<string>`count(*) filter (where ${gt(orders.placedAt, dayBefore)})`,
          })
          .from(orders)
          .where(eq(orders.userId, row.userId))
      : [undefined];

    /* Other accounts, not this one: the shopper's own repeat orders to their
       own address are the ordinary case and would drown the signal. */
    const [atAddress] = row.addressLine
      ? await db
          .select({ accounts: sql<string>`count(distinct ${orders.userId})` })
          .from(orders)
          .where(
            and(
              eq(orders.addressLine, row.addressLine),
              row.userId ? ne(orders.userId, row.userId) : undefined,
              gt(orders.placedAt, new Date(row.placedAt.getTime() - 30 * 24 * 60 * 60 * 1000)),
            ),
          )
      : [undefined];

    const [largest] = await db
      .select({ quantity: sql<string>`coalesce(max(${orderItems.quantity}), 0)` })
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id));

    const flags = fraudFlags({
      grandTotal: row.grandTotal,
      paymentMethod: row.paymentMethod,
      accountAgeHours: row.accountCreatedAt
        ? Math.max(0, (row.placedAt.getTime() - row.accountCreatedAt.getTime()) / 3_600_000)
        : /* A guest order has no account to age. Treated as brand new, which
             errs toward looking rather than away. */
          0,
      ordersLastDay: Number(history?.lastDay ?? 1),
      /* The order's own account is excluded above, so this is "others, plus
         this one" — which is what the threshold is written against. */
      accountsAtAddress: Number(atAddress?.accounts ?? 0) + 1,
      ordersAllTime: Number(history?.all ?? 1),
      refundedAllTime: Number(history?.refunded ?? 0),
      largestLineQuantity: Number(largest?.quantity ?? 1),
    });

    judged.push({ orderId: row.id, risk: riskOf(flags), flags });
  }

  return judged;
}

/* ------------------------------------------------- reviews and referrals --- */

/** How many of the newest reviews and referrals the fraud page reads. */
export const WATCH_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/* One door, however it was typed: case, spaces and punctuation dropped. */
const sameDoor = (address: string | null) => (address ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const samePhone = (phone: string | null) => (phone ?? "").replace(/\D+/g, "").slice(-8);

export type ReviewWatchRow = {
  id: number;
  productId: number | null;
  productTitle: string;
  rating: number;
  title: string | null;
  body: string | null;
  reviewerEmail: string | null;
  createdAt: Date;
  hidden: boolean;
  hiddenReason: string | null;
  risk: RiskLevel;
  flags: ReviewFlag[];
};

/**
 * The newest reviews, each judged (3.6.5: "fake reviews"). Admin-only beside
 * the query: the signals are about other accounts — who else shares an
 * address, who works for the store.
 */
export async function reviewWatch(actor: Actor, limit = WATCH_LIMIT): Promise<ReviewWatchRow[]> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];
  return judgeReviews(db, { limit });
}

async function judgeReviews(db: Db, scope: { limit: number; reviewId?: number }): Promise<ReviewWatchRow[]> {
  const rows = await db
    .select({
      id: reviews.id,
      userId: reviews.userId,
      productId: reviews.productId,
      vendorId: reviews.vendorId,
      productTitle: reviews.productTitle,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      createdAt: reviews.createdAt,
      hiddenAt: reviews.hiddenAt,
      hiddenReason: reviews.hiddenReason,
      email: users.email,
      accountCreatedAt: users.createdAt,
      addressLine: orders.addressLine,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .leftJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    .leftJoin(orders, eq(orders.id, orderItems.orderId))
    .where(scope.reviewId === undefined ? undefined : eq(reviews.id, scope.reviewId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(scope.limit);
  if (!rows.length) return [];

  const reviewerIds = [...new Set(rows.map(row => row.userId))];
  const productIds = [...new Set(rows.flatMap(row => (row.productId === null ? [] : [row.productId])))];

  const memberships = await db
    .select({ userId: vendorMembers.userId, vendorId: vendorMembers.vendorId })
    .from(vendorMembers)
    .where(inArray(vendorMembers.userId, reviewerIds));
  const seller = new Set(memberships.map(row => `${row.userId}:${row.vendorId}`));

  /* Every review of these products, for bursts and shared doors. */
  const siblings = productIds.length
    ? await db
        .select({ productId: reviews.productId, userId: reviews.userId, createdAt: reviews.createdAt, addressLine: orders.addressLine })
        .from(reviews)
        .leftJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
        .leftJoin(orders, eq(orders.id, orderItems.orderId))
        .where(inArray(reviews.productId, productIds))
    : [];

  const habits = await db
    .select({ userId: reviews.userId, count: sql<string>`count(*)`, ratings: sql<string>`count(distinct ${reviews.rating})` })
    .from(reviews)
    .where(inArray(reviews.userId, reviewerIds))
    .groupBy(reviews.userId);
  const habitOf = new Map(habits.map(row => [row.userId, row]));

  return rows.map(row => {
    const same = siblings.filter(other => other.productId === row.productId);
    const door = sameDoor(row.addressLine);
    const habit = habitOf.get(row.userId);
    const flags = reviewFlags({
      rating: row.rating,
      reviewerIsSeller: row.vendorId !== null && seller.has(`${row.userId}:${row.vendorId}`),
      otherReviewersAtAddress: door
        ? new Set(same.filter(other => other.userId !== row.userId && sameDoor(other.addressLine) === door).map(other => other.userId)).size
        : 0,
      reviewsSameDay: same.filter(other => Math.abs(other.createdAt.getTime() - row.createdAt.getTime()) <= DAY_MS).length,
      accountAgeHours: Math.max(0, (row.createdAt.getTime() - row.accountCreatedAt.getTime()) / 3_600_000),
      reviewerReviews: Number(habit?.count ?? 1),
      reviewerDistinctRatings: Number(habit?.ratings ?? 1),
    });
    return {
      id: row.id,
      productId: row.productId,
      productTitle: row.productTitle,
      rating: row.rating,
      title: row.title,
      body: row.body ? row.body.slice(0, 400) : null,
      reviewerEmail: row.email,
      createdAt: row.createdAt,
      hidden: row.hiddenAt !== null,
      hiddenReason: row.hiddenReason,
      risk: riskOf(flags),
      flags,
    };
  });
}

export type ReferralWatchRow = {
  id: number;
  referrerEmail: string | null;
  referredEmail: string | null;
  createdAt: Date;
  qualifiedAt: Date | null;
  risk: RiskLevel;
  flags: ReferralFlag[];
};

/**
 * The newest referrals, each judged (3.6.5: "points and referral system
 * abuse"): two accounts that share a door, a phone or a mailbox, a qualifying
 * order that went back, a referrer bringing in more than a week can explain.
 */
export async function referralWatch(actor: Actor, limit = WATCH_LIMIT): Promise<ReferralWatchRow[]> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];
  return judgeReferrals(db, { limit });
}

async function judgeReferrals(db: Db, scope: { limit: number; referredId?: number }): Promise<ReferralWatchRow[]> {
  const referrer = alias(users, "referrer");
  const referred = alias(users, "referred");
  const rows = await db
    .select({
      id: referrals.id,
      referrerId: referrals.referrerId,
      referredId: referrals.referredId,
      createdAt: referrals.createdAt,
      qualifiedAt: referrals.qualifiedAt,
      qualifiedOrderId: referrals.qualifiedOrderId,
      referrerEmail: referrer.email,
      referredEmail: referred.email,
    })
    .from(referrals)
    .innerJoin(referrer, eq(referrer.id, referrals.referrerId))
    .innerJoin(referred, eq(referred.id, referrals.referredId))
    .where(scope.referredId === undefined ? undefined : eq(referrals.referredId, scope.referredId))
    .orderBy(desc(referrals.createdAt), desc(referrals.id))
    .limit(scope.limit);
  if (!rows.length) return [];

  const people = [...new Set(rows.flatMap(row => [row.referrerId, row.referredId]))];
  const placed = await db
    .select({ id: orders.id, userId: orders.userId, addressLine: orders.addressLine, contactPhone: orders.contactPhone, status: orders.status })
    .from(orders)
    .where(inArray(orders.userId, people));
  const doors = new Map<number, Set<string>>();
  const phones = new Map<number, Set<string>>();
  for (const order of placed) {
    if (order.userId === null) continue;
    const door = sameDoor(order.addressLine);
    const phone = samePhone(order.contactPhone);
    if (door) doors.set(order.userId, new Set([...(doors.get(order.userId) ?? []), door]));
    if (phone.length >= 7) phones.set(order.userId, new Set([...(phones.get(order.userId) ?? []), phone]));
  }
  const overlap = (map: Map<number, Set<string>>, a: number, b: number) => [...(map.get(a) ?? [])].some(value => map.get(b)?.has(value));
  const statusOf = new Map(placed.map(order => [order.id, order.status]));

  const referrerIds = [...new Set(rows.map(row => row.referrerId))];
  const theirs = await db
    .select({ referrerId: referrals.referrerId, createdAt: referrals.createdAt })
    .from(referrals)
    .where(inArray(referrals.referrerId, referrerIds));

  return rows.map(row => {
    const status = row.qualifiedOrderId ? statusOf.get(row.qualifiedOrderId) : undefined;
    const flags = referralFlags({
      sharedAddress: overlap(doors, row.referrerId, row.referredId),
      sharedPhone: overlap(phones, row.referrerId, row.referredId),
      referrerEmail: row.referrerEmail ?? "",
      referredEmail: row.referredEmail ?? "",
      qualifyingRefunded: status === "refunded" || status === "cancelled",
      referrerWeek: theirs.filter(other => other.referrerId === row.referrerId && Math.abs(other.createdAt.getTime() - row.createdAt.getTime()) <= 7 * DAY_MS).length,
    });
    return {
      id: row.id,
      referrerEmail: row.referrerEmail,
      referredEmail: row.referredEmail,
      createdAt: row.createdAt,
      qualifiedAt: row.qualifiedAt,
      risk: riskOf(flags),
      flags,
    };
  });
}

/* -------------------------------------------------------------- alerts --- */

/**
 * Telling the administrators (3.6.5: the signals "alert" as well as show).
 *
 * The fraud page judged whatever was on it when somebody opened it, so a
 * high-risk order could be packed and sent before anybody looked. Now each of
 * the three things it watches is judged once, the moment it happens — an order
 * placed, a review written, a referral paid out — by the same function the page
 * uses, and a **high** one is a notice to every administrator (inbox and, where
 * configured, email). Never "watch": a notice for every small oddity is one
 * people learn to ignore, and the page still shows those.
 *
 * Each runs after the act and never in its way — a judgement that fails is
 * logged, and the order, review or payout stands. It still flags and never
 * acts: nothing here holds an order or hides a review.
 */
/* Orders are looked at on the orders page, reviews and referrals on the fraud
   page, so each page reads its own alerts. */
const ALERT_KINDS = {
  orders: ["staff_fraud_order"],
  watch: ["staff_fraud_review", "staff_fraud_referral"],
} as const;
export type AlertDesk = keyof typeof ALERT_KINDS;

async function quietly(what: string, alert: (db: Db) => Promise<void>): Promise<void> {
  try {
    const db = await getDb();
    if (db) await alert(db);
  } catch (error) {
    console.error(`[fraud] could not judge ${what}: ${describeError(error)}`);
  }
}

/** After an order is placed. */
export async function alertIfRiskyOrder(orderId: number): Promise<void> {
  await quietly(`order ${orderId}`, async db => {
    const [judged] = await judgeOrders(db, [orderId]);
    if (judged?.risk !== "high") return;
    const [order] = await db.select({ reference: orders.reference }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return;
    await notifyStaff({ kind: "staff_fraud_order", params: { reference: order.reference }, link: "/admin/orders", dedupe: `fraud:order:${orderId}` });
  });
}

/** After a review is written. */
export async function alertIfRiskyReview(reviewId: number): Promise<void> {
  await quietly(`review ${reviewId}`, async db => {
    const [judged] = await judgeReviews(db, { limit: 1, reviewId });
    if (judged?.risk !== "high") return;
    await notifyStaff({ kind: "staff_fraud_review", params: { product: judged.productTitle }, link: "/admin/fraud", dedupe: `fraud:review:${reviewId}` });
  });
}

/** After a referral pays out, which is when there is an order to compare. */
export async function alertIfRiskyReferral(referredUserId: number): Promise<void> {
  await quietly(`the referral of account ${referredUserId}`, async db => {
    const [judged] = await judgeReferrals(db, { limit: 1, referredId: referredUserId });
    if (judged?.risk !== "high") return;
    await notifyStaff({ kind: "staff_fraud_referral", link: "/admin/fraud", dedupe: `fraud:referral:${judged.id}` });
  });
}

/**
 * How many fraud alerts this administrator has not looked at, per desk — the
 * overview's tiles. Opening the desk reads them (`markFraudSeen`), so the
 * count is work, not a rolling window that never reaches zero.
 */
export async function fraudUnseen(actor: Actor): Promise<Record<AlertDesk, number>> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return { orders: 0, watch: 0 };
  const rows = await db
    .select({ kind: notifications.kind, n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), inArray(notifications.kind, [...ALERT_KINDS.orders, ...ALERT_KINDS.watch]), isNull(notifications.readAt)))
    .groupBy(notifications.kind);
  const count = (desk: AlertDesk) => rows.filter(row => (ALERT_KINDS[desk] as readonly string[]).includes(row.kind)).reduce((sum, row) => sum + row.n, 0);
  return { orders: count("orders"), watch: count("watch") };
}

export async function markFraudSeen(actor: Actor, desk: AlertDesk): Promise<void> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), inArray(notifications.kind, [...ALERT_KINDS[desk]]), isNull(notifications.readAt)));
}
