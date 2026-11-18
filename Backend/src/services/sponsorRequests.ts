/**
 * Sponsored products, the database half (migration 0089). The rules are
 * `Shared/commerce/sponsorRequests.ts`; the placement a paid request becomes
 * is an ordinary `ad_bookings` row, which the home shelf draws and the payout
 * run charges (`adBookings.ts`, `payoutRuns.ts`).
 *
 * Outside `db.ts` for the reason `adBookings.ts` is: a function inside it
 * calls that file's module-local `getDb`, which nothing outside can redirect.
 *
 * **Every move is written with the state it was read in, in the predicate**,
 * so a store paying while NetLet declines, two administrators confirming at
 * once, or a store withdrawing while NetLet approves cannot both land — the
 * second is told the request has moved (`sponsor.moved`).
 *
 * **Money moves under the placements' locks.** Paying from earnings and
 * confirming a transfer both write a placement, so both take the advisory
 * lock every booking takes (`BOOKING_LOCK`) and paying from earnings takes
 * the store's row `for update` too — the payout run's lock — so two payments
 * cannot spend the same earnings and a run recorded between them is counted.
 *
 * **Scoped in the query.** A store reads and moves its own requests; another
 * store's is "not found", never "forbidden". NetLet's people read every one.
 *
 * **Closed, not broken, until 0089 is pasted**: every read answers
 * `ready: false` and every write `sponsor.unavailable`.
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { adBookings, orderItems, orders, productImages, productViews, products, sponsorRequests, vendors } from "../../database/schema.js";
import {
  AD_CAPACITY,
  AD_RATES,
  addDays,
  bookingProblem,
  bookingState,
  daysInclusive,
  effectiveEnd,
  feeAccrued,
  fullDays,
  kuwaitToday,
  quoteFor,
  type BookingProblem,
  type BookingState,
} from "../../../Shared/commerce/adBookings.js";
import {
  SPONSOR_NOTE_MAX,
  approvedRun,
  confirmedRun,
  defaultPayBy,
  liftPercent,
  payByProblem,
  rateProblem,
  referenceProblem,
  refundFor,
  sponsorActions,
  sponsorState,
  sponsorStep,
  transferReference,
  type PayByProblem,
  type RateProblem,
  type ReferenceProblem,
  type SponsorActions,
  type SponsorPaidWith,
  type SponsorState,
  type SponsorStatus,
  type SponsorStep,
} from "../../../Shared/commerce/sponsorRequests.js";
import { isValidIban } from "../../../Shared/inventory/storeProfile.js";
import { assertCan, can, type Actor } from "../../../Shared/inventory/permissions.js";
import { endOfKuwaitDay } from "../../../Shared/kuwaitDay.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { ENV as env } from "../core/env.js";
import { isMissingTable } from "../core/describeError.js";
import { BOOKING_LOCK, overlapping } from "./adBookings.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { notifyStaff, notifyStore } from "./notifications.js";
import { placementRoom } from "./payoutRuns.js";
import { sponsorReady } from "./sponsorHolds.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type SponsorRefusal =
  | BookingProblem
  | PayByProblem
  | RateProblem
  | ReferenceProblem
  | "sponsor.unavailable"
  | "sponsor.notYours"
  | "sponsor.notFound"
  | "sponsor.moved"
  | "sponsor.productUnavailable"
  | "sponsor.full"
  | "sponsor.alreadyAsked"
  | "sponsor.needsReply"
  | "sponsor.notEnoughEarned"
  | "sponsor.noTransfer"
  | "sponsor.notStoppable";

export class SponsorRefused extends Error {
  constructor(readonly reason: SponsorRefusal, readonly days: string[] = []) {
    super(reason);
    this.name = "SponsorRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

async function ready(): Promise<Db> {
  const db = await handle();
  if (!(await sponsorReady(db))) throw new SponsorRefused("sponsor.unavailable");
  return db;
}

/** Only a store asks and pays: an administrator has no earnings for it to come off. */
function storeOf(actor: Actor): number {
  if (actor.kind !== "vendor") throw new SponsorRefused("sponsor.notYours");
  assertCan(actor, "ads.book", actor.vendorId);
  return actor.vendorId;
}

const flat = (text: string | null | undefined, max = SPONSOR_NOTE_MAX) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** NetLet's account a store transfers to, when it is recorded. */
export function transferAccount(): { name: string; iban: string } | null {
  const iban = env.payoutFromIban.replace(/\s+/g, "").toUpperCase();
  if (!iban || !isValidIban(iban)) return null;
  return { name: env.payoutFromName || "NetLet", iban };
}

/** The product a request is for: this store's, on the shelf now. */
async function productFor(db: Db | Tx, vendorId: number, productId: number) {
  const [row] = await db
    .select({ id: products.id, title: products.title, status: products.status, vendorStatus: vendors.status })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.id, productId), eq(products.vendorId, vendorId)))
    .limit(1);
  /* A draft, or a suspended store's product, would be a paid place the shelf will not show. */
  if (!row || row.status !== "published" || row.vendorStatus !== "approved") throw new SponsorRefused("sponsor.productUnavailable");
  return row;
}

