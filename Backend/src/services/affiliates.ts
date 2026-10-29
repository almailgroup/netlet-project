/**
 * Affiliate marketing (3.7), the database half. The rules are in
 * `Shared/commerce/affiliate.ts`.
 *
 * **Joining is one press and a member's product links earn NetLet points**,
 * on the owner's word. What a sale earns is credited by the referral ledger's
 * own `creditReferralCommissions` as a `product_referral` entry — the
 * programme's share of NetLet's commission on the line and, on a product its
 * store offered to affiliates, the store's rate — held until the line's return
 * window passes, in the points pot: one balance with a coin on it, spent at
 * face value or converted to money. This file is who may earn (`activeSharers`),
 * joining, the member's page and the administrator's desk.
 *
 * **The old programme's money stays money.** An order placed under it carries
 * the affiliate on the order and pays into the `affiliate` pot when its cash is
 * collected (`creditAffiliate`), reversed on a refund, each exactly once by a
 * partial unique index; a balance there is paid out whole. Nothing new is
 * attributed that way.
 */
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { outer } from "./sqlRefs.js";
import { affiliates, orderItems, orders, pointEntries, productImages, products, productVariants, users, vendors } from "../../database/schema.js";
import {
  canPayOut,
  DEFAULT_AFFILIATE_PERCENT,
  lineShareFils,
  orderShareFils,
  sharerIdFromCode,
  storeAffiliateRate,
  suggestedDisplayName,
  vendorAffiliateFils,
  vendorShareFils,
  type AffiliateStatus,
} from "../../../Shared/commerce/affiliate.js";
import { referralCodeFor } from "../../../Shared/commerce/referral.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { fromFils } from "../../../Shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { describeError, violatesUnique } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { activeSharers, balanceFor, takePoints } from "./referral.js";
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

/* ------------------------------------------------------------- joining --- */

/**
 * Join the programme: a member at once, on the owner's word ("enroll …
 * easily") — there is no review to wait on. Agreeing to say the links are
 * paid is the one condition: promotion that hides that it is paid is what
 * advertising rules exist to stop, and a shop paying for it is a party to it.
 *
 * The name shoppers see is the one given, else the first word of the
 * account's name. Joining again returns the membership as it stands, so a
 * suspended member cannot join their way back; an application left waiting
 * under the old review becomes a membership.
 */
export async function applyAsAffiliate(userId: number, input: { displayName?: string | null; channel?: string | null; acceptDisclosure: boolean }) {
  if (!input.acceptDisclosure) throw new AffiliateRefused("affiliate.disclosureRequired");
  const db = await handle();
  let displayName = input.displayName?.trim() ?? "";
  if (!displayName) {
    const [account] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    displayName = suggestedDisplayName(account?.name) ?? "";
  }
  if (!displayName) throw new AffiliateRefused("affiliate.badName");
  const now = new Date();
  try {
    await db.insert(affiliates).values({
      userId,
      displayName: displayName.slice(0, 80),
      channel: input.channel?.trim() || null,
      ratePercent: DEFAULT_AFFILIATE_PERCENT,
      status: "active",
      decidedAt: now,
      disclosureAcceptedAt: now,
    });
  } catch (error) {
    if (!violatesUnique(error, "affiliates_user_unique")) throw error;
    await db
      .update(affiliates)
      .set({ status: "active", displayName: displayName.slice(0, 80), decidedAt: now, disclosureAcceptedAt: now })
      .where(and(eq(affiliates.userId, userId), eq(affiliates.status, "pending")));
  }
  return affiliateDashboard(userId);
}

/* ------------------------------------------------------------- reading --- */

/**
 * The names shoppers are shown for the links they arrived through, or none.
 * Only what each member chose to be known by — never their account — and only
 * for a member who may earn on it, so the line never names somebody whose
 * link is earning nothing.
 */
export async function publicSharers(codes: readonly string[]): Promise<{ code: string; displayName: string }[]> {
  const db = await getDb();
  if (!db) return [];
  const byId = new Map<number, string>();
  for (const code of codes.slice(0, 20)) {
    const id = sharerIdFromCode(code);
    if (id !== null && !byId.has(id)) byId.set(id, code.trim().toUpperCase());
  }
  const active = await activeSharers(db, [...byId.keys()]);
  if (!active.size) return [];
  const rows = await db
    .select({ userId: affiliates.userId, displayName: affiliates.displayName })
    .from(affiliates)
    .where(inArray(affiliates.userId, [...active]));
  return rows.map(row => ({ code: byId.get(row.userId) ?? "", displayName: row.displayName }));
}

