/**
 * How many failed sign-ins are too many, and for how long.
 *
 * Pure, so the thresholds can be argued with in a test rather than discovered
 * in production. The counting and the storing are `Backend/src/services/rateLimit.ts`; this
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
 * Searching with a photo (3.1.6): a vision call costs more than a question, so
 * the ceiling is lower, and it counts every request — a photo the model
 * could not read cost the same as one it could.
 */
export const MAX_PHOTO_SEARCH_PER_ADDRESS = 20;
export const PHOTO_SEARCH_WINDOW_MS = 60 * 60 * 1000;

/**
 * "Refine with NetLet AI" on the search results: a short text call, cheaper
 * than a question to the assistant, so the ceiling is higher — and counted per
 * request for the same reason. It was the one model call open to a signed-out
 * browser with no ceiling at all.
 */
export const MAX_SEARCH_REFINE_PER_ADDRESS = 60;
export const SEARCH_REFINE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Reading the address a pin is on: one request each time the map comes to
 * rest, which somebody finding their roof does a few dozen times, and each
 * goes to OpenStreetMap's free service, whose terms ask for light use. Every
 * request counts, found or not.
 */
export const MAX_PLACE_LOOKUPS_PER_ADDRESS = 120;
export const PLACE_LOOKUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Codes typed into checkout's box that turned out to be nobody's. A discount
 * code is a word somebody chose — "TENOFF", "STAFF50" — and the quote answered
 * any number of guesses a second from a signed-out browser, so a code meant for
 * one list of people was a dictionary away from everybody. Only misses count,
 * the sign-in rule: a shopper typing the code they were given never comes
 * near it, and somebody who mistypes one twenty times in an hour is not
 * somebody this is for.
 */
export const MAX_VOUCHER_MISSES_PER_ADDRESS = 20;
export const VOUCHER_MISS_WINDOW_MS = 60 * 60 * 1000;

/**
 * Looking an order up on the help page by its number and email, signed out.
 * Only misses count, the sign-in rule: a shopper typing their own pair never
 * comes near it, and the ceiling is what stops somebody walking reference
 * tails against an address they know. Past it every pair is refused alike,
 * the right one included, or the throttle would say which guess was right.
 */
export const MAX_ORDER_LOOKUP_MISSES_PER_ADDRESS = 10;
export const ORDER_LOOKUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * How often one account's "Picked for you" rail may be reordered by the model.
 * The rail is read on every visit to the saved page, so it is drawn far more
 * often than it changes; past the ceiling it is the ranking it already had,
 * which the rail falls back to on any model failure anyway.
 */
export const MAX_RECOMMEND_MODEL_PER_ACCOUNT = 30;
export const RECOMMEND_MODEL_WINDOW_MS = 60 * 60 * 1000;

/**
 * How many special-price requests one account may send in a day.
 *
 * Keyed on the **account** rather than the address, which is the opposite of
 * every other ceiling here and follows from what is being protected: asking
 * for a discount needs signing in, so there is a real identity to count, and
 * what runs out is a seller's patience rather than NetLet's money. An address
 * key would let one household's four shoppers lock each other out; an account
 * key lets each of them ask for what they want and stops one person papering
 * a shop with twenty requests an hour.
 *
 * Every request counts, not every refusal — a request a seller has to read and
 * decline costs them exactly as much as one they accept, which is the same
 * argument the gift lookup makes about a reply that is identical either way.
 */
export const MAX_OFFER_REQUESTS_PER_ACCOUNT = 12;
export const OFFER_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How many outside fetches one account may ask NetLet to make in an hour
 * (3.1.10): a manufacturer's page, and each of its images previewed or used.
 *
 * Per account, because importing needs a store manager's sign-in, and counted
 * on every request rather than every failure, because the cost — NetLet's
 * server going out to somebody else's — is spent either way. One page and its
 * eight previews is nine; this is a dozen or so products an hour, which is a
 * seller listing by hand and not a crawler.
 */
export const MAX_IMPORTS_PER_ACCOUNT = 150;
export const IMPORT_WINDOW_MS = 60 * 60 * 1000;

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