/* ---------------------------------------------------------------- asking --- */

export type SponsorAsk = { productId: number; startsOn: string; days: number; note?: string | null };

export type SponsorQuote = {
  ready: boolean;
  cost: string;
  dailyRate: string;
  fullDays: string[];
  /** What the store has earned and not committed: whether paying from earnings would go through today. */
  room: string;
  problem: SponsorRefusal | null;
};

/** The same product asked for, or already sponsored, on any of these days. */
async function alreadyAsked(db: Db | Tx, productId: number, from: string, to: string, today: string): Promise<boolean> {
  const open = await db
    .select({ status: sponsorRequests.status, startsOn: sponsorRequests.startsOn, endsOn: sponsorRequests.endsOn, payBy: sponsorRequests.payBy })
    .from(sponsorRequests)
    .where(and(eq(sponsorRequests.productId, productId), inArray(sponsorRequests.status, ["review", "payment", "sent"]), lte(sponsorRequests.startsOn, to), gte(sponsorRequests.endsOn, from)));
  if (open.some(row => sponsorState(row, today) !== "lapsed")) return true;
  const booked = await db
    .select({ startsOn: adBookings.startsOn, endsOn: adBookings.endsOn, dailyRate: adBookings.dailyRate, cancelledOn: adBookings.cancelledOn })
    .from(adBookings)
    .where(and(eq(adBookings.productId, productId), eq(adBookings.slot, "home"), lte(adBookings.startsOn, to), gte(adBookings.endsOn, from)));
  return booked.some(booking => effectiveEnd(booking) >= from && booking.startsOn <= effectiveEnd(booking));
}

/** What a request would cost and whether it can be sent — the same checks the sending makes. */
export async function quoteSponsor(actor: Actor, ask: SponsorAsk, now = new Date()): Promise<SponsorQuote> {
  const vendorId = storeOf(actor);
  const db = await handle();
  const today = kuwaitToday(now);
  const days = Number.isInteger(ask.days) ? Math.max(0, ask.days) : 0;
  const base = { ready: true, cost: quoteFor("home", days), dailyRate: AD_RATES.home, fullDays: [] as string[], room: fromFils(await placementRoom(db, vendorId, now)) };
  if (!(await sponsorReady(db))) return { ...base, ready: false, problem: "sponsor.unavailable" };
  const problem = bookingProblem(ask, today);
  if (problem) return { ...base, problem };
  try {
    await productFor(db, vendorId, ask.productId);
    const endsOn = addDays(ask.startsOn, ask.days - 1);
    const full = fullDays(await overlapping(db, "home", null, ask.startsOn, endsOn, today), ask.startsOn, ask.days, AD_CAPACITY.home);
    if (full.length) return { ...base, fullDays: full, problem: "sponsor.full" };
    if (await alreadyAsked(db, ask.productId, ask.startsOn, endsOn, today)) return { ...base, problem: "sponsor.alreadyAsked" };
    return { ...base, problem: null };
  } catch (error) {
    if (error instanceof SponsorRefused) return { ...base, problem: error.reason };
    throw error;
  }
}

/**
 * Send a request. Nothing is charged: it holds its places from now until it
 * is paid for, declined, withdrawn or lapses, and NetLet's people are told.
 */