/**
 * The code a member's links carry, or null for somebody whose links earn
 * nothing (not joined, suspended, or the programme off), and whether the
 * account has joined at all — what the account home asks before offering to
 * join, since a suspended member's code is null too and "Join" would be the
 * wrong thing to offer them. What the product page's Share asks before
 * putting a code on the address — a light read, because it is asked on every
 * product page a signed-in shopper opens.
 */
export async function memberCode(userId: number): Promise<{ code: string | null; joined: boolean }> {
  const db = await getDb();
  if (!db) return { code: null, joined: false };
  const [row] = await db
    .select({ status: affiliates.status })
    .from(affiliates)
    .where(eq(affiliates.userId, userId))
    .limit(1);
  /* A row the old review left waiting is not a membership; joining makes it one. */
  const joined = row !== undefined && row.status !== "pending";
  const members = joined ? await activeSharers(db, [userId]) : new Set<number>();
  return { code: members.has(userId) ? referralCodeFor(userId) : null, joined };
}

export type AffiliateSale = {
  id: number;
  points: number;
  /** A product bought through a link, or one of them taken back. */
  reversed: boolean;
  productTitle: string | null;
  orderReference: string | null;
  /** When a held share becomes spendable; null once it is. */
  availableAt: Date | null;
  createdAt: Date;
};

export type AffiliateDashboard = {
  status: "active" | "suspended";
  /** The code a member's links carry — the account's referral code. */
  code: string;
  displayName: string;
  joinedAt: Date;
  /** Orders a member's links brought that have been paid for, and those waiting on payment. */
  paidOrders: number;
  waitingOrders: number;
  /** Points earned through links, held until their return windows pass, and taken back by returns. */
  earnedPoints: number;
  heldPoints: number;
  reversedPoints: number;
  sales: AffiliateSale[];
  /**
   * Money from the programme before it paid in points, while any is recorded:
   * what is left, whether it can be paid, and its entries. Null for everybody
   * who joined since.
   */
  earlier: null | {
    balance: string;
    payout: ReturnType<typeof canPayOut>;
    entries: { id: number; amount: string; reason: string; orderReference: string | null; settledAt: Date | null; createdAt: Date }[];
  };
};

const LINK_REASONS = ["product_referral", "product_referral_reversal"] as const;

/**
 * A member's own page, or null for somebody who has not joined (an
 * application still waiting under the old review counts as not joined, and
 * joining makes it a membership).
 */
export async function affiliateDashboard(userId: number, now = new Date()): Promise<AffiliateDashboard | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(affiliates).where(eq(affiliates.userId, userId)).limit(1);
  if (!row || row.status === "pending") return null;

  const [counts] = await db
    .select({
      paid: sql<string>`count(distinct ${orders.id}) filter (where ${orders.status} in ('paid', 'refunded'))`,
      waiting: sql<string>`count(distinct ${orders.id}) filter (where ${orders.status} = 'pending_payment')`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.referrerId, userId));
  const [sums] = await db
    .select({
      earned: sql<string>`coalesce(sum(${pointEntries.points}) filter (where ${pointEntries.reason} = 'product_referral'), 0)`,
      reversed: sql<string>`coalesce(-sum(${pointEntries.points}) filter (where ${pointEntries.reason} = 'product_referral_reversal'), 0)`,
      /* `gt` rather than the date in the fragment: a bare JS Date skips the
         column's mapper, which PGlite forgives and postgres.js refuses. */
      held: sql<string>`coalesce(sum(${pointEntries.points}) filter (where ${gt(pointEntries.availableAt, now)}), 0)`,
    })
    .from(pointEntries)
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "points"), inArray(pointEntries.reason, [...LINK_REASONS])));
  const sales = await db
    .select({
      id: pointEntries.id,
      points: pointEntries.points,
      reason: pointEntries.reason,
      availableAt: pointEntries.availableAt,
      createdAt: pointEntries.createdAt,
      orderReference: orders.reference,
      productTitle: orderItems.productTitle,
    })
    .from(pointEntries)
    .leftJoin(orders, eq(orders.id, pointEntries.orderId))
    .leftJoin(orderItems, eq(orderItems.id, pointEntries.orderItemId))
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "points"), inArray(pointEntries.reason, [...LINK_REASONS])))
    .orderBy(desc(pointEntries.createdAt), desc(pointEntries.id))
    .limit(30);

  /* The old programme's money, only for somebody who has some on record. */
  const legacy = await db
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
  const legacyBalance = legacy.length ? BigInt(await balanceFor(db, userId, "affiliate")) : 0n;

  return {
    status: row.status === "suspended" ? "suspended" : "active",
    code: referralCodeFor(userId),
    displayName: row.displayName,
    joinedAt: row.decidedAt ?? row.createdAt,
    paidOrders: Number(counts?.paid ?? 0),
    waitingOrders: Number(counts?.waiting ?? 0),
    earnedPoints: Number(sums?.earned ?? 0),
    heldPoints: Math.max(0, Number(sums?.held ?? 0)),
    reversedPoints: Number(sums?.reversed ?? 0),
    sales: sales.map(sale => ({
      id: sale.id,
      points: sale.points,
      reversed: sale.reason === "product_referral_reversal",
      productTitle: sale.productTitle,
      orderReference: sale.orderReference,
      availableAt: sale.availableAt && sale.availableAt > now ? sale.availableAt : null,
      createdAt: sale.createdAt,
    })),
    earlier: legacy.length
      ? {
          balance: fromFils(legacyBalance),
          payout: canPayOut(legacyBalance),
          entries: legacy.map(entry => ({
            id: entry.id,
            amount: fromFils(BigInt(entry.points)),
            reason: entry.reason,
            orderReference: entry.orderReference,
            settledAt: entry.settledAt,
            createdAt: entry.createdAt,
          })),
        }
      : null,
  };
}

