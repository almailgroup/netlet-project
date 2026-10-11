/**
 * Throttling for the two doors worth attacking, counted in the database.
 *
 * The Express limiters in `_core/security.ts` are still there and still
 * useful — they blunt floods before a request reaches application code — but
 * they count in this process's memory, which on a platform that answers from a
 * pool of short-lived instances means every instance keeps its own tally and
 * none of them lasts. Anything that has to actually hold, holds here.
 *
 * It lives outside `db.ts` for the reason `profile.ts` does: functions inside
 * `db.ts` call its module-local `getDb`, which nothing outside can redirect,
 * so they cannot be tested against a real database.
 */
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { authAttempts } from "../drizzle/schema.js";
import {
  ALLOWED,
  ATTEMPT_WINDOW_MS,
  LOOKUP_WINDOW_MS,
  MAX_FAILURES_PER_ACCOUNT,
  MAX_FAILURES_PER_ADDRESS,
  MAX_ASSISTANT_PER_ADDRESS,
  ASSISTANT_WINDOW_MS,
  MAX_PHOTO_SEARCH_PER_ADDRESS,
  MAX_RECOMMEND_MODEL_PER_ACCOUNT,
  MAX_SEARCH_REFINE_PER_ADDRESS,
  RECOMMEND_MODEL_WINDOW_MS,
  SEARCH_REFINE_WINDOW_MS,
  MAX_VOUCHER_MISSES_PER_ADDRESS,
  VOUCHER_MISS_WINDOW_MS,
  PHOTO_SEARCH_WINDOW_MS,
  MAX_OFFER_REQUESTS_PER_ACCOUNT,
  OFFER_REQUEST_WINDOW_MS,
  MAX_MESSAGES_PER_ACCOUNT,
  MESSAGE_WINDOW_MS,
  MAX_LOOKUPS_PER_ADDRESS,
  MAX_IMPORTS_PER_ACCOUNT,
  IMPORT_WINDOW_MS,
  limitVerdict,
  strictest,
  type RateVerdict,
} from "../shared/auth/rateLimit.js";
import { getDb } from "./db.js";

export type AttemptKind = "login" | "reset" | "giftLookup" | "assistant" | "offerRequest" | "chatMessage" | "imageImport" | "searchRefine" | "recommendModel" | "voucherMiss" | "photoSearch";

/**
 * Who is asking, as the two keys the policy checks.
 *
 * Both are optional because either can be missing — a malformed request with
 * no address, a reset with no address typed — and a missing key is simply not
 * counted rather than collapsed into a shared "unknown" bucket, which would
 * throttle unrelated callers against each other.
 */
export type Caller = { email?: string | null; address?: string | null };

const accountBucket = (email: string) => `account:${email.trim().toLowerCase()}`;
const addressBucket = (address: string) => `address:${address.trim()}`;

/**
 * Sign-in and reset rows older than their window can never affect a verdict
 * again. Only those two kinds: the table also holds every hourly and daily
 * ceiling, and pruning them at fifteen minutes — which this did, on every
 * failed sign-in — quietly turned a sixty-an-hour limit into sixty a quarter
 * of an hour and a twelve-a-day one into twelve a quarter of an hour. Each of
 * those kinds prunes its own, at its own window, when it records.
 */
async function prune(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  await db.delete(authAttempts).where(
    and(inArray(authAttempts.kind, ["login", "reset"]), lt(authAttempts.createdAt, new Date(Date.now() - ATTEMPT_WINDOW_MS))),
  );
}

async function failuresIn(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bucket: string,
  kind: AttemptKind,
): Promise<Date[]> {
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, bucket),
        eq(authAttempts.kind, kind),
        gt(authAttempts.createdAt, new Date(Date.now() - ATTEMPT_WINDOW_MS)),
      ),
    );
  return rows.map(row => row.at);
}

/**
 * May this caller try again?
 *
 * With no database configured the answer is yes. A storefront that refuses
 * every sign-in because its limiter cannot reach Postgres has turned a
 * throttle into an outage, and the Express limiter still stands in front.
 */