export async function requestSponsor(actor: Actor, ask: SponsorAsk, now = new Date()): Promise<{ id: number; total: string }> {
  const vendorId = storeOf(actor);
  const db = await ready();
  const today = kuwaitToday(now);
  const problem = bookingProblem(ask, today);
  if (problem) throw new SponsorRefused(problem);
  const endsOn = addDays(ask.startsOn, ask.days - 1);
  const total = quoteFor("home", ask.days);

  const made = await db.transaction(async tx => {
    /* The places are counted and taken under the bookings' one lock. */
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOKING_LOCK})`);
    const product = await productFor(tx, vendorId, ask.productId);
    const full = fullDays(await overlapping(tx, "home", null, ask.startsOn, endsOn, today), ask.startsOn, ask.days, AD_CAPACITY.home);
    if (full.length) throw new SponsorRefused("sponsor.full", full);
    if (await alreadyAsked(tx, product.id, ask.startsOn, endsOn, today)) throw new SponsorRefused("sponsor.alreadyAsked");
    const [row] = await tx
      .insert(sponsorRequests)
      .values({
        vendorId,
        productId: product.id,
        productTitle: product.title.slice(0, 255),
        startsOn: ask.startsOn,
        endsOn,
        dailyRate: AD_RATES.home,
        total,
        note: flat(ask.note) || null,
        requestedBy: actor.userId,
      })
      .returning({ id: sponsorRequests.id, title: sponsorRequests.productTitle, total: sponsorRequests.total });
    return row;
  });

  const [store] = await db.select({ name: vendors.name, nameAr: vendors.nameAr }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  await recordAudit(await auditActor(actor), {
    action: "sponsor.request",
    subjectType: "placement",
    subjectId: made.id,
    subjectLabel: made.title,
    vendorId,
    after: { startsOn: ask.startsOn, endsOn, total: made.total },
  });
  await notifyStaff({
    kind: "staff_sponsor_request",
    params: { store: store?.name ?? "", storeAr: store?.nameAr ?? "", product: made.title },
    link: "/admin/sponsored",
    dedupe: `sponsor:asked:${made.id}`,
  });
  return { id: made.id, total: made.total };
}

/* -------------------------------------------------------------- the rows --- */

type Row = typeof sponsorRequests.$inferSelect;

/** One request, read for a move: the store's own, or any for NetLet. */
async function find(db: Db | Tx, id: number, scope: number | undefined): Promise<Row> {
  const [row] = await db
    .select()
    .from(sponsorRequests)
    .where(and(eq(sponsorRequests.id, id), scope === undefined ? undefined : eq(sponsorRequests.vendorId, scope)))
    .limit(1);
  if (!row) throw new SponsorRefused("sponsor.notFound");
  return row;
}

/** The predicate a move is written with: still in the state and the run it was read in. */
const unchanged = (row: Row) => and(
  eq(sponsorRequests.id, row.id),
  eq(sponsorRequests.status, row.status),
  eq(sponsorRequests.startsOn, row.startsOn),
);

async function storeNames(db: Db | Tx, vendorId: number) {
  const [store] = await db.select({ name: vendors.name, nameAr: vendors.nameAr }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  return { store: store?.name ?? "", storeAr: store?.nameAr ?? "" };
}

/* ----------------------------------------------------------- NetLet's side --- */

/**
 * NetLet approves a request and asks for the payment: at the rate card's day
 * rate unless NetLet changes it, for the days still to come, by a last day
 * to pay. The store is told.
 */
export async function approveSponsor(
  actor: Actor,
  request: { id: number; dailyRate?: string | null; payBy?: string | null; reply?: string | null },
  now = new Date(),
): Promise<{ startsOn: string; total: string; payBy: string }> {
  assertCan(actor, "product.review");
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, request.id, undefined);
  if (sponsorState(row, today) !== "review") throw new SponsorRefused("sponsor.moved");
  const rate = (request.dailyRate ?? "").trim() || row.dailyRate;
  const rateWrong = rateProblem(rate);
  if (rateWrong) throw new SponsorRefused(rateWrong);
  const run = approvedRun(row, today, rate);
  const payBy = (request.payBy ?? "").trim() || defaultPayBy(run.startsOn, today);
  const payByWrong = payByProblem(payBy, run.startsOn, today);
  if (payByWrong) throw new SponsorRefused(payByWrong);
  const product = row.productId === null ? null : await db.select({ status: products.status }).from(products).where(eq(products.id, row.productId)).limit(1);
  if (!product?.[0] || product[0].status !== "published") throw new SponsorRefused("sponsor.productUnavailable");

  const [done] = await db
    .update(sponsorRequests)
    .set({ status: "payment", dailyRate: rate, total: run.total, startsOn: run.startsOn, payBy, reply: flat(request.reply) || null, reviewedBy: actor.userId, reviewedAt: now })
    .where(unchanged(row))
    .returning({ id: sponsorRequests.id });
  if (!done) throw new SponsorRefused("sponsor.moved");

  await recordAudit(await auditActor(actor), {
    action: "sponsor.approve",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    before: { status: "review", startsOn: row.startsOn, dailyRate: row.dailyRate },
    after: { status: "payment", startsOn: run.startsOn, dailyRate: rate, total: run.total, payBy },
  });
  await notifyStore(row.vendorId, {
    kind: "seller_sponsor_payment",
    params: { product: row.productTitle, total: run.total },
    link: "/admin/sponsored",
    dedupe: `sponsor:payment:${row.id}:${payBy}`,
  });
  return { startsOn: run.startsOn, total: run.total, payBy };
}

/**
 * NetLet declines a request, with the reason the store reads. A request whose
 * store has said it sent the money can be declined too — NetLet then owes the
 * transfer back, which the page says beside the press.
 */
export async function declineSponsor(actor: Actor, request: { id: number; reply: string }, now = new Date()): Promise<{ refund: string | null }> {
  assertCan(actor, "product.review");
  const reply = flat(request.reply);
  if (!reply) throw new SponsorRefused("sponsor.needsReply");
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, request.id, undefined);
  const state = sponsorState(row, today);
  if (state !== "review" && state !== "payment" && state !== "sent") throw new SponsorRefused("sponsor.moved");
  const [done] = await db
    .update(sponsorRequests)
    .set({ status: "declined", reply, reviewedBy: actor.userId, reviewedAt: now })
    .where(unchanged(row))
    .returning({ id: sponsorRequests.id });
  if (!done) throw new SponsorRefused("sponsor.moved");

  await recordAudit(await auditActor(actor), {
    action: "sponsor.decline",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    before: { status: row.status },
    after: { status: "declined", reply },
  });
  await notifyStore(row.vendorId, {
    kind: "seller_sponsor_declined",
    params: { product: row.productTitle, reason: reply },
    link: "/admin/sponsored",
    dedupe: `sponsor:declined:${row.id}`,
  });
  return { refund: state === "sent" ? row.total : null };
}

/**
 * A transfer the store said it sent has arrived: the request becomes a
 * placement on the home shelf. Confirmed after its first day, the run moves to
 * start today with every day kept, and the places of the days it moves onto
 * are counted again; `startsOn` lets NetLet start it later when those are full.
 *
 * Written at no day rate, because nothing comes off a payout for money already
 * in NetLet's account; what was paid stays on the request.
 */
export async function confirmSponsorPayment(actor: Actor, request: { id: number; startsOn?: string | null }, now = new Date()): Promise<{ startsOn: string; endsOn: string }> {
  assertCan(actor, "payouts.record");
  const db = await ready();
  const today = kuwaitToday(now);

  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOKING_LOCK})`);
    const row = await find(tx, request.id, undefined);
    if (sponsorState(row, today) !== "sent") throw new SponsorRefused("sponsor.moved");
    const days = daysInclusive(row.startsOn, row.endsOn);
    const chosen = (request.startsOn ?? "").trim();
    const run = chosen
      ? { startsOn: chosen, endsOn: addDays(chosen, days - 1) }
      : confirmedRun(row, today);
    const problem = bookingProblem({ startsOn: run.startsOn, days }, today);
    if (problem) throw new SponsorRefused(problem);
    /* Its own old days are not counted against it: it held them. */
    const full = fullDays(await overlapping(tx, "home", null, run.startsOn, run.endsOn, today, row.id), run.startsOn, days, AD_CAPACITY.home);
    if (full.length) throw new SponsorRefused("sponsor.full", full);

    const [booking] = await tx
      .insert(adBookings)
      .values({
        vendorId: row.vendorId,
        productId: row.productId,
        productTitle: row.productTitle,
        slot: "home",
        startsOn: run.startsOn,
        endsOn: run.endsOn,
        dailyRate: "0.000",
        total: "0.000",
        bookedBy: row.requestedBy,
      })
      .returning({ id: adBookings.id });
    const [done] = await tx
      .update(sponsorRequests)
      .set({ status: "paid", paidAt: now, confirmedBy: actor.userId, bookingId: booking.id, startsOn: run.startsOn, endsOn: run.endsOn })
      .where(unchanged(row))
      .returning({ id: sponsorRequests.id });
    if (!done) throw new SponsorRefused("sponsor.moved");
    return { row, run };
  });

  await recordAudit(await auditActor(actor), {
    action: "sponsor.confirm",
    subjectType: "placement",
    subjectId: result.row.id,
    subjectLabel: result.row.productTitle,
    vendorId: result.row.vendorId,
    before: { status: "sent", startsOn: result.row.startsOn },
    after: { status: "paid", paidWith: "transfer", reference: result.row.paymentReference, total: result.row.total, startsOn: result.run.startsOn, endsOn: result.run.endsOn },
  });
  await notifyStore(result.row.vendorId, {
    kind: "seller_sponsor_live",
    params: { product: result.row.productTitle, total: result.row.total },
    link: "/admin/sponsored",
    dedupe: `sponsor:live:${result.row.id}`,
  });
  return result.run;
}

