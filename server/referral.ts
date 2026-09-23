/**
 * Referrals and the points ledger, the half that needs a database.
 *
 * `shared/commerce/referral.ts` is the arithmetic and is pure. This is what
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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { orders, pointEntries, referrals, users } from "../drizzle/schema.js";
import {
  acceptableReferral,
  balanceOf,
  canCashOut,
  cashOutValue,
  MIN_CASH_OUT_POINTS,
  referralCodeFor,
  REFERRED_POINTS,
  REFERRER_POINTS,
  spendValue,
  userIdFromCode,
  type PointReason,
} from "../shared/commerce/referral.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
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
  createdAt: Date;
};

/** Everything the account page's rewards section shows. */
export type RewardsView = {
  code: string;
  balance: number;
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
export async function balanceFor(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${pointEntries.points}), 0)` })
    .from(pointEntries)
    .where(eq(pointEntries.userId, userId));
  return Number(row?.total ?? 0);
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

    if (await balanceFor(tx as unknown as Db, userId) < wanted) return null;

    const [entry] = await tx
      .insert(pointEntries)
      .values({ userId, points: -wanted, reason, orderId: orderId ?? null })
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
      createdAt: pointEntries.createdAt,
      orderReference: orders.reference,
    })
    .from(pointEntries)
    .leftJoin(orders, eq(orders.id, pointEntries.orderId))
    .where(eq(pointEntries.userId, userId))
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

  const balance = await balanceFor(db, userId);
  return {
    ...empty,
    balance,
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
    points: -row.points,
    value: cashOutValue(-row.points),
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
