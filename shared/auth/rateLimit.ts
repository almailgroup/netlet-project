/**
 * How many failed sign-ins are too many, and for how long.
 *
 * Pure, so the thresholds can be argued with in a test rather than discovered
 * in production. The counting and the storing are `server/rateLimit.ts`; this
 * decides only what a set of timestamps means.
 *
 * **Two keys, not one.** Throttling by address alone is what a shared office
 * connection, a university or a phone carrier's NAT all look like from the
 * server, and one of those hitting the ceiling locks out everybody behind it.
 * Throttling by account alone does nothing about one host spraying a common
 * password across a thousand different addresses. Each key answers the attack
 * the other cannot see, so both are checked and the stricter one wins.
 *
 * **Only failures are counted.** A busy office where everybody signs in
 * successfully never approaches either ceiling — which is what makes an
 * address ceiling safe to have at all.
 */

/** How far back a failure still counts against you. */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Failures against one account before it stops answering.
 *
 * Ten is enough to be a person who genuinely cannot remember which password
 * they used, and far too few to search a password space.
 */
export const MAX_FAILURES_PER_ACCOUNT = 10;

/**
 * Failures from one address, across every account, before it stops answering.
 *
 * Deliberately much higher than the per-account ceiling: this is the number
 * that a real shared connection could plausibly produce, and the per-account
 * limit is what actually protects any individual login.
 */
export const MAX_FAILURES_PER_ADDRESS = 30;

/**
 * Lookups of a gift list by phone number, from one address, before it stops
 * answering.
 *
 * A different door from the other two and counted differently: **every**
 * lookup counts, not only the ones that find nothing. There is no such thing
 * as a failed lookup here — the reply is identical whether the number belongs
 * to nobody or to somebody who publishes nothing, deliberately, so that the
 * lookup cannot be used to ask which phone numbers shop at NetLet. With no
 * failure to count, the only honest thing to count is the request.
 *
 * Sixty an hour is far more than a family opening a list a few times and far
 * too few to walk an eight-digit number space: at this rate a single address
 * needs two thousand years to try them all. The window is an hour rather than
 * the sign-in fifteen minutes, because enumeration is patient in a way that
 * password guessing is not.
 */
export const MAX_LOOKUPS_PER_ADDRESS = 60;
export const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * How many product questions one address may ask the model in an hour.
 *
 * A ceiling here is not about abuse of a shopper's account — the assistant is
 * open to a signed-out browser, deliberately, because that is who is deciding
 * whether to buy. It is about cost: every call spends money at a third party,
 * so an unthrottled endpoint is somebody else's bill waiting to be run up by a
 * loop. Thirty is more than a shopper comparing four products will ever reach
 * and far too few to be worth scripting.
 *
 * Every request counts, not every failure, for the reason the gift lookup
 * counts every request: a refusal costs the same money as an answer.
 */
export const MAX_ASSISTANT_PER_ADDRESS = 30;
export const ASSISTANT_WINDOW_MS = 60 * 60 * 1000;

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export const ALLOWED: RateVerdict = { allowed: true };

/**
 * Whether another attempt is allowed, and when to come back if not.
 *
 * `retryAfterSeconds` is measured from the *oldest failure still inside the
 * window*, because that is the one that will age out first and put the count
 * back under the ceiling. Measuring from the newest would tell somebody to
 * wait the full window after every attempt, which never expires — a lockout
 * that a person cannot get out of by waiting is a support ticket.
 */
export function limitVerdict(
  failures: Date[],
  max: number,
  now: Date = new Date(),
  windowMs: number = ATTEMPT_WINDOW_MS,
): RateVerdict {
  const cutoff = now.getTime() - windowMs;
  const inWindow = failures
    .map(at => at.getTime())
    .filter(at => at > cutoff)
    .sort((a, b) => a - b);

  if (inWindow.length < max) return ALLOWED;

  // The (max)th most recent failure is the one whose expiry drops the count
  // below the ceiling; anything older than it has already stopped counting.
  const decisive = inWindow[inWindow.length - max];
  const msUntilFree = decisive + windowMs - now.getTime();
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(msUntilFree / 1000)) };
}

/** The stricter of two verdicts — the one that says no, or says wait longer. */
export function strictest(a: RateVerdict, b: RateVerdict): RateVerdict {
  if (a.allowed) return b;
  if (b.allowed) return a;
  return a.retryAfterSeconds >= b.retryAfterSeconds ? a : b;
}
