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
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { authAttempts } from "../drizzle/schema.js";
import {
  ALLOWED,
  ATTEMPT_WINDOW_MS,
  MAX_FAILURES_PER_ACCOUNT,
  MAX_FAILURES_PER_ADDRESS,
  limitVerdict,
  strictest,
  type RateVerdict,
} from "../shared/auth/rateLimit.js";
import { getDb } from "./db.js";

export type AttemptKind = "login" | "reset";

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

/** Rows older than the window can never affect a verdict again. */
async function prune(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  await db.delete(authAttempts).where(lt(authAttempts.createdAt, new Date(Date.now() - ATTEMPT_WINDOW_MS)));
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
  await db.delete(authAttempts).where(eq(authAttempts.bucket, accountBucket(email)));
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
