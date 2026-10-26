/**
 * Referrals, and the points ledger behind them.
 *
 * Requirements 3.1.14 (two tracks) and 3.1.15 (spend the points or cash out at
 * 10%). Pure, because every number here is money somebody is owed, and a
 * balance you can only check by referring a real friend is one nobody checks.
 *
 * ## The ledger is the design
 *
 * **A balance is never stored.** It is the sum of the entries, always. A
 * stored balance beside a list of entries is two records of one fact, and the
 * moment a write fails halfway they disagree — with the shop's own answer
 * being the one nobody can audit. Summing is cheap and it cannot drift.
 *
 * **Every entry says why.** "Because Noura placed her first order" is
 * checkable by the person holding the points; a number that went up is not.
 * The same argument `vendorHealth` makes for carrying its raw counts and the
 * recommendation rail makes for carrying its reasons.
 *
 * **Points are earned on a completed sale, never on a sign-up.** A referral
 * that pays out when somebody registers pays for registrations, and the people
 * who notice that first are not the ones a shop wants. The referred shopper's
 * first *paid* order is the event.
 *
 * ## Two tracks
 *
 * The requirement asks for two, and they are genuinely different things: the
 * **referrer** earns for bringing somebody, and the **referred** gets a welcome
 * credit of their own. Paying only the referrer makes the invitation something
 * done *to* a friend; paying only the friend makes it charity.
 *
 * Both land at the same moment — the friend's first order being paid for — for
 * the reason above. A welcome credit handed out at registration is a welcome
 * credit handed out to whoever can make registrations.
 *
 * ## Cashing out
 *
 * Points spend inside NetLet at their face value and cash out at their face
 * value less a cash-collection fee of `CASH_OUT_FEE_PERCENT` — ten per cent,
 * the owner's document's own figure (3.1.15). It paid a tenth for a long time,
 * which kept nine-tenths of what a shopper had earned; the document deducts a
 * tenth instead. The fee is a constant so the figure on the page and the
 * figure in the payout cannot disagree.
 *
 * ## Commissions, and the hold (migration 0062)
 *
 * The welcome above is a one-off. Beside it the document asks for two
 * commissions, both percentages of **NetLet's own commission** on a line —
 * never of the price, so a referral cannot cost more than NetLet earned and the
 * seller's net is never touched — at rates an administrator sets
 * (`Shared/settings.ts`, 20% and 10% to start):
 *
 * - **A product link.** Any account's code on a product's address
 *   (`/products/x?ref=NL…`). A line for that product bought through it freezes
 *   who shared it and the rate, and the sharer earns on that line alone.
 * - **The invite, ongoing.** From the invitee's first paid order, the inviter
 *   earns on every line of every order they place, for as long as the
 *   programme runs.
 *
 * **Both are held until the line's return window has passed** (3.1.14). The
 * entry is written when the cash is collected, with the moment it matures; a
 * balance counts only what has matured, so nothing is spent or cashed out on a
 * sale that may still come back, and a line returned before then takes its
 * share back with a reversal that matures at the same moment — so a held
 * commission and its reversal cancel out without the shopper ever seeing
 * either in their balance.
 */
import { fromFils, toFils } from "../money.js";
import { RETURN_WINDOW_DAYS } from "./returns.js";

/** What the referrer earns when their friend's first order completes. */
export const REFERRER_POINTS = 500;

/** What the friend gets for arriving through one, credited at the same moment. */
export const REFERRED_POINTS = 250;

/** How long a product link keeps counting after it is opened, and how many a browser keeps. */
export const PRODUCT_LINK_DAYS = 30;
export const MAX_PRODUCT_REFERRALS = 20;

/** One point is one fil when spent inside NetLet. */
export const FILS_PER_POINT = 1n;

/**
 * The cash-collection fee taken off a points payout, in per cent of the
 * points' face value (3.1.15). Spent in the shop a point is worth its whole
 * fil; paid out, it is worth that less this.
 */
export const CASH_OUT_FEE_PERCENT = 10;

/** The fewest points worth the trouble of a payout. */
export const MIN_CASH_OUT_POINTS = 1000;

/** Why an entry exists. Stored, because "the balance went up" is not a reason. */
export const POINT_REASONS = [
  "referrer_bonus",
  "referred_welcome",
  "spent_on_order",
  "cashed_out",
  "admin_adjustment",
  /* Points spent on an order whose every line was cancelled before payment,
     given back when it closed. */
  "order_cancelled",
  /* An affiliate's commission and its reversal on a refund (3.7), in the
     affiliate pot rather than the points one. */
  "affiliate_commission",
  "affiliate_reversal",
  /* A product link's share of one line, and an inviter's ongoing share of one
     of their invitee's lines — each held until the line's return window has
     passed, and taken back by its reversal if the line comes back first. */
  "product_referral",
  "invite_commission",
  "product_referral_reversal",
  "invite_commission_reversal",
] as const;
export type PointReason = (typeof POINT_REASONS)[number];

export type PointEntry = {
  reason: PointReason;
  /** Positive earns, negative spends. Never zero: an entry that moves nothing is noise. */
  points: number;
  createdAt?: Date | string;
  /** When it may be spent; absent or null is now. */
  availableAt?: Date | string | null;
};

/** Whether an entry counts towards what may be spent at `now`. */
export function matured(entry: Pick<PointEntry, "availableAt">, now: Date): boolean {
  return !entry.availableAt || new Date(entry.availableAt).getTime() <= now.getTime();
}