/**
 * Ask for the old programme's money as a payout. Written now so the balance
 * falls at once; paid by a person, marked off on the finance page with the
 * points cash-outs. A suspended member may still be paid what they earned
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

/* ---------------------------------------------------- the stores' offers --- */

export type AffiliateProduct = {
  productId: number;
  handle: string;
  title: string;
  titleAr: string | null;
  vendorName: string;
  image: string | null;
  price: string;
  percent: string;
};

/**
 * The products stores have offered to affiliates, with each one's rate (3.7.1),
 * for an approved affiliate to choose what to promote. Only what the shop would
 * show — published, from an approved store — highest rate first, then newest.
 */
export async function listAffiliateProducts(userId: number, request: { page?: number } = {}): Promise<Page<AffiliateProduct> | null> {
  const db = await handle();
  const [mine] = await db.select({ status: affiliates.status }).from(affiliates).where(eq(affiliates.userId, userId)).limit(1);
  if (mine?.status !== "active") return null;
  const where = and(isNotNull(products.affiliatePercent), eq(products.status, "published"), eq(vendors.status, "approved"));
  const pageSize = 24;
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(products).innerJoin(vendors, eq(vendors.id, products.vendorId)).where(where);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({
      productId: products.id,
      handle: products.handle,
      title: products.title,
      titleAr: products.titleAr,
      vendorName: vendors.name,
      percent: products.affiliatePercent,
      image: sql<string | null>`(select ${productImages.url} from ${productImages} where ${productImages.productId} = ${outer(products.id)} and ${productImages.kind} = 'image' order by ${productImages.position}, ${productImages.id} limit 1)`,
      price: sql<string | null>`(select min(${productVariants.price}) from ${productVariants} where ${productVariants.productId} = ${outer(products.id)})`,
    })
    .from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(where)
    .orderBy(desc(products.affiliatePercent), desc(products.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return {
    rows: rows.map(row => ({ ...row, percent: row.percent ?? "0.00", price: row.price ?? "0.000" })),
    total,
    page,
    pageSize,
  };
}

/**
 * Offer one of a store's products to affiliates at a rate it funds, or
 * withdraw it (`percent: null`). A manager's decision, like a price: the rate
 * comes off the store's own net on every sale an affiliate brings. Orders
 * already placed keep the rate frozen on their lines.
 */
export async function setProductAffiliate(actor: Actor, productId: number, percent: string | null): Promise<{ percent: string | null }> {
  const db = await handle();
  const [row] = await db.select({ vendorId: products.vendorId, title: products.title, percent: products.affiliatePercent }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new AffiliateRefused("affiliate.notFound");
  assertCan(actor, "product.edit", row.vendorId);
  const next = percent === null ? null : storeAffiliateRate(percent);
  if (percent !== null && next === null) throw new AffiliateRefused("affiliate.badRate");
  if (next === row.percent) return { percent: next };
  await db.update(products).set({ affiliatePercent: next }).where(eq(products.id, productId));
  await recordAudit(await auditActor(actor), {
    action: "product.setAffiliate",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: row.title,
    vendorId: row.vendorId,
    before: { affiliatePercent: row.percent },
    after: { affiliatePercent: next },
  });
  return { percent: next };
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
  if (!order || order.status !== "active") return;
  const lines = await db
    .select({ lineTotal: orderItems.lineTotal, commissionAmount: orderItems.commissionAmount, fulfilment: orderItems.fulfilment, affiliateVendorPercent: orderItems.affiliateVendorPercent })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  /* What each store funded on the products it opted in (3.7.1), and — only on
     an order placed before that — NetLet's own share out of its cut. */
  const share = vendorShareFils(lines) + (order.rate === null ? 0n : orderShareFils(lines, order.rate));
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
    .select({ orderId: orderItems.orderId, lineTotal: orderItems.lineTotal, commissionAmount: orderItems.commissionAmount, affiliateVendorPercent: orderItems.affiliateVendorPercent, rate: orders.affiliateRate })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, orderItemId))
    .limit(1);
  if (!line || (line.rate === null && line.affiliateVendorPercent === null)) return;
  const [credited] = await db
    .select({ userId: pointEntries.userId })
    .from(pointEntries)
    .where(and(eq(pointEntries.orderId, line.orderId), eq(pointEntries.reason, "affiliate_commission")))
    .limit(1);
  if (!credited) return;
  const share = vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent) + (line.rate === null ? 0n : lineShareFils(line, line.rate));
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
  createdAt: Date;
  /** Orders a member's links brought that were paid for. */
  paidOrders: number;
  /** Points earned through links, net of what returns took back. */
  points: number;
  /** Money from the old programme, net of refunds; "0.000" for everybody who joined since. */
  earned: string;
};