/**
 * A transfer that has not arrived: the request goes back to waiting for the
 * payment, by a new last day to pay, with NetLet's words to the store.
 */
export async function sponsorNotReceived(actor: Actor, request: { id: number; reply: string; payBy?: string | null }, now = new Date()): Promise<{ payBy: string }> {
  assertCan(actor, "payouts.record");
  const reply = flat(request.reply);
  if (!reply) throw new SponsorRefused("sponsor.needsReply");
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, request.id, undefined);
  if (sponsorState(row, today) !== "sent") throw new SponsorRefused("sponsor.moved");
  /* Its first day may have passed while the money was looked for: it starts on the day it is paid. */
  const startsOn = row.startsOn < today ? today : row.startsOn;
  if (startsOn > row.endsOn) throw new SponsorRefused("ads.inPast");
  const payBy = (request.payBy ?? "").trim() || defaultPayBy(startsOn, today);
  const payByWrong = payByProblem(payBy, startsOn, today);
  if (payByWrong) throw new SponsorRefused(payByWrong);
  const total = fromFils(toFils(row.dailyRate) * BigInt(daysInclusive(startsOn, row.endsOn)));
  const [done] = await db
    .update(sponsorRequests)
    .set({ status: "payment", payBy, reply, startsOn, total, paidWith: null, sentAt: null })
    .where(unchanged(row))
    .returning({ id: sponsorRequests.id });
  if (!done) throw new SponsorRefused("sponsor.moved");

  await recordAudit(await auditActor(actor), {
    action: "sponsor.notReceived",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    before: { status: "sent", reference: row.paymentReference },
    after: { status: "payment", payBy, reply },
  });
  await notifyStore(row.vendorId, {
    kind: "seller_sponsor_not_received",
    params: { product: row.productTitle, reason: reply },
    link: "/admin/sponsored",
    dedupe: `sponsor:missing:${row.id}:${now.getTime()}`,
  });
  return { payBy };
}

