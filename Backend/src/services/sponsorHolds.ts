/**
 * The places open sponsorship requests hold on the home shelf (migration
 * 0089), apart from `sponsorRequests.ts` so `adBookings.ts` can count them
 * without the two modules importing each other.
 *
 * **Closed, not broken, until 0089 is pasted.** Whether the table is there is
 * asked once and kept once it is (a table that has appeared does not go
 * away), and asked again a minute later while it is not, so the code can
 * deploy before the paste and every placement read goes on exactly as before.
 * It is asked of whichever handle the caller holds — inside a transaction,
 * that transaction's own connection, for the reason `warrantyLengths.ts`
 * gives: five transactions each waiting on a sixth connection never end.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { sponsorRequests } from "../../database/schema.js";
import type { BookingFacts } from "../../../Shared/commerce/adBookings.js";
import { isOpen } from "../../../Shared/commerce/sponsorRequests.js";
import type { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let present = false;
let checkedAt = 0;
const ASK_AGAIN_MS = 60_000;

/** Whether `sponsor_requests` exists. */
export async function sponsorReady(db: Db | Tx): Promise<boolean> {
  if (present) return true;
  if (Date.now() - checkedAt < ASK_AGAIN_MS && checkedAt !== 0) return false;
  const result = await db.execute<{ ready: boolean }>(sql`select to_regclass('public.sponsor_requests') is not null as ready`);
  const rows = Array.isArray(result) ? result : (result as { rows: { ready: boolean }[] }).rows;
  present = Boolean(rows[0]?.ready);
  checkedAt = Date.now();
  return present;
}

/** For tests that rename the table away and back. */
export function forgetSponsorReadiness(): void {
  present = false;
  checkedAt = 0;
}

/**
 * Open requests whose days overlap `[from, to]`, as the facts a place is
 * counted by — a request NetLet has not answered in time, or a payment not
 * made by its last day, has lapsed and holds nothing. `except` leaves one
 * request out, for the request being paid for itself.
 */
export async function openSponsorHolds(db: Db | Tx, from: string, to: string, today: string, except?: number): Promise<BookingFacts[]> {
  if (!(await sponsorReady(db))) return [];
  const rows = await db
    .select({ id: sponsorRequests.id, status: sponsorRequests.status, startsOn: sponsorRequests.startsOn, endsOn: sponsorRequests.endsOn, payBy: sponsorRequests.payBy, dailyRate: sponsorRequests.dailyRate })
    .from(sponsorRequests)
    .where(and(
      inArray(sponsorRequests.status, ["review", "payment", "sent"]),
      lte(sponsorRequests.startsOn, to),
      gte(sponsorRequests.endsOn, from),
    ));
  return rows
    .filter(row => row.id !== except && isOpen(row, today))
    .map(row => ({ startsOn: row.startsOn, endsOn: row.endsOn, dailyRate: row.dailyRate, cancelledOn: null }));
}

/**
 * Open requests for one product, for deleting and moving it: a request a store
 * is waiting on, or money on its way, is the store's to withdraw or NetLet's to
 * answer first, as a booked placement is.
 */
export async function openSponsorsFor(db: Db | Tx, productId: number, today: string): Promise<number> {
  if (!(await sponsorReady(db))) return 0;
  const rows = await db
    .select({ status: sponsorRequests.status, startsOn: sponsorRequests.startsOn, endsOn: sponsorRequests.endsOn, payBy: sponsorRequests.payBy })
    .from(sponsorRequests)
    .where(and(eq(sponsorRequests.productId, productId), inArray(sponsorRequests.status, ["review", "payment", "sent"])));
  return rows.filter(row => isOpen(row, today)).length;
}
