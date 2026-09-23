/**
 * The basket somebody left behind.
 *
 * Requirement 3.1.17. Pure, and small, because the interesting part of this
 * feature is not the arithmetic — it is being honest about what NetLet can
 * actually do.
 *
 * ## What this is, and why it is not email
 *
 * **There is no mail provider and no scheduler.** Firebase sends the auth
 * emails and nothing else, and nothing in this deployment runs on a timer. A
 * recovery *email* would need both, and a reminder that depends on a cron
 * nobody runs is a dead feature that looks finished — the same dishonesty the
 * notifications bell and the absent social sign-in are careful to avoid.
 *
 * So the reminder is **resolved on the read**, the way the discount permit and
 * the pre-order date are: the moment a shopper with a stale basket loads the
 * shop, the shop says so. It needs nothing to run, it cannot go stale, and it
 * reaches exactly the person it is about. When a mail provider exists, this
 * same function decides who gets the email.
 *
 * **Quiet, and once.** A basket four hours old is somebody still shopping; a
 * banner then is nagging. After `ABANDON_AFTER_HOURS` it is a basket they
 * forgot, and after `STALE_AFTER_DAYS` it is a basket whose prices have moved
 * enough that "you left these" is a worse message than silence.
 */

/** Below this, they are still shopping and a reminder is nagging. */
export const ABANDON_AFTER_HOURS = 6;

/**
 * Past this, saying "you left these" is worse than saying nothing.
 *
 * A cart stores no prices, so a three-week-old basket is re-priced when it is
 * read — the shopper would be reminded of a basket that costs something else
 * now, which reads as a shop that changed the price while they were away.
 */
export const STALE_AFTER_DAYS = 14;

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (60 * 60 * 1000);
}

export type CartAge = { updatedAt: Date | string | null; itemCount: number };

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Is this a basket somebody forgot?
 *
 * Empty is not forgotten, it is empty. An unreadable date is not forgotten
 * either — a gap in our own row should not produce a nudge about a basket we
 * cannot describe.
 */
export function isAbandoned(cart: CartAge, now: Date = new Date()): boolean {
  if (cart.itemCount <= 0) return false;
  const at = asDate(cart.updatedAt);
  if (!at) return false;
  const hours = hoursBetween(at, now);
  return hours >= ABANDON_AFTER_HOURS && hours <= STALE_AFTER_DAYS * 24;
}

/** How long ago, in whole hours, for the line that says so. */
export function hoursSince(cart: CartAge, now: Date = new Date()): number | null {
  const at = asDate(cart.updatedAt);
  if (!at) return null;
  return Math.max(0, Math.floor(hoursBetween(at, now)));
}

/**
 * What to tell them, or nothing at all.
 *
 * A count and an age, not a price: the basket is re-priced on every read, and
 * a reminder quoting a total that has since moved is a shop arguing with its
 * own page. The count is the part that does not go stale.
 */
export type Recovery = { remind: true; itemCount: number; hours: number } | { remind: false };

export function recoveryFor(cart: CartAge, now: Date = new Date()): Recovery {
  if (!isAbandoned(cart, now)) return { remind: false };
  const hours = hoursSince(cart, now);
  return hours === null ? { remind: false } : { remind: true, itemCount: cart.itemCount, hours };
}
