/**
 * Deleting your own account, on the owner's word ("account security … for
 * changing the password and deleting your account").
 *
 * **It is a real delete of the account row, and the schema already says what
 * goes with it.** Every table pointing at `users` names its delete rule: what
 * is the shopper's alone cascades — the addresses, the profile's details, the
 * saved hearts and the wishlists, the bag, the points, the reviews, the
 * standing orders, the notices, the conversations with NetLet — and what is a
 * record of business is set to null and kept: an order and its invoices keep
 * every fact they froze at the sale and simply stop pointing at an account,
 * because a shop keeps its invoices. Signing in again finds no account, and a
 * session on another device finds no row (`authenticateRequest`), so it is
 * signed out there too. The password store goes first — Supabase's user, or
 * the local digest with the row — so the address can be registered afresh.
 *
 * **What refuses it is what the row is still holding up**, said back as
 * reasons the page can name (`DeletionBlocker`):
 * - an administrator — NetLet's own staff are removed by another
 *   administrator, never by a press that could leave the shop with none;
 * - a member of a store or a delivery company, or an employee with a grant —
 *   removing the row would take them off a team behind its owner's back;
 * - an order still on its way — a line not yet delivered, cancelled or
 *   returned, on an order not cancelled or refunded: somebody is still
 *   driving it to the door, and the shopper should be able to follow it;
 * - a return still open — money or goods are still moving;
 * - a cash-out of points NetLet has not paid yet — the row is the record of
 *   money owed, and it would go with the account.
 *
 * Checked when the page asks and again under a lock on the account's row as
 * it is deleted, so an order placed between the two is not deleted under.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  courierMembers,
  orderItems,
  orders,
  pointEntries,
  returnRequests,
  staffGrants,
  users,
  vendorMembers,
  type User,
} from "../../database/schema.js";
import { OPEN_RETURN_STATUSES } from "../../../Shared/commerce/returnRequests.js";
import { deleteSupabaseUser } from "../core/supabaseAuth.js";
import { storeFor } from "../core/passwordStore.js";
import { getDb } from "./db.js";
import { balanceFor } from "./referral.js";

export const DELETION_BLOCKERS = ["admin", "team", "orderOpen", "returnOpen", "cashOutOwed"] as const;
export type DeletionBlocker = (typeof DELETION_BLOCKERS)[number];

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** The database or a transaction on it: both answer `select`. */
type Reader = Pick<Db, "select">;

/** A line still coming: not yet at the door, not called off. */
const STILL_COMING = ["pending", "preparing", "shipped"] as const;
/** An order whose lines can still come. */
const ORDER_LIVE = ["pending_payment", "paid"] as const;

async function blockersFor(db: Reader, user: Pick<User, "id" | "role">): Promise<DeletionBlocker[]> {
  const found: DeletionBlocker[] = [];
  if (user.role === "admin") found.push("admin");

  const exists = async (query: Promise<unknown[]>) => (await query).length > 0;
  const [vendor, courier, grant, order, ret, cashOut] = await Promise.all([
    exists(db.select({ id: vendorMembers.userId }).from(vendorMembers).where(eq(vendorMembers.userId, user.id)).limit(1)),
    exists(db.select({ id: courierMembers.userId }).from(courierMembers).where(eq(courierMembers.userId, user.id)).limit(1)),
    exists(db.select({ id: staffGrants.userId }).from(staffGrants).where(eq(staffGrants.userId, user.id)).limit(1)),
    exists(
      db.select({ id: orderItems.id })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(
          eq(orders.userId, user.id),
          inArray(orders.status, [...ORDER_LIVE]),
          inArray(orderItems.fulfilment, [...STILL_COMING]),
        ))
        .limit(1),
    ),
    exists(
      db.select({ id: returnRequests.id })
        .from(returnRequests)
        .where(and(eq(returnRequests.userId, user.id), inArray(returnRequests.status, [...OPEN_RETURN_STATUSES])))
        .limit(1),
    ),
    exists(
      db.select({ id: pointEntries.id })
        .from(pointEntries)
        .where(and(eq(pointEntries.userId, user.id), eq(pointEntries.reason, "cashed_out"), isNull(pointEntries.settledAt)))
        .limit(1),
    ),
  ]);
  if (vendor || courier || grant) found.push("team");
  if (order) found.push("orderOpen");
  if (ret) found.push("returnOpen");
  if (cashOut) found.push("cashOutOwed");
  return found;
}

export type DeletionCheck = {
  /** What stands in the way, in the order the page names them; empty when nothing does. */
  blockers: DeletionBlocker[];
  /** The points that go with the account, said before the press. */
  points: number;
};

/** What the page shows before anybody presses Delete. */
export async function deletionCheck(user: Pick<User, "id" | "role">): Promise<DeletionCheck> {
  const db = await getDb();
  if (!db) return { blockers: [], points: 0 };
  const [blockers, points] = await Promise.all([
    blockersFor(db, user),
    balanceFor(db, user.id).catch(() => 0),
  ]);
  return { blockers, points: Math.max(0, points) };
}

export type DeletionOutcome = { deleted: true } | { deleted: false; blockers: DeletionBlocker[] };

/**
 * Deletes the account. The caller has already asked for its password again.
 *
 * One transaction: the account's row locked, the reasons asked again under
 * the lock, the password store removed, the row deleted. Supabase's user is
 * removed inside it, so a service that refuses leaves the account whole
 * rather than a row nobody can sign in to; a row deleted after Supabase's
 * user went cannot happen the other way round, since the delete is last.
 */
export async function deleteAccount(user: User): Promise<DeletionOutcome> {
  const db = await getDb();
  if (!db) return { deleted: false, blockers: [] };
  return db.transaction(async tx => {
    await tx.execute(sql`select ${users.id} from ${users} where ${users.id} = ${user.id} for update`);
    const blockers = await blockersFor(tx, user);
    if (blockers.length > 0) return { deleted: false, blockers } as const;
    if (storeFor(user) === "supabase") await deleteSupabaseUser(user.supabaseUid!);
    /* The photos on the shopper's reviews are theirs and go with them: the
       reviews cascade away, and a file nothing shows should not go on being
       served. Asked of the table only where the bootstrap has made it. */
    const [photosTable] = await tx
      .select({ present: sql<boolean>`to_regclass('public.review_photos') is not null` })
      .from(users)
      .where(eq(users.id, user.id));
    if (photosTable?.present) {
      await tx.execute(sql`delete from media_files where uploaded_by = ${user.id} and id in (
        select rp.media_id from review_photos rp join reviews r on r.id = rp.review_id where r.user_id = ${user.id})`);
    }
    await tx.delete(users).where(eq(users.id, user.id));
    return { deleted: true } as const;
  });
}
