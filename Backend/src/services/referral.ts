/**
 * Referrals and the points ledger, the half that needs a database.
 *
 * `Shared/commerce/referral.ts` is the arithmetic and is pure. This is what
 * cannot be: recording who brought whom race-safely, paying both tracks
 * exactly once, and taking points off a balance that another tab may be
 * spending at the same moment.
 *
 * Outside `db.ts` for the reason `orders.ts`, `profile.ts`, `finance.ts` and
 * `offers.ts` are: functions inside it reach its module-local `getDb`, which
 * nothing outside can redirect, so anything living there cannot be tested
 * against a real database.
 *
 * **Every balance is a sum, never a column.** There is nowhere to store one,
 * on purpose — see the pure module. What that costs is a `sum()` per read;
 * what it buys is that the shop's own answer cannot drift from its evidence.
 *
 * **Spending is a conditional write, the way a stock take is.** Two tabs
 * checking out with the same 600 points would both read "600 available" and
 * both succeed against a read-then-insert. The insert carries its own balance
 * check in the `where`, so exactly one of them lands.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { affiliates, orderItems, orders, pointEntries, referrals, users } from "../../database/schema.js";
import {
  acceptableReferral,
  canCashOut,
  cashOutValue,
  COMMISSION_REASONS,
  maturesAt,
  MIN_CASH_OUT_POINTS,
  referralCodeFor,
  referralSharePoints,
  REFERRED_POINTS,
  REFERRER_POINTS,
  REVERSAL_OF,
  spendValue,
  userIdFromCode,
  type CommissionReason,
  type PointReason,
} from "../../../Shared/commerce/referral.js";
import { isKept } from "../../../Shared/commerce/collection.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { netletCommissionFils, sharerIdFromCode, vendorAffiliateFils, type Pot } from "../../../Shared/commerce/affiliate.js";
import { fromFils } from "../../../Shared/money.js";
import { featureOn } from "./features.js";
import { settingValue } from "./settings.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** One movement, as the account page renders it. */
export type LedgerRow = {
  id: number;
  points: number;
  reason: PointReason;
  note: string | null;
  orderReference: string | null;
  settledAt: Date | null;
  /** When a held commission may be spent; null is now. */
  availableAt: Date | null;
  createdAt: Date;
};

/** Everything the account page's rewards section shows. */
export type RewardsView = {
  code: string;
  balance: number;
  /** Commissions earned and still inside their line's return window (3.1.14). */
  held: number;
  /** The soonest of them to mature, or null with nothing held. */
  nextRelease: Date | null;
  /** What the balance is worth, both ways, so the choice is stated rather than implied. */
  spendValue: string;
  cashOutValue: string;
  cashOut: { ok: true } | { ok: false; shortBy: number };
  minimumCashOut: number;
  /** How many people arrived through the code, and how many of them have bought something. */
  invited: number;
  qualified: number;
  entries: LedgerRow[];
};

/* ------------------------------------------------------------ the ledger --- */

/**
 * The balance, in one query.
 *
 * `sum` over `integer` comes back as `bigint`, which postgres.js hands over as
 * a string — and `Number(null)` is 0 while `Number(undefined)` is NaN, so the
 * coalesce is doing real work rather than tidying.
 */
export async function balanceFor(db: Db, userId: number, pot: Pot = "points", now = new Date()): Promise<number> {
  /* One ledger, two pots (3.7): referral points and affiliate money never
     count towards each other, or a commission would be spendable as points
     and points cashable at an affiliate's face value. And only what has
     matured: a commission still inside its line's return window is not money
     yet (3.1.14), so it cannot be spent or cashed out on a sale that may come
     back. */
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${pointEntries.points}), 0)` })
    .from(pointEntries)
    .where(and(
      eq(pointEntries.userId, userId),
      eq(pointEntries.pot, pot),
      or(isNull(pointEntries.availableAt), lte(pointEntries.availableAt, now)),
    ));
  return Number(row?.total ?? 0);
}

/** What is earned and still held, and when the soonest of it matures. */
export async function heldFor(db: Db, userId: number, now = new Date()): Promise<{ held: number; nextRelease: Date | null }> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${pointEntries.points}), 0)`,
      next: sql<string | Date | null>`min(${pointEntries.availableAt})`,
    })
    .from(pointEntries)
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "points"), gt(pointEntries.availableAt, now)));
  const held = Number(row?.total ?? 0);
  return { held, nextRelease: held > 0 && row?.next ? new Date(row.next) : null };
}

