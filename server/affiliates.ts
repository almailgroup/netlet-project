/**
 * Affiliate marketing (3.7), the database half. The rules are in
 * `shared/commerce/affiliate.ts`.
 *
 * Earnings live in the referral ledger, `point_entries`, in the `affiliate`
 * pot — one ledger, as `docs/REQUIREMENTS.md` asked from the start, so a
 * balance is still a sum and never a stored number, cashing out is still the
 * one flow an administrator marks off on the finance page, and both pots get
 * the same lock against two tabs spending one balance.
 *
 * Crediting and reversing are each exactly-once by a partial unique index —
 * one commission per order, one reversal per line — so pressing "cash
 * collected" twice, or receiving a return twice, cannot pay twice.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { affiliates, orderItems, orders, pointEntries, users } from "../drizzle/schema.js";
import {
  acceptableRate,
  affiliateCodeFor,
  canPayOut,
  DEFAULT_AFFILIATE_PERCENT,
  lineShareFils,
  orderShareFils,
  userIdFromAffiliateCode,
  type AffiliateStatus,
} from "../shared/commerce/affiliate.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { fromFils } from "../shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { describeError, violatesUnique } from "./_core/describeError.js";
import { recordAudit } from "./audit.js";
import { featureOn } from "./features.js";
import { auditActor } from "./inventory.js";
import { balanceFor, takePoints } from "./referral.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A refusal somebody can act on, as a message key. */
export class AffiliateRefused extends Error {
  constructor(readonly reason: "affiliate.disclosureRequired" | "affiliate.badRate" | "affiliate.notFound" | "affiliate.notEnough" | "affiliate.badName") {
    super(reason);
    this.name = "AffiliateRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/* ------------------------------------------------------------ applying --- */

/**
 * Ask to become an affiliate. Pending until an administrator approves it.
 *
 * Agreeing to disclose is a condition, not a box to tick later: promotion that
 * hides that it is paid is what advertising rules exist to stop, and a shop
 * paying for it is a party to it. A second application returns the first
 * rather than resetting its status, so a suspended affiliate cannot reapply
 * their way back to pending.
 */
export async function applyAsAffiliate(userId: number, input: { displayName: string; channel?: string | null; acceptDisclosure: boolean }) {
  if (!input.acceptDisclosure) throw new AffiliateRefused("affiliate.disclosureRequired");
  const displayName = input.displayName.trim();
  if (!displayName) throw new AffiliateRefused("affiliate.badName");
  const db = await handle();
  try {
    await db.insert(affiliates).values({
      userId,
      displayName,
      channel: input.channel?.trim() || null,
      ratePercent: DEFAULT_AFFILIATE_PERCENT,
      disclosureAcceptedAt: new Date(),
    });
  } catch (error) {
    if (!violatesUnique(error, "affiliates_user_unique")) throw error;
  }
  return affiliateDashboard(userId);
}

/* ------------------------------------------------------------- reading --- */

/** The affiliate a code names, if they may earn on it, and they are not the buyer. */
export async function earningAffiliate(db: Db, code: string | null | undefined, buyerUserId: number | null | undefined) {
  if (!code) return null;
  const userId = userIdFromAffiliateCode(code);
  if (userId === null || userId === buyerUserId) return null;
  const [row] = await db
    .select({ id: affiliates.id, displayName: affiliates.displayName, ratePercent: affiliates.ratePercent })
    .from(affiliates)
    .where(and(eq(affiliates.userId, userId), eq(affiliates.status, "active")))
    .limit(1);
  return row ?? null;
}

/**
 * The name a shopper is shown when they arrive through a link, or null.
 * Only what the affiliate chose to be known by — never their account.
 */
export async function publicAffiliate(code: string): Promise<{ displayName: string } | null> {
  const db = await getDb();
  if (!db || !(await featureOn("affiliates"))) return null;
  const found = await earningAffiliate(db, code, null);
  return found ? { displayName: found.displayName } : null;
}

export type AffiliateDashboard = {
  status: AffiliateStatus;
  code: string;
  displayName: string;
  channel: string | null;
  ratePercent: string;
  /** Orders this link brought that have been paid for, and those still waiting on payment. */
  paidOrders: number;
  waitingOrders: number;
  earned: string;
  reversed: string;
  balance: string;
  payout: ReturnType<typeof canPayOut>;
  entries: { id: number; amount: string; reason: string; orderReference: string | null; settledAt: Date | null; createdAt: Date }[];
};

/** The affiliate's own page, or null for somebody who has not applied. */
export async function affiliateDashboard(userId: number): Promise<AffiliateDashboard | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(affiliates).where(eq(affiliates.userId, userId)).limit(1);
  if (!row) return null;

  const [counts] = await db
    .select({
      paid: sql<string>`count(*) filter (where ${orders.status} in ('paid', 'refunded'))`,
      waiting: sql<string>`count(*) filter (where ${orders.status} = 'pending_payment')`,
    })
    .from(orders)
    .where(eq(orders.affiliateId, row.id));
  const [sums] = await db
    .select({
      earned: sql<string>`coalesce(sum(${pointEntries.points}) filter (where ${pointEntries.reason} = 'affiliate_commission'), 0)`,
      reversed: sql<string>`coalesce(-sum(${pointEntries.points}) filter (where ${pointEntries.reason} = 'affiliate_reversal'), 0)`,
    })
    .from(pointEntries)
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "affiliate")));
  const balance = BigInt(await balanceFor(db, userId, "affiliate"));
  const entries = await db
    .select({
      id: pointEntries.id,
      points: pointEntries.points,
      reason: pointEntries.reason,
      settledAt: pointEntries.settledAt,
      createdAt: pointEntries.createdAt,
      orderReference: orders.reference,
    })
    .from(pointEntries)
    .leftJoin(orders, eq(orders.id, pointEntries.orderId))
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "affiliate")))
    .orderBy(desc(pointEntries.createdAt), desc(pointEntries.id))
    .limit(50);

  return {
    status: row.status as AffiliateStatus,
    code: affiliateCodeFor(userId),
    displayName: row.displayName,
    channel: row.channel,
    ratePercent: row.ratePercent,
    paidOrders: Number(counts?.paid ?? 0),
    waitingOrders: Number(counts?.waiting ?? 0),
    earned: fromFils(BigInt(sums?.earned ?? 0)),
    reversed: fromFils(BigInt(sums?.reversed ?? 0)),
    balance: fromFils(balance),
    payout: canPayOut(balance),
    entries: entries.map(entry => ({
      id: entry.id,
      amount: fromFils(BigInt(entry.points)),
      reason: entry.reason,
      orderReference: entry.orderReference,
      settledAt: entry.settledAt,
      createdAt: entry.createdAt,
    })),
  };
}