/* ----------------------------------------------------------- the store's side --- */

/**
 * Pay from earnings: taken off the store's payouts as every placement's fee
 * is, a day at a time as it runs, and the product goes on the shelf on its
 * days at once. Refused when the store has not earned enough to cover it
 * beyond what its other placements can still cost.
 */
export async function paySponsorFromEarnings(actor: Actor, id: number, now = new Date()): Promise<{ startsOn: string; endsOn: string }> {
  const vendorId = storeOf(actor);
  const db = await ready();
  const today = kuwaitToday(now);

  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOKING_LOCK})`);
    await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).for("update");
    const row = await find(tx, id, vendorId);
    if (sponsorState(row, today) !== "payment") throw new SponsorRefused("sponsor.moved");
    if (row.productId === null) throw new SponsorRefused("sponsor.productUnavailable");
    await productFor(tx, vendorId, row.productId);
    const run = confirmedRun(row, today);
    if (toFils(row.total) > await placementRoom(tx, vendorId, now)) throw new SponsorRefused("sponsor.notEnoughEarned");
    const [booking] = await tx
      .insert(adBookings)
      .values({
        vendorId,
        productId: row.productId,
        productTitle: row.productTitle,
        slot: "home",
        startsOn: run.startsOn,
        endsOn: run.endsOn,
        dailyRate: row.dailyRate,
        total: row.total,
        bookedBy: actor.userId,
      })
      .returning({ id: adBookings.id });
    const [done] = await tx
      .update(sponsorRequests)
      .set({ status: "paid", paidWith: "earnings", paidAt: now, bookingId: booking.id, startsOn: run.startsOn, endsOn: run.endsOn })
      .where(unchanged(row))
      .returning({ id: sponsorRequests.id });
    if (!done) throw new SponsorRefused("sponsor.moved");
    return { row, run };
  });

  await recordAudit(await auditActor(actor), {
    action: "sponsor.payEarnings",
    subjectType: "placement",
    subjectId: result.row.id,
    subjectLabel: result.row.productTitle,
    vendorId,
    after: { status: "paid", paidWith: "earnings", total: result.row.total, startsOn: result.run.startsOn, endsOn: result.run.endsOn },
  });
  return result.run;
}

/**
 * The store says it transferred the money, with the bank's reference. It
 * waits for NetLet to see it arrive, and no longer lapses: the money may be on
 * its way, and only a person can say it did not come.
 */
export async function sendSponsorTransfer(actor: Actor, request: { id: number; reference: string }, now = new Date()): Promise<void> {
  const vendorId = storeOf(actor);
  if (!transferAccount()) throw new SponsorRefused("sponsor.noTransfer");
  const reference = flat(request.reference, 200);
  const wrong = referenceProblem(reference);
  if (wrong) throw new SponsorRefused(wrong);
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, request.id, vendorId);
  if (sponsorState(row, today) !== "payment") throw new SponsorRefused("sponsor.moved");
  const [done] = await db
    .update(sponsorRequests)
    .set({ status: "sent", paidWith: "transfer", paymentReference: reference, sentAt: now })
    .where(unchanged(row))
    .returning({ id: sponsorRequests.id });
  if (!done) throw new SponsorRefused("sponsor.moved");

  await recordAudit(await auditActor(actor), {
    action: "sponsor.sendTransfer",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId,
    after: { status: "sent", reference, total: row.total },
  });
  await notifyStaff({
    kind: "staff_sponsor_sent",
    params: { ...(await storeNames(db, vendorId)), product: row.productTitle, total: row.total },
    link: "/admin/sponsored",
    dedupe: `sponsor:sent:${row.id}:${now.getTime()}`,
  });
}

/** The store takes back a request not yet paid. Nothing was charged. */
export async function withdrawSponsor(actor: Actor, id: number, now = new Date()): Promise<void> {
  const vendorId = storeOf(actor);
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, id, vendorId);
  const state = sponsorState(row, today);
  if (state !== "review" && state !== "payment") throw new SponsorRefused("sponsor.moved");
  const [done] = await db.update(sponsorRequests).set({ status: "withdrawn" }).where(unchanged(row)).returning({ id: sponsorRequests.id });
  if (!done) throw new SponsorRefused("sponsor.moved");
  await recordAudit(await auditActor(actor), {
    action: "sponsor.withdraw",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId,
    before: { status: row.status },
    after: { status: "withdrawn" },
  });
}

/**
 * Stop a paid sponsorship. Paid from earnings, it is the store's to stop, as
 * any placement is: before it starts it costs nothing, while it runs it ends
 * today and today is charged. Paid by transfer, the money is already in
 * NetLet's account, so only NetLet takes it down, and the answer says what is
 * owed back for the days it will not be shown.
 */
export async function stopSponsor(actor: Actor, id: number, now = new Date()): Promise<{ refund: string | null }> {
  const scope = actor.kind === "vendor" ? actor.vendorId : undefined;
  if (actor.kind === "vendor") assertCan(actor, "ads.book", actor.vendorId);
  else assertCan(actor, "ads.book");
  const db = await ready();
  const today = kuwaitToday(now);
  const row = await find(db, id, scope);
  if (row.status !== "paid" || row.bookingId === null) throw new SponsorRefused("sponsor.notStoppable");
  if (actor.kind === "vendor" && row.paidWith === "transfer") throw new SponsorRefused("sponsor.notStoppable");

  const [booking] = await db
    .update(adBookings)
    .set({ cancelledOn: today, cancelledBy: actor.userId })
    .where(and(eq(adBookings.id, row.bookingId), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, today)))
    .returning({ startsOn: adBookings.startsOn, endsOn: adBookings.endsOn });
  if (!booking) throw new SponsorRefused("sponsor.notStoppable");
  const refund = row.paidWith === "transfer" ? refundFor({ startsOn: booking.startsOn, endsOn: booking.endsOn, dailyRate: row.dailyRate }, today) : null;

  await recordAudit(await auditActor(actor), {
    action: "sponsor.stop",
    subjectType: "placement",
    subjectId: row.id,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    after: { cancelledOn: today, ...(refund ? { refund } : {}) },
  });
  if (actor.kind !== "vendor") {
    await notifyStore(row.vendorId, {
      kind: "seller_sponsor_stopped",
      params: { product: row.productTitle },
      link: "/admin/sponsored",
      dedupe: `sponsor:stopped:${row.id}`,
    });
  }
  return { refund };
}

/* ------------------------------------------------------------------ reading --- */

export const SPONSOR_VIEWS = ["todo", "open", "live", "done", "all"] as const;
export type SponsorView = (typeof SPONSOR_VIEWS)[number];

export type SponsorResults = {
  /** Days it has been on the shelf so far. */
  daysShown: number;
  /** Views of the product reached from the home page on those days. */
  homeViews: number;
  homeVisitors: number;
  /** The same number of days before it started. */
  viewsBefore: number;
  /** Home-page views a day against the days before, as a percentage; null with nothing to compare. */
  lift: number | null;
  /** Orders with the product placed on its days. */
  orders: number;
};

export type SponsorRow = {
  id: number;
  vendorId: number;
  vendorName: string;
  productId: number | null;
  productTitle: string;
  productHandle: string | null;
  photo: string | null;
  startsOn: string;
  endsOn: string;
  days: number;
  dailyRate: string;
  total: string;
  status: SponsorStatus;
  state: SponsorState;
  step: SponsorStep;
  stopped: boolean;
  note: string | null;
  reply: string | null;
  payBy: string | null;
  /** The last day to pay NetLet would suggest now, for the approval form. */
  suggestedPayBy: string;
  paidWith: SponsorPaidWith | null;
  paymentReference: string | null;
  /** What the store writes on its transfer. */
  transferReference: string;
  createdAt: string;
  reviewedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  placement: { state: BookingState; startsOn: string; endsOn: string; cancelledOn: string | null; accrued: string } | null;
  actions: SponsorActions & { stop: boolean };
  /** For NetLet, on a run paid by transfer: what would be owed back if it were taken down today. */
  refundIfStopped: string | null;
  /** For NetLet, on a request waiting on it: what the store has earned and not committed. */
  storeRoom: string | null;
  results: SponsorResults | null;
};

export type SponsorList = Page<SponsorRow> & {
  ready: boolean;
  counts: Record<SponsorView, number>;
  /** NetLet's account a store transfers to, or null when it is not recorded. */
  transfer: { name: string; iban: string } | null;
  /** The store's own earnings not yet committed, for the store. */
  room: string | null;
  rateCard: string;
  capacity: number;
};

/** At most this many of a scope's newest requests are filtered and counted. */
const REQUEST_SCAN = 1_000;

function viewOf(state: SponsorState, placement: BookingState | null, side: "store" | "netlet"): SponsorView[] {
  const views: SponsorView[] = ["all"];
  if (state === "review" || state === "payment" || state === "sent") views.push("open");
  if (side === "netlet" ? state === "review" || state === "sent" : state === "payment") views.push("todo");
  if (state === "paid" && (placement === "upcoming" || placement === "running")) views.push("live");
  if (state === "declined" || state === "withdrawn" || state === "lapsed" || (state === "paid" && (placement === "ended" || placement === "cancelled"))) views.push("done");
  return views;
}

/** Results for paid requests, from the home page's views and the orders on their days. */
async function resultsFor(db: Db, rows: { id: number; productId: number | null; startsOn: string; last: string; daysShown: number }[]): Promise<Map<number, SponsorResults>> {
  const out = new Map<number, SponsorResults>();
  await Promise.all(rows.map(async row => {
    if (row.productId === null || row.daysShown <= 0) {
      out.set(row.id, { daysShown: Math.max(0, row.daysShown), homeViews: 0, homeVisitors: 0, viewsBefore: 0, lift: null, orders: 0 });
      return;
    }
    const before = addDays(row.startsOn, -row.daysShown);
    let during = { views: 0, visitors: 0 };
    let earlier = 0;
    try {
      const [now] = await db
        .select({ views: sql<number>`coalesce(sum(${productViews.views}), 0)::int`, visitors: sql<number>`coalesce(sum(${productViews.visitors}), 0)::int` })
        .from(productViews)
        .where(and(eq(productViews.productId, row.productId), eq(productViews.source, "home"), gte(productViews.day, row.startsOn), lte(productViews.day, row.last)));
      const [then] = await db
        .select({ views: sql<number>`coalesce(sum(${productViews.views}), 0)::int` })
        .from(productViews)
        .where(and(eq(productViews.productId, row.productId), eq(productViews.source, "home"), gte(productViews.day, before), lte(productViews.day, addDays(row.startsOn, -1))));
      during = { views: now?.views ?? 0, visitors: now?.visitors ?? 0 };
      earlier = then?.views ?? 0;
    } catch (error) {
      /* Product views is a table of its own (0084); missing, there is nothing to count. */
      if (!isMissingTable(error)) throw error;
    }
    const [sold] = await db
      .select({ n: sql<number>`count(distinct ${orderItems.orderId})::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        eq(orderItems.productId, row.productId),
        ne(orders.status, "cancelled"),
        gte(orders.placedAt, new Date(endOfKuwaitDay(addDays(row.startsOn, -1)).getTime() + 1)),
        lte(orders.placedAt, endOfKuwaitDay(row.last)),
      ));
    out.set(row.id, {
      daysShown: row.daysShown,
      homeViews: during.views,
      homeVisitors: during.visitors,
      viewsBefore: earlier,
      lift: liftPercent({ views: during.views, days: row.daysShown }, { views: earlier, days: row.daysShown }),
      orders: sold?.n ?? 0,
    });
  }));
  return out;
}