/** A signed-in shopper's balance, for the pages that only want the number. */
export async function pointsBalance(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return balanceFor(db, userId);
}

/**
 * Take points off a balance, refusing rather than overdrawing.
 *
 * A `select` then an `insert` is two statements with a gap between them, and
 * the gap is exactly wide enough for a second tab: both read "600 available"
 * and both spend it. A stock take closes that gap with a predicate inside the
 * write, which a ledger cannot do — there is no single row holding the total.
 * So the account row is locked instead, and spends against one account queue
 * up behind each other.
 *
 * `for update` on `users` rather than raw SQL carrying its own subquery,
 * because `db.execute` hands back a bare array on postgres.js and `{ rows }`
 * on PGlite — a difference that passes every test and fails every real spend.
 *
 * Returns the new entry's id, or null when the balance could not cover it.
 */
export async function takePoints(
  db: Db,
  userId: number,
  points: number,
  reason: Extract<PointReason, "spent_on_order" | "cashed_out">,
  orderId?: number,
  pot: Pot = "points",
): Promise<number | null> {
  const wanted = Math.trunc(points);
  if (wanted <= 0) return null;

  return db.transaction(async tx => {
    const [locked] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!locked) return null;

    if (await balanceFor(tx as unknown as Db, userId, pot) < wanted) return null;

    const [entry] = await tx
      .insert(pointEntries)
      .values({ userId, points: -wanted, reason, orderId: orderId ?? null, pot })
      .returning({ id: pointEntries.id });
    return entry?.id ?? null;
  });
}

/**
 * Undo a spend for an order that never happened.
 *
 * Deleted rather than reversed with a second entry, which is the one place
 * this ledger is not append-only and is deliberate: a compensating pair would
 * have the shopper's own history read "spent 500 / refunded 500" against an
 * order that does not exist and never did. There is nothing there to audit.
 */
export async function returnPoints(db: Db, entryId: number): Promise<void> {
  await db.delete(pointEntries).where(eq(pointEntries.id, entryId));
}

/* -------------------------------------------------------------- referrals --- */

/**
 * Record that somebody arrived through a code (3.1.14).
 *
 * Nothing is paid here. The row is the *claim*; the points land when the new
 * shopper's first order is paid for, because a scheme that pays at
 * registration pays for registrations.
 *
 * Returns whether a referral was recorded. A code naming nobody, a shopper
 * referring themselves and a second claim on one account are all the same
 * quiet no: none of them is worth interrupting a registration over, and the
 * unique index is what actually enforces the last one.
 */
export async function recordReferral(referredId: number, code: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const referrerId = userIdFromCode(code);
  if (referrerId === null || !acceptableReferral(referrerId, referredId)) return false;

  const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.id, referrerId)).limit(1);
  if (!referrer) return false;

  const inserted = await db
    .insert(referrals)
    .values({ referrerId, referredId })
    .onConflictDoNothing({ target: referrals.referredId })
    .returning({ id: referrals.id });
  return inserted.length > 0;
}

/**
 * Pay both tracks, once, when a referred shopper's order is paid for (3.1.14).
 *
 * Called from the moment an order actually becomes paid rather than from
 * placement — a cash order that nobody collects has earned nobody anything.
 *
 * Exactly-once is the database's job twice over: `qualified_at is null` in the
 * `where` stops a second caller claiming the same referral, and the partial
 * unique index on (referral, reason) stops two entries of one kind existing
 * even if that predicate somehow raced.
 */
export async function qualifyReferral(db: Db, userId: number, orderId: number): Promise<boolean> {
  const claimed = await db
    .update(referrals)
    .set({ qualifiedOrderId: orderId, qualifiedAt: new Date() })
    .where(and(eq(referrals.referredId, userId), isNull(referrals.qualifiedAt)))
    .returning({ id: referrals.id, referrerId: referrals.referrerId });

  const [referral] = claimed;
  if (!referral) return false;

  await db
    .insert(pointEntries)
    .values([
      {
        userId: referral.referrerId,
        points: REFERRER_POINTS,
        reason: "referrer_bonus",
        referralId: referral.id,
        orderId,
      },
      {
        userId,
        points: REFERRED_POINTS,
        reason: "referred_welcome",
        referralId: referral.id,
        orderId,
      },
    ])
    .onConflictDoNothing();
  return true;
}