/** Every member, newest first (an application still waiting under the old review first of all). Admin-only. */
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
      createdAt: affiliates.createdAt,
      paidOrders: sql<string>`(select count(distinct ${orders.id}) from ${orderItems} join ${orders} on ${orders.id} = ${orderItems.orderId} where ${orderItems.referrerId} = ${outer(affiliates.userId)} and ${orders.status} in ('paid', 'refunded'))`,
      points: sql<string>`(select coalesce(sum(${pointEntries.points}), 0) from ${pointEntries} where ${pointEntries.userId} = ${outer(affiliates.userId)} and ${pointEntries.pot} = 'points' and ${pointEntries.reason} in ('product_referral', 'product_referral_reversal'))`,
      earned: sql<string>`(select coalesce(sum(${pointEntries.points}), 0) from ${pointEntries} where ${pointEntries.userId} = ${outer(affiliates.userId)} and ${pointEntries.pot} = 'affiliate' and ${pointEntries.reason} in ('affiliate_commission', 'affiliate_reversal'))`,
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
      code: referralCodeFor(row.userId),
      displayName: row.displayName,
      channel: row.channel,
      status: row.status as AffiliateStatus,
      createdAt: row.createdAt,
      paidOrders: Number(row.paidOrders),
      points: Number(row.points),
      earned: fromFils(BigInt(row.earned)),
    })),
    total,
    page,
    pageSize,
  };
}

/** How many applications are still waiting under the old review, for the overview. */
export async function countPendingAffiliates(actor: Actor): Promise<number> {
  if (actor.kind !== "admin") return 0;
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(affiliates).where(eq(affiliates.status, "pending"));
  return row?.n ?? 0;
}

/**
 * Suspend a member, reinstate one, or let in an application still waiting
 * under the old review. On the trail with the chain, because who NetLet pays
 * is the question "and who let them?" exists for. There is no per-member rate
 * any more: what a link earns is the programme's rate, set on
 * `/admin/features`, and each store's own offer.
 */
export async function updateAffiliate(actor: Actor, affiliateId: number, change: { status?: "active" | "suspended" }): Promise<void> {
  assertCan(actor, "affiliate.manage");
  const db = await handle();
  const [was] = await db
    .select({ status: affiliates.status, displayName: affiliates.displayName })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);
  if (!was) throw new AffiliateRefused("affiliate.notFound");
  if (!change.status || change.status === was.status) return;
  await db.update(affiliates).set({ status: change.status, decidedBy: actor.userId, decidedAt: new Date() }).where(eq(affiliates.id, affiliateId));
  await recordAudit(await auditActor(actor), {
    action: "affiliate.update",
    subjectType: "affiliate",
    subjectId: affiliateId,
    subjectLabel: was.displayName,
    before: { status: was.status },
    after: { status: change.status },
  });
}