/**
 * Requests, newest first: the store's own, or every store's for NetLet. The
 * views are counted over the scope's newest `REQUEST_SCAN` — a state that
 * lapses is a date, so it is read in code, not in SQL — and the page is cut
 * from what the view leaves.
 */
export async function listSponsors(actor: Actor, request: { view?: SponsorView; page?: number; pageSize?: number } = {}, now = new Date()): Promise<SponsorList> {
  let scope: number | undefined;
  if (actor.kind === "vendor") {
    assertCan(actor, "ads.book", actor.vendorId);
    scope = actor.vendorId;
  } else {
    assertCan(actor, "ads.book");
  }
  const side = scope === undefined ? "netlet" : "store";
  const db = await handle();
  const today = kuwaitToday(now);
  const pageSize = clampPageSize(request.pageSize ?? 20);
  const empty = { todo: 0, open: 0, live: 0, done: 0, all: 0 };
  const base = {
    transfer: transferAccount(),
    room: scope === undefined ? null : fromFils(await placementRoom(db, scope, now)),
    rateCard: AD_RATES.home,
    capacity: AD_CAPACITY.home,
  };
  if (!(await sponsorReady(db))) return { ...base, ready: false, counts: empty, rows: [], total: 0, page: 1, pageSize };

  const found = await db
    .select({
      request: sponsorRequests,
      vendorName: vendors.name,
      productHandle: products.handle,
      booking: { startsOn: adBookings.startsOn, endsOn: adBookings.endsOn, cancelledOn: adBookings.cancelledOn, dailyRate: adBookings.dailyRate },
    })
    .from(sponsorRequests)
    .innerJoin(vendors, eq(sponsorRequests.vendorId, vendors.id))
    .leftJoin(products, eq(sponsorRequests.productId, products.id))
    .leftJoin(adBookings, eq(sponsorRequests.bookingId, adBookings.id))
    .where(scope === undefined ? undefined : eq(sponsorRequests.vendorId, scope))
    .orderBy(desc(sponsorRequests.id))
    .limit(REQUEST_SCAN);

  const judged = found.map(entry => {
    const state = sponsorState(entry.request, today);
    const booking = entry.booking?.startsOn ? entry.booking as { startsOn: string; endsOn: string; cancelledOn: string | null; dailyRate: string } : null;
    const placement = booking ? bookingState(booking, today) : null;
    return { entry, state, booking, placement, views: viewOf(state, placement === "inReview" || placement === "rejected" ? null : placement, side) };
  });
  const counts = { ...empty };
  for (const one of judged) for (const view of one.views) counts[view] += 1;
  const view = request.view ?? "all";
  const chosen = judged.filter(one => one.views.includes(view));
  const total = chosen.length;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const slice = chosen.slice(offsetFor(page, pageSize), offsetFor(page, pageSize) + pageSize);

  const productIds = [...new Set(slice.flatMap(one => (one.entry.request.productId === null ? [] : [one.entry.request.productId])))];
  const photos = productIds.length
    ? await db
        .selectDistinctOn([productImages.productId], { productId: productImages.productId, url: productImages.url })
        .from(productImages)
        .where(and(inArray(productImages.productId, productIds), eq(productImages.kind, "image")))
        .orderBy(productImages.productId, productImages.position, productImages.id)
    : [];
  const photoOf = new Map(photos.map(row => [row.productId, row.url]));

  /* What each waiting store could pay from earnings, for NetLet reading its request. */
  const rooms = new Map<number, string>();
  if (side === "netlet") {
    const waiting = [...new Set(slice.filter(one => one.state === "review" || one.state === "payment").map(one => one.entry.request.vendorId))];
    await Promise.all(waiting.map(async vendorId => rooms.set(vendorId, fromFils(await placementRoom(db, vendorId, now)))));
  }

  const paid = slice.filter(one => one.state === "paid" && one.booking);
  const results = await resultsFor(db, paid.map(one => {
    const booking = one.booking!;
    const end = effectiveEnd(booking);
    const last = end < today ? end : today;
    return { id: one.entry.request.id, productId: one.entry.request.productId, startsOn: booking.startsOn, last, daysShown: booking.startsOn <= last ? daysInclusive(booking.startsOn, last) : 0 };
  }));

  const transferOffered = base.transfer !== null;
  const rows: SponsorRow[] = slice.map(({ entry, state, booking, placement }) => {
    const row = entry.request;
    const shelf = placement === "inReview" || placement === "rejected" ? null : placement;
    const step = sponsorStep(state, shelf);
    const live = shelf === "upcoming" || shelf === "running";
    const stop = live && booking !== null && (side === "netlet" || row.paidWith === "earnings");
    return {
      id: row.id,
      vendorId: row.vendorId,
      vendorName: entry.vendorName,
      productId: row.productId,
      productTitle: row.productTitle,
      productHandle: entry.productHandle,
      photo: row.productId === null ? null : photoOf.get(row.productId) ?? null,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      days: daysInclusive(row.startsOn, row.endsOn),
      dailyRate: row.dailyRate,
      total: row.total,
      status: row.status,
      state,
      step: step.step,
      stopped: step.stopped,
      note: row.note,
      reply: row.reply,
      payBy: row.payBy,
      suggestedPayBy: defaultPayBy(row.startsOn < today ? today : row.startsOn, today),
      paidWith: row.paidWith,
      paymentReference: row.paymentReference,
      transferReference: transferReference(row.id),
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      placement: booking && shelf
        ? {
            state: shelf,
            startsOn: booking.startsOn,
            endsOn: booking.endsOn,
            cancelledOn: booking.cancelledOn,
            /* Paid by transfer, the placement carries no rate: what it has cost is what was paid. */
            accrued: row.paidWith === "transfer" ? row.total : fromFils(feeAccrued(booking, today)),
          }
        : null,
      actions: { ...sponsorActions(state, side, transferOffered), stop },
      refundIfStopped: side === "netlet" && stop && row.paidWith === "transfer" && booking
        ? refundFor({ startsOn: booking.startsOn, endsOn: booking.endsOn, dailyRate: row.dailyRate }, today)
        : null,
      storeRoom: rooms.get(row.vendorId) ?? null,
      results: results.get(row.id) ?? null,
    };
  });

  return { ...base, ready: true, counts, rows, total, page, pageSize };
}