/* ----------------------------------------------------------- commissions --- */

/**
 * Credit both commissions on an order whose cash has just been collected
 * (3.1.14, 3.1.15): the product link's share of each line bought through one,
 * and the inviter's share of every line their invitee bought. Each is a
 * percentage of NetLet's own commission on the line, held until the line's
 * return window has passed.
 *
 * Exactly once per line and kind, by the ledger's partial unique indexes, so
 * collecting the cash twice — or a retry after a failure — cannot pay twice.
 * The product link's rate was frozen on the line at the sale; the invite's is
 * the programme's at collection, since nothing about the order chose it.
 */
export async function creditReferralCommissions(db: Db, orderId: number, now = new Date()): Promise<void> {
  const [order] = await db.select({ userId: orders.userId, affiliateId: orders.affiliateId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;
  const lines = await db
    .select({
      id: orderItems.id,
      lineTotal: orderItems.lineTotal,
      commissionAmount: orderItems.commissionAmount,
      affiliateVendorPercent: orderItems.affiliateVendorPercent,
      fulfilment: orderItems.fulfilment,
      deliveredAt: orderItems.deliveredAt,
      referrerId: orderItems.referrerId,
      referralRate: orderItems.referralRate,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const kept = lines.filter(line => isKept(line.fulfilment));
  const rows: (typeof pointEntries.$inferInsert)[] = [];

  for (const line of kept) {
    if (line.referrerId === null || line.referralRate === null || line.referrerId === order.userId) continue;
    /* NetLet's own share, and the store's on a product it offered to
       affiliates (3.7.1) — the store's goes to the link's sharer, except on
       an order the old programme attributed, whose affiliate is paid it in
       money (`creditAffiliate`) and must not be paid it twice. */
    const storeShare = order.affiliateId === null ? Number(vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent)) : 0;
    const points = referralSharePoints(fromFils(netletCommissionFils(line)), line.referralRate) + storeShare;
    if (points <= 0) continue;
    rows.push({ userId: line.referrerId, points, reason: "product_referral", orderId, orderItemId: line.id, availableAt: maturesAt(line.deliveredAt, now) });
  }

  /* The invite pays from the first paid order on, so only a referral that has
     qualified — `qualifyReferral` runs just before this, on the same press. */
  if (order.userId !== null) {
    const [referral] = await db
      .select({ referrerId: referrals.referrerId })
      .from(referrals)
      .where(and(eq(referrals.referredId, order.userId), isNotNull(referrals.qualifiedAt)))
      .limit(1);
    if (referral && referral.referrerId !== order.userId) {
      const rate = await settingValue("referral.invitePercent", db);
      for (const line of kept) {
        const points = referralSharePoints(fromFils(netletCommissionFils(line)), rate);
        if (points <= 0) continue;
        /* No `referral_id`: that column's index allows one entry of a kind per
           referral, which is the welcome's rule. The line names the sale. */
        rows.push({ userId: referral.referrerId, points, reason: "invite_commission", orderId, orderItemId: line.id, availableAt: maturesAt(line.deliveredAt, now) });
      }
    }
  }
  if (rows.length) await db.insert(pointEntries).values(rows).onConflictDoNothing();
}

/**
 * Take back a refunded line's commissions, each from the same frozen entry it
 * was paid as, maturing at the same moment — so a commission still held and
 * its reversal cancel out before anybody could spend either.
 */
export async function reverseReferralLine(db: Db, orderItemId: number): Promise<void> {
  const credited = await db
    .select({ userId: pointEntries.userId, points: pointEntries.points, reason: pointEntries.reason, orderId: pointEntries.orderId, availableAt: pointEntries.availableAt })
    .from(pointEntries)
    .where(and(eq(pointEntries.orderItemId, orderItemId), inArray(pointEntries.reason, [...COMMISSION_REASONS])));
  const rows = credited
    .filter(entry => entry.points > 0)
    .map(entry => ({
      userId: entry.userId,
      points: -entry.points,
      reason: REVERSAL_OF[entry.reason as CommissionReason],
      orderId: entry.orderId,
      orderItemId,
      availableAt: entry.availableAt,
    }));
  if (rows.length) await db.insert(pointEntries).values(rows).onConflictDoNothing();
}

/**
 * A line delivered after its cash was collected moves its held commissions on
 * to the end of the window that now runs from the arrival — never earlier,
 * and its reversals with them, so the pair still matures together.
 */
export async function extendReferralHold(db: Db, orderItemIds: number[], deliveredAt: Date): Promise<void> {
  if (!orderItemIds.length) return;
  const until = maturesAt(deliveredAt, deliveredAt);
  const reasons: PointReason[] = [...COMMISSION_REASONS, ...COMMISSION_REASONS.map(reason => REVERSAL_OF[reason])];
  await db
    .update(pointEntries)
    .set({ availableAt: until })
    .where(and(inArray(pointEntries.orderItemId, orderItemIds), inArray(pointEntries.reason, reasons), lt(pointEntries.availableAt, until)));
}

/**
 * Which of these accounts may earn on a link now: members of the affiliate
 * programme (3.7), not suspended, while the programme is on. The rule that
 * makes joining mean something — on the owner's word, a product link earns its
 * sharer points once they have joined, and one from somebody who never did is
 * just a link.
 */
export async function activeSharers(db: Db, userIds: readonly number[]): Promise<Set<number>> {
  const wanted = [...new Set(userIds)].filter(id => id > 0);
  if (!wanted.length || !(await featureOn("affiliates"))) return new Set();
  const rows = await db
    .select({ userId: affiliates.userId })
    .from(affiliates)
    .where(and(inArray(affiliates.userId, wanted), eq(affiliates.status, "active")));
  return new Set(rows.map(row => row.userId));
}

/**
 * The product link a line is bought through, if it may earn (3.1.14, 3.7): a
 * member of the affiliate programme who is not the buyer. A product link's
 * `NL` code, or an old affiliate link's `AF` one, which names the same
 * account. The rate is the programme's at the sale, frozen on the line beside
 * who shared it.
 */
export async function productReferrers(
  db: Db,
  links: readonly { productId: string; code: string }[],
  buyerId: number | null | undefined,
): Promise<{ byProduct: Map<string, number>; rate: string }> {
  const wanted = new Map<string, number>();
  for (const link of links.slice(0, 50)) {
    const referrerId = sharerIdFromCode(link.code);
    if (referrerId === null || referrerId === buyerId || wanted.has(link.productId)) continue;
    wanted.set(link.productId, referrerId);
  }
  if (!wanted.size) return { byProduct: new Map(), rate: "0.00" };
  const members = await activeSharers(db, [...wanted.values()]);
  const byProduct = new Map([...wanted].filter(([, id]) => members.has(id)));
  return { byProduct, rate: byProduct.size ? await settingValue("referral.productPercent", db) : "0.00" };
}

/* ---------------------------------------------------------------- reading --- */

/**
 * The account page's rewards section.
 *
 * **It says how many people arrived, never who.** A code is meant to be pasted
 * into a group chat, so anybody may hold somebody else's — and a list of names
 * would turn that into a way of asking which strangers have registered. The
 * count is the part the person who invited them actually wanted.
 */
export async function rewardsFor(userId: number, limit = 50): Promise<RewardsView> {
  const db = await getDb();
  const empty: RewardsView = {
    code: referralCodeFor(userId),
    balance: 0,
    held: 0,
    nextRelease: null,
    spendValue: spendValue(0),
    cashOutValue: cashOutValue(0),
    cashOut: canCashOut(0),
    minimumCashOut: MIN_CASH_OUT_POINTS,
    invited: 0,
    qualified: 0,
    entries: [],
  };
  if (!db) return empty;

  const rows = await db
    .select({
      id: pointEntries.id,
      points: pointEntries.points,
      reason: pointEntries.reason,
      note: pointEntries.note,
      settledAt: pointEntries.settledAt,
      availableAt: pointEntries.availableAt,
      createdAt: pointEntries.createdAt,
      orderReference: orders.reference,
    })
    .from(pointEntries)
    .leftJoin(orders, eq(orders.id, pointEntries.orderId))
    .where(and(eq(pointEntries.userId, userId), eq(pointEntries.pot, "points")))
    /* Ties on `created_at` are ordinary here — both tracks of one referral are
       written in the same statement — so the id breaks them, the way every
       other paged query in this codebase ends on something unique. */
    .orderBy(desc(pointEntries.createdAt), desc(pointEntries.id))
    .limit(limit);

  const [counts] = await db
    .select({
      invited: sql<string>`count(*)`,
      qualified: sql<string>`count(${referrals.qualifiedAt})`,
    })
    .from(referrals)
    .where(eq(referrals.referrerId, userId));

  const now = new Date();
  const balance = await balanceFor(db, userId, "points", now);
  const { held, nextRelease } = await heldFor(db, userId, now);
  return {
    ...empty,
    balance,
    held,
    nextRelease,
    spendValue: spendValue(balance),
    cashOutValue: cashOutValue(balance),
    cashOut: canCashOut(balance),
    invited: Number(counts?.invited ?? 0),
    qualified: Number(counts?.qualified ?? 0),
    entries: rows.map(row => ({
      id: row.id,
      points: row.points,
      reason: row.reason as PointReason,
      note: row.note,
      orderReference: row.orderReference,
      settledAt: row.settledAt,
      availableAt: row.availableAt && row.availableAt > now ? row.availableAt : null,
      createdAt: row.createdAt,
    })),
  };
}

/* ------------------------------------------------------------- cashing out --- */

/**
 * Ask for the balance in cash (3.1.15).
 *
 * The whole balance, not a part of it: a partial payout is a second number to
 * type and a second thing to get wrong, and nobody asked for it.
 *
 * The entry is written now, because the balance has to fall the moment the
 * request exists or the same points get spent in another tab. When the money
 * leaves is `settled_at`, which a human sets — the same arrangement the seller
 * payout report already describes, and honest about the fact that NetLet has
 * no rail that pays anybody automatically.
 */
export async function requestCashOut(userId: number): Promise<{ points: number; value: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const balance = await balanceFor(db, userId);
  if (!canCashOut(balance).ok) return null;

  const entryId = await takePoints(db, userId, balance, "cashed_out");
  if (entryId === null) return null;
  return { points: balance, value: cashOutValue(balance) };
}

export type CashOutRow = {
  id: number;
  userId: number;
  name: string | null;
  email: string;
  /** Referral points, or an affiliate's commission (3.7) — paid at different rates. */
  pot: Pot;
  points: number;
  value: string;
  requestedAt: Date;
};

/**
 * Cash-outs waiting to be paid. Admin-only, beside the seller payouts.
 *
 * Guarded here rather than in the router alone: it names shoppers and what
 * they are owed, and a second caller added later would skip a router check
 * silently — the rule every other guard in this codebase follows.
 */
export async function pendingCashOuts(actor: Actor, limit = 200): Promise<CashOutRow[]> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: pointEntries.id,
      userId: pointEntries.userId,
      name: users.name,
      email: users.email,
      points: pointEntries.points,
      pot: pointEntries.pot,
      createdAt: pointEntries.createdAt,
    })
    .from(pointEntries)
    .innerJoin(users, eq(users.id, pointEntries.userId))
    .where(and(eq(pointEntries.reason, "cashed_out"), isNull(pointEntries.settledAt)))
    .orderBy(desc(pointEntries.createdAt), desc(pointEntries.id))
    .limit(limit);

  return rows.map(row => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    pot: row.pot as Pot,
    points: -row.points,
    /* An affiliate's pot is fils at face value; points pay face value less the 10% fee. */
    value: row.pot === "affiliate" ? fromFils(BigInt(-row.points)) : cashOutValue(-row.points),
    requestedAt: row.createdAt,
  }));
}

/**
 * Record that a cash-out was actually paid.
 *
 * The predicate is inside the `UPDATE`, so two administrators pressing it
 * cannot both be told they were the one who paid it.
 */
export async function settleCashOut(actor: Actor, entryId: number): Promise<boolean> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return false;

  const updated = await db
    .update(pointEntries)
    .set({ settledAt: new Date() })
    .where(and(
      eq(pointEntries.id, entryId),
      eq(pointEntries.reason, "cashed_out"),
      isNull(pointEntries.settledAt),
    ))
    .returning({ id: pointEntries.id });
  return updated.length > 0;
}