export async function checkAuthAllowed(caller: Caller, kind: AttemptKind): Promise<RateVerdict> {
  const db = await getDb();
  if (!db) return ALLOWED;

  const [account, address] = await Promise.all([
    caller.email ? failuresIn(db, accountBucket(caller.email), kind) : Promise.resolve([]),
    caller.address ? failuresIn(db, addressBucket(caller.address), kind) : Promise.resolve([]),
  ]);

  return strictest(
    caller.email ? limitVerdict(account, MAX_FAILURES_PER_ACCOUNT) : ALLOWED,
    caller.address ? limitVerdict(address, MAX_FAILURES_PER_ADDRESS) : ALLOWED,
  );
}

/** Record one attempt against both of the caller's keys. */
export async function recordAuthAttempt(caller: Caller, kind: AttemptKind): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = [
    ...(caller.email ? [{ bucket: accountBucket(caller.email), kind }] : []),
    ...(caller.address ? [{ bucket: addressBucket(caller.address), kind }] : []),
  ];
  if (rows.length === 0) return;

  await db.insert(authAttempts).values(rows);
  // Cheap enough to do inline and rare enough not to matter: only a failed
  // attempt reaches here, so this is not on the path a shopper signs in on.
  await prune(db);
}

/**
 * Forget an account's failures after it signs in successfully.
 *
 * Somebody who mistyped their password nine times and then got it right is not
 * one failure away from a lockout for the next quarter of an hour. The address
 * bucket is deliberately *not* cleared: one successful sign-in should not
 * launder the failures a host accumulated against everybody else's accounts.
 */
export async function clearAccountFailures(email: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  /* Sign-in failures only. The same bucket holds the account's message, price-request
     and import counts, and clearing those on sign-in let anybody reset a ceiling by
     signing in again. */
  await db.delete(authAttempts).where(and(eq(authAttempts.bucket, accountBucket(email)), eq(authAttempts.kind, "login")));
}

/**
 * May this address look up another gift list?
 *
 * Its own function rather than a third branch of `checkAuthAllowed`, because
 * the two differ in the way that matters: this counts every request rather
 * than every failure, and it counts over an hour rather than a quarter of one.
 * Folding them together would mean a shared helper taking a window and a
 * ceiling and a should-I-count-successes flag, which is three parameters
 * standing in for the one sentence each door actually needs.
 *
 * There is no account key. The caller is usually signed out — that is the
 * whole point of the feature — so the address is all there is, and the owner
 * of the list being looked up is deliberately not a bucket: throttling by the
 * *target* would let anybody lock a stranger's gift list by hammering it.
 */
export async function checkLookupAllowed(address: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !address) return ALLOWED;

  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, addressBucket(address)),
        eq(authAttempts.kind, "giftLookup"),
        gt(authAttempts.createdAt, new Date(Date.now() - LOOKUP_WINDOW_MS)),
      ),
    );

  return limitVerdict(rows.map(row => row.at), MAX_LOOKUPS_PER_ADDRESS, new Date(), LOOKUP_WINDOW_MS);
}

/** Count one lookup, whatever it found. See `MAX_LOOKUPS_PER_ADDRESS`. */
export async function recordLookup(address: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !address) return;
  await db.insert(authAttempts).values([{ bucket: addressBucket(address), kind: "giftLookup" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "giftLookup"), lt(authAttempts.createdAt, new Date(Date.now() - LOOKUP_WINDOW_MS))),
  );
}

/** How many attempts a bucket currently carries. Exposed for tests. */
export async function attemptCount(bucket: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(eq(authAttempts.bucket, bucket));
  return row?.n ?? 0;
}

/**
 * Whether this address may ask the assistant another question.
 *
 * Address only, like the gift lookup and for a related reason: the caller is
 * usually signed out, because somebody deciding whether to buy has not
 * necessarily got an account. The product being asked about is deliberately
 * *not* a bucket — throttling by the product would let one script make a
 * popular item unaskable for everybody else.
 */