/**
 * The balance, summed from the entries that have matured.
 *
 * Never stored. A stored balance beside the entries is two records of one
 * fact, and they disagree the first time a write fails halfway.
 */
export function balanceOf(entries: PointEntry[], now = new Date()): number {
  return entries.filter(entry => matured(entry, now)).reduce((sum, entry) => sum + Math.trunc(entry.points), 0);
}

/** What is earned and still held — a commission whose line may yet come back. */
export function heldOf(entries: PointEntry[], now = new Date()): number {
  return entries.filter(entry => !matured(entry, now)).reduce((sum, entry) => sum + Math.trunc(entry.points), 0);
}

/** The commissions that are ever held, and each one's reversal. */
export const COMMISSION_REASONS = ["product_referral", "invite_commission"] as const satisfies readonly PointReason[];
export type CommissionReason = (typeof COMMISSION_REASONS)[number];
export const REVERSAL_OF: Record<CommissionReason, PointReason> = {
  product_referral: "product_referral_reversal",
  invite_commission: "invite_commission_reversal",
};

/**
 * One line's referral commission, in points: the rate on **NetLet's own
 * commission** on that line, rounded down — a point is a fil, and rounding a
 * payout up invents money — and never more than that commission.
 */
export function referralSharePoints(netletCommission: string, ratePercent: string): number {
  const commission = toFils(netletCommission);
  if (commission <= 0n) return 0;
  const basisPoints = toFils(ratePercent) / 10n; // "20.00" → 20000 fils → 2000 basis points
  const share = (commission * basisPoints) / 10_000n;
  const capped = share < 0n ? 0n : share > commission ? commission : share;
  return Number(capped / FILS_PER_POINT);
}

/**
 * When a line's commission may be spent: the end of its return window — from
 * the day it arrived, or, while nobody has recorded that, from the day the cash
 * was collected (moved on to the arrival when it is recorded, so a parcel still
 * in a van cannot mature a commission it may yet take back).
 */
export function maturesAt(deliveredAt: Date | string | null | undefined, collectedAt: Date, windowDays = RETURN_WINDOW_DAYS): Date {
  const from = deliveredAt ? new Date(deliveredAt) : collectedAt;
  const base = Number.isFinite(from.getTime()) ? from : collectedAt;
  return new Date(base.getTime() + windowDays * 86_400_000);
}

/** What these points are worth spent inside NetLet, as money. */
export function spendValue(points: number): string {
  return fromFils(BigInt(Math.max(0, Math.trunc(points))) * FILS_PER_POINT);
}

/**
 * What these points are worth cashed out.
 *
 * Rounded **down**, in fils, because rounding a payout up invents money — the
 * same discipline `unitPrice` applies to the dinar.
 */
export function cashOutValue(points: number): string {
  const whole = BigInt(Math.max(0, Math.trunc(points)));
  /* Bigint division floors, so a payout is never rounded up. */
  return fromFils((whole * FILS_PER_POINT * BigInt(100 - CASH_OUT_FEE_PERCENT)) / 100n);
}

/** Whether a balance may be cashed out, and why not when it may not. */
export function canCashOut(points: number): { ok: true } | { ok: false; shortBy: number } {
  const whole = Math.trunc(points);
  return whole >= MIN_CASH_OUT_POINTS ? { ok: true } : { ok: false, shortBy: MIN_CASH_OUT_POINTS - whole };
}

/**
 * The most of an order a balance may pay for.
 *
 * Capped at the order, because points are a discount and not a deposit: paying
 * more than the total would leave the shop owing change on a payment that has
 * not happened.
 */
export function pointsSpendableOn(points: number, orderTotal: string): number {
  const available = Math.max(0, Math.trunc(points));
  const total = Number(toFils(orderTotal) / FILS_PER_POINT);
  return Math.min(available, total);
}

/**
 * A referral code from an account id.
 *
 * Derived rather than stored: one account has one code, for ever, and a stored
 * column is a second copy that can be edited into a collision. The alphabet
 * drops the characters people mishear, the same set the order reference uses —
 * a code gets read out loud far more often than an order number does.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23456789";

export function referralCodeFor(userId: number): string {
  let value = Math.max(1, Math.trunc(userId));
  let code = "";
  while (value > 0) {
    code = ALPHABET[value % ALPHABET.length] + code;
    value = Math.floor(value / ALPHABET.length);
  }
  return `NL${code.padStart(4, ALPHABET[0])}`;
}

/** The account a code names, or null when it names nothing. */
export function userIdFromCode(code: string): number | null {
  const body = code.trim().toUpperCase().replace(/^NL/, "");
  if (!body || [...body].some(character => !ALPHABET.includes(character))) return null;
  let value = 0;
  for (const character of body) value = value * ALPHABET.length + ALPHABET.indexOf(character);
  return value > 0 ? value : null;
}

/**
 * May this referral be credited?
 *
 * Refusing self-referral is the whole of the fraud model that can be enforced
 * without knowing who somebody is — anything more needs identity NetLet does
 * not have, and pretending otherwise would be security theatre. The
 * once-per-referred-account rule is the database's, as a unique index.
 */
export function acceptableReferral(referrerId: number, referredId: number): boolean {
  return referrerId > 0 && referredId > 0 && referrerId !== referredId;
}
