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
 * Points spend inside NetLet at their face value and cash out at
 * `CASH_OUT_RATE` — a tenth. That is not a penalty hidden in the small print:
 * points spent in the shop come back as sales, and points paid out in cash do
 * not, so the two cannot be worth the same without the shop paying people to
 * leave. The rate is a constant so the figure on the page and the figure in
 * the payout cannot disagree.
 */
import { fromFils, toFils } from "../money.js";

/** What the referrer earns when their friend's first order completes. */
export const REFERRER_POINTS = 500;

/** What the friend gets for arriving through one, credited at the same moment. */
export const REFERRED_POINTS = 250;

/** One point is one fil when spent inside NetLet. */
export const FILS_PER_POINT = 1n;

/**
 * What a point is worth in cash — a tenth of its value in the shop.
 *
 * Points spent here come back as sales; points paid out do not. Making the two
 * equal would be paying people to take their money elsewhere.
 */
export const CASH_OUT_RATE = 0.1;

/** The fewest points worth the trouble of a payout. */
export const MIN_CASH_OUT_POINTS = 1000;

/** Why an entry exists. Stored, because "the balance went up" is not a reason. */
export const POINT_REASONS = [
  "referrer_bonus",
  "referred_welcome",
  "spent_on_order",
  "cashed_out",
  "admin_adjustment",
  /* An affiliate's commission and its reversal on a refund (3.7), in the
     affiliate pot rather than the points one. */
  "affiliate_commission",
  "affiliate_reversal",
] as const;
export type PointReason = (typeof POINT_REASONS)[number];

export type PointEntry = {
  reason: PointReason;
  /** Positive earns, negative spends. Never zero: an entry that moves nothing is noise. */
  points: number;
  createdAt?: Date | string;
};

/**
 * The balance, summed from the entries.
 *
 * Never stored. A stored balance beside the entries is two records of one
 * fact, and they disagree the first time a write fails halfway.
 */
export function balanceOf(entries: PointEntry[]): number {
  return entries.reduce((sum, entry) => sum + Math.trunc(entry.points), 0);
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
  const whole = Math.max(0, Math.trunc(points));
  return fromFils(BigInt(Math.floor(whole * CASH_OUT_RATE)) * FILS_PER_POINT);
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