/** Requests waiting on NetLet — to review, or a transfer to look for — for the overview's tile. */
export async function countSponsorsWaiting(actor: Actor, now = new Date()): Promise<number> {
  if (!can(actor, "product.review")) return 0;
  const db = await getDb();
  if (!db || !(await sponsorReady(db))) return 0;
  const today = kuwaitToday(now);
  const rows = await db
    .select({ status: sponsorRequests.status, startsOn: sponsorRequests.startsOn, endsOn: sponsorRequests.endsOn, payBy: sponsorRequests.payBy })
    .from(sponsorRequests)
    .where(inArray(sponsorRequests.status, ["review", "sent"]));
  return rows.filter(row => {
    const state = sponsorState(row, today);
    return state === "review" || state === "sent";
  }).length;
}

/** Requests waiting on the store — a payment asked for — for its overview's tile. */
export async function countSponsorsToPay(actor: Actor, now = new Date()): Promise<number> {
  if (actor.kind !== "vendor" || !can(actor, "ads.book", actor.vendorId)) return 0;
  const db = await getDb();
  if (!db || !(await sponsorReady(db))) return 0;
  const today = kuwaitToday(now);
  const rows = await db
    .select({ status: sponsorRequests.status, startsOn: sponsorRequests.startsOn, endsOn: sponsorRequests.endsOn, payBy: sponsorRequests.payBy })
    .from(sponsorRequests)
    .where(and(eq(sponsorRequests.vendorId, actor.vendorId), eq(sponsorRequests.status, "payment")));
  return rows.filter(row => sponsorState(row, today) === "payment").length;
}