/**
 * Ask for the whole affiliate balance as a payout. Written now so the balance
 * falls at once; paid by a person, marked off on the finance page with the
 * referral cash-outs. A suspended affiliate may still be paid what they earned
 * before — suspension closes the door, it does not keep their money.
 */
export async function requestAffiliatePayout(userId: number): Promise<{ amount: string }> {
  const db = await handle();
  const [row] = await db.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.userId, userId)).limit(1);
  if (!row) throw new AffiliateRefused("affiliate.notFound");
  const balance = await balanceFor(db, userId, "affiliate");
  if (!canPayOut(BigInt(balance)).ok) throw new AffiliateRefused("affiliate.notEnough");
  const entry = await takePoints(db, userId, balance, "cashed_out", undefined, "affiliate");
  if (entry === null) throw new AffiliateRefused("affiliate.notEnough");
  return { amount: fromFils(BigInt(balance)) };
}

/* -------------------------------------------------- earning and reversing --- */

/**
 * Credit the affiliate an order carried, once its cash is collected.
 * Only an affiliate still active is paid; one suspended between the click and
 * the collection earns nothing new.
 */
export async function creditAffiliate(db: Db, orderId: number): Promise<void> {
  const [order] = await db
    .select({ affiliateId: orders.affiliateId, rate: orders.affiliateRate, userId: affiliates.userId, status: affiliates.status })
    .from(orders)
    .innerJoin(affiliates, eq(affiliates.id, orders.affiliateId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.rate === null || order.status !== "active") return;
  const lines = await db
    .select({ lineTotal: orderItems.lineTotal, commissionAmount: orderItems.commissionAmount, fulfilment: orderItems.fulfilment })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const share = orderShareFils(lines, order.rate);
  if (share <= 0n) return;
  try {
    await db.insert(pointEntries).values({ userId: order.userId, pot: "affiliate", points: Number(share), reason: "affiliate_commission", orderId });
  } catch (error) {
    if (!violatesUnique(error, "point_entries_affiliate_order_unique")) throw error;
  }
}

/**
 * Take back one refunded line's share, worked out from the same frozen
 * figures it was paid from — so the reversal is exact, and only ever follows a
 * commission that was actually credited.
 */
export async function reverseAffiliateLine(db: Db, orderItemId: number): Promise<void> {
  const [line] = await db
    .select({ orderId: orderItems.orderId, lineTotal: orderItems.lineTotal, commissionAmount: orderItems.commissionAmount, rate: orders.affiliateRate })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, orderItemId))
    .limit(1);
  if (!line || line.rate === null) return;
  const [credited] = await db
    .select({ userId: pointEntries.userId })
    .from(pointEntries)
    .where(and(eq(pointEntries.orderId, line.orderId), eq(pointEntries.reason, "affiliate_commission")))
    .limit(1);
  if (!credited) return;
  const share = lineShareFils(line, line.rate);
  if (share <= 0n) return;
  try {
    await db.insert(pointEntries).values({ userId: credited.userId, pot: "affiliate", points: -Number(share), reason: "affiliate_reversal", orderId: line.orderId, orderItemId });
  } catch (error) {
    if (!violatesUnique(error, "point_entries_affiliate_line_unique")) throw error;
  }
}