export async function checkAssistantAllowed(address: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !address) return ALLOWED;

  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, addressBucket(address)),
        eq(authAttempts.kind, "assistant"),
        gt(authAttempts.createdAt, new Date(Date.now() - ASSISTANT_WINDOW_MS)),
      ),
    );

  return limitVerdict(rows.map(row => row.at), MAX_ASSISTANT_PER_ADDRESS, new Date(), ASSISTANT_WINDOW_MS);
}

/** Count one question, answered or not — a refusal costs the same money. */
export async function recordAssistantCall(address: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !address) return;
  await db.insert(authAttempts).values([{ bucket: addressBucket(address), kind: "assistant" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "assistant"), lt(authAttempts.createdAt, new Date(Date.now() - ASSISTANT_WINDOW_MS))),
  );
}

/** Whether this address may search with another photo (3.1.6). Address only, for the assistant's reason. */
export async function checkPhotoSearchAllowed(address: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !address) return ALLOWED;
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(and(
      eq(authAttempts.bucket, addressBucket(address)),
      eq(authAttempts.kind, "photoSearch"),
      gt(authAttempts.createdAt, new Date(Date.now() - PHOTO_SEARCH_WINDOW_MS)),
    ));
  return limitVerdict(rows.map(row => row.at), MAX_PHOTO_SEARCH_PER_ADDRESS, new Date(), PHOTO_SEARCH_WINDOW_MS);
}

/** Count one photo search, read or not — the call cost the same either way. */
export async function recordPhotoSearch(address: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !address) return;
  await db.insert(authAttempts).values([{ bucket: addressBucket(address), kind: "photoSearch" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "photoSearch"), lt(authAttempts.createdAt, new Date(Date.now() - PHOTO_SEARCH_WINDOW_MS))),
  );
}

/** Whether this address may ask the model to refine another search. Every request counts. */
export async function checkSearchRefineAllowed(address: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !address) return ALLOWED;
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(and(
      eq(authAttempts.bucket, addressBucket(address)),
      eq(authAttempts.kind, "searchRefine"),
      gt(authAttempts.createdAt, new Date(Date.now() - SEARCH_REFINE_WINDOW_MS)),
    ));
  return limitVerdict(rows.map(row => row.at), MAX_SEARCH_REFINE_PER_ADDRESS, new Date(), SEARCH_REFINE_WINDOW_MS);
}

/** Count one refinement, answered or not — the call cost the same either way. */
export async function recordSearchRefine(address: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !address) return;
  await db.insert(authAttempts).values([{ bucket: addressBucket(address), kind: "searchRefine" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "searchRefine"), lt(authAttempts.createdAt, new Date(Date.now() - SEARCH_REFINE_WINDOW_MS))),
  );
}

/** Whether this address may have another code quoted. Only misses count. */
export async function checkVoucherAllowed(address: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !address) return ALLOWED;
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(and(
      eq(authAttempts.bucket, addressBucket(address)),
      eq(authAttempts.kind, "voucherMiss"),
      gt(authAttempts.createdAt, new Date(Date.now() - VOUCHER_MISS_WINDOW_MS)),
    ));
  return limitVerdict(rows.map(row => row.at), MAX_VOUCHER_MISSES_PER_ADDRESS, new Date(), VOUCHER_MISS_WINDOW_MS);
}

/** Count a code that named nothing. */
export async function recordVoucherMiss(address: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !address) return;
  await db.insert(authAttempts).values([{ bucket: addressBucket(address), kind: "voucherMiss" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "voucherMiss"), lt(authAttempts.createdAt, new Date(Date.now() - VOUCHER_MISS_WINDOW_MS))),
  );
}

/**
 * Whether the model may reorder this account's rail once more, counting the
 * call if so. One function rather than a check and a record, because the rail
 * is a read: there is no later moment to record it at.
 */
export async function takeRecommendModelCall(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const bucket = `user:${userId}`;
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(and(
      eq(authAttempts.bucket, bucket),
      eq(authAttempts.kind, "recommendModel"),
      gt(authAttempts.createdAt, new Date(Date.now() - RECOMMEND_MODEL_WINDOW_MS)),
    ));
  if ((counted?.n ?? 0) >= MAX_RECOMMEND_MODEL_PER_ACCOUNT) return false;
  await db.insert(authAttempts).values([{ bucket, kind: "recommendModel" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "recommendModel"), lt(authAttempts.createdAt, new Date(Date.now() - RECOMMEND_MODEL_WINDOW_MS))),
  );
  return true;
}

/**
 * May this shopper send another special-price request?
 *
 * Account, not address — the one ceiling here keyed that way, because asking
 * needs signing in and what is being protected is a seller's attention rather
 * than NetLet's bill. Throttling a household's shared address would have four
 * people locking each other out of asking for four different things.
 */
export async function checkOfferRequestAllowed(email: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !email) return ALLOWED;

  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, accountBucket(email)),
        eq(authAttempts.kind, "offerRequest"),
        gt(authAttempts.createdAt, new Date(Date.now() - OFFER_REQUEST_WINDOW_MS)),
      ),
    );

  return limitVerdict(rows.map(row => row.at), MAX_OFFER_REQUESTS_PER_ACCOUNT, new Date(), OFFER_REQUEST_WINDOW_MS);
}

/** Count one request. A seller reads it whether they accept it or not. */
export async function recordOfferRequest(email: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !email) return;
  await db.insert(authAttempts).values([{ bucket: accountBucket(email), kind: "offerRequest" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "offerRequest"), lt(authAttempts.createdAt, new Date(Date.now() - OFFER_REQUEST_WINDOW_MS))),
  );
}

/**
 * May this shopper send a seller another message? Counted per account over an
 * hour — `MAX_MESSAGES_PER_ACCOUNT` says why.
 */
export async function checkMessageAllowed(email: string | null | undefined): Promise<RateVerdict> {
  const db = await getDb();
  if (!db || !email) return ALLOWED;
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, accountBucket(email)),
        eq(authAttempts.kind, "chatMessage"),
        gt(authAttempts.createdAt, new Date(Date.now() - MESSAGE_WINDOW_MS)),
      ),
    );
  return limitVerdict(rows.map(row => row.at), MAX_MESSAGES_PER_ACCOUNT, new Date(), MESSAGE_WINDOW_MS);
}

/** Count one message sent. */
export async function recordMessage(email: string | null | undefined): Promise<void> {
  const db = await getDb();
  if (!db || !email) return;
  await db.insert(authAttempts).values([{ bucket: accountBucket(email), kind: "chatMessage" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "chatMessage"), lt(authAttempts.createdAt, new Date(Date.now() - MESSAGE_WINDOW_MS))),
  );
}

/**
 * May this account ask NetLet to fetch another outside page or image? Counted
 * per account over an hour — `MAX_IMPORTS_PER_ACCOUNT` says why. Keyed on the
 * account's id rather than its email, because an account without an email
 * would otherwise not be counted at all.
 */
const userBucket = (userId: number) => `user:${userId}`;

export async function checkImportAllowed(userId: number): Promise<RateVerdict> {
  const db = await getDb();
  if (!db) return ALLOWED;
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, userBucket(userId)),
        eq(authAttempts.kind, "imageImport"),
        gt(authAttempts.createdAt, new Date(Date.now() - IMPORT_WINDOW_MS)),
      ),
    );
  return limitVerdict(rows.map(row => row.at), MAX_IMPORTS_PER_ACCOUNT, new Date(), IMPORT_WINDOW_MS);
}

/** Count one outside fetch. */
export async function recordImport(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(authAttempts).values([{ bucket: userBucket(userId), kind: "imageImport" }]);
  await db.delete(authAttempts).where(
    and(eq(authAttempts.kind, "imageImport"), lt(authAttempts.createdAt, new Date(Date.now() - IMPORT_WINDOW_MS))),
  );
}