/** Run an earning step after the act it follows has landed, logging rather than undoing it. */
export async function affiliateQuietly(work: () => Promise<void>, what: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[affiliates] could not ${what}:`, describeError(error));
  }
}

/* --------------------------------------------------------- administering --- */

export type AffiliateAdminRow = {
  id: number;
  email: string;
  name: string | null;
  code: string;
  displayName: string;
  channel: string | null;
  status: AffiliateStatus;
  ratePercent: string;
  createdAt: Date;
  paidOrders: number;
  earned: string;
};

/** Every affiliate, pending first, then newest. Admin-only. */
export async function listAffiliates(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<AffiliateAdminRow>> {
  assertCan(actor, "affiliate.manage");
  const db = await handle();
  const pageSize = clampPageSize(request.pageSize);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(affiliates);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({
      id: affiliates.id,
      userId: affiliates.userId,
      email: users.email,
      name: users.name,
      displayName: affiliates.displayName,
      channel: affiliates.channel,
      status: affiliates.status,
      ratePercent: affiliates.ratePercent,
      createdAt: affiliates.createdAt,
      paidOrders: sql<string>`(select count(*) from ${orders} where ${orders.affiliateId} = ${affiliates.id} and ${orders.status} in ('paid', 'refunded'))`,
      earned: sql<string>`(select coalesce(sum(${pointEntries.points}), 0) from ${pointEntries} where ${pointEntries.userId} = ${affiliates.userId} and ${pointEntries.pot} = 'affiliate' and ${pointEntries.reason} in ('affiliate_commission', 'affiliate_reversal'))`,
    })
    .from(affiliates)
    .innerJoin(users, eq(users.id, affiliates.userId))
    .orderBy(sql`case when ${affiliates.status} = 'pending' then 0 else 1 end`, desc(affiliates.createdAt), desc(affiliates.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return {
    rows: rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      code: affiliateCodeFor(row.userId),
      displayName: row.displayName,
      channel: row.channel,
      status: row.status as AffiliateStatus,
      ratePercent: row.ratePercent,
      createdAt: row.createdAt,
      paidOrders: Number(row.paidOrders),
      earned: fromFils(BigInt(row.earned)),
    })),
    total,
    page,
    pageSize,
  };
}

/** How many applications are waiting, for the overview. */
export async function countPendingAffiliates(actor: Actor): Promise<number> {
  if (actor.kind !== "admin") return 0;
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(affiliates).where(eq(affiliates.status, "pending"));
  return row?.n ?? 0;
}

/**
 * Approve, suspend or reinstate, and set the rate. Both are on the trail with
 * the chain, because a rate is money NetLet pays and an approval is who it
 * pays — the two questions "and who let them?" exists for.
 */
export async function updateAffiliate(actor: Actor, affiliateId: number, change: { status?: "active" | "suspended"; ratePercent?: string }): Promise<void> {
  assertCan(actor, "affiliate.manage");
  if (change.ratePercent !== undefined && !acceptableRate(change.ratePercent)) throw new AffiliateRefused("affiliate.badRate");
  const db = await handle();
  const [was] = await db
    .select({ status: affiliates.status, ratePercent: affiliates.ratePercent, displayName: affiliates.displayName })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);
  if (!was) throw new AffiliateRefused("affiliate.notFound");
  const set: Partial<typeof affiliates.$inferInsert> = {};
  if (change.status) Object.assign(set, { status: change.status, decidedBy: actor.userId, decidedAt: new Date() });
  if (change.ratePercent !== undefined) set.ratePercent = Number(change.ratePercent).toFixed(2);
  if (Object.keys(set).length === 0) return;
  await db.update(affiliates).set(set).where(eq(affiliates.id, affiliateId));
  await recordAudit(await auditActor(actor), {
    action: "affiliate.update",
    subjectType: "affiliate",
    subjectId: affiliateId,
    subjectLabel: was.displayName,
    before: { status: was.status, ratePercent: was.ratePercent },
    after: { status: set.status ?? was.status, ratePercent: set.ratePercent ?? was.ratePercent },
  });
}
