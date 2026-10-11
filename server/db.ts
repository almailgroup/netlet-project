import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  customerNotificationPreferences,
  followedProducts,
  orderTrackingEvents,
  savedProducts,
  users,
  type User,
} from "../drizzle/schema.js";

/*
 * `createUser`, `linkExternalUser` and `deleteUserRow` are in
 * `server/logins.ts`, not here, and are deliberately *not* re-exported from
 * this file.
 *
 * They had to move, because a function declared inside this file calls its
 * module-local `getDb`, which nothing outside can redirect — the same reason
 * `profile.ts`, `orders.ts` and `inventory.ts` are their own files.
 * `linkExternalUser` is what keeps an account from ending up with two password
 * stores, which is not a rule to leave untested.
 *
 * Re-exporting them from here would have saved touching two imports and cost a
 * cycle: `db.ts` → `logins.ts` → `db.ts`. A test that redirects `getDb` then
 * hands the mock to one half and the real module to the other, and the writes
 * run against no database at all. Import them from `logins.js`.
 */

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Lazily create the drizzle instance, so tests and local tooling run without a
 * database and every query path degrades to a no-op instead of throwing.
 *
 * `prepare: false` is required if DATABASE_URL points at a transaction-mode
 * pooler (Supabase's port 6543), which cannot carry prepared statements across
 * pooled connections. It costs little on a direct connection, so it is set
 * unconditionally rather than left as a trap for whoever swaps the URL.
 */
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(postgres(process.env.DATABASE_URL, { prepare: false }));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Postgres unique-violation, SQLSTATE 23505.
 *
 * Drizzle wraps driver errors in a DrizzleQueryError, so the SQLSTATE is on the
 * `cause`, not the error itself — checking the top level alone silently never
 * matches, and a duplicate registration surfaces as a 500 instead of a clean
 * "already registered". The chain is walked because the depth is drizzle's
 * implementation detail, not a contract.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && (current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function touchLastSignedIn(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

export async function listSavedProductIds(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ productId: savedProducts.productId }).from(savedProducts).where(eq(savedProducts.userId, userId));
  return rows.map(row => row.productId);
}

export async function setSavedProduct(userId: number, productId: string, saved: boolean) {
  const db = await getDb();
  if (!db) return [];
  if (saved) {
    // Already saved is success, not a conflict to resolve.
    await db
      .insert(savedProducts)
      .values({ userId, productId })
      .onConflictDoNothing({ target: [savedProducts.userId, savedProducts.productId] });
  } else {
    await db.delete(savedProducts).where(and(eq(savedProducts.userId, userId), eq(savedProducts.productId, productId)));
  }
  return listSavedProductIds(userId);
}

/** Everything this shopper asked to be told about. */
export async function listFollowedProducts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(followedProducts).where(eq(followedProducts.userId, userId));
}

/**
 * Starts or stops watching a product.
 *
 * Turning both alerts off is the same as not following it, so the row is
 * removed rather than left behind as a follow that notifies nothing — which
 * would also inflate the demand count the vendor sees.
 */
export async function setFollowedProduct(
  userId: number,
  productId: string,
  patch: { priceDrop?: boolean; backInStock?: boolean },
) {
  const db = await getDb();
  if (!db) return [];

  const existing = (await db
    .select()
    .from(followedProducts)
    .where(and(eq(followedProducts.userId, userId), eq(followedProducts.productId, productId)))
    .limit(1))[0];

  const priceDrop = patch.priceDrop ?? existing?.priceDrop ?? true;
  const backInStock = patch.backInStock ?? existing?.backInStock ?? true;

  if (!priceDrop && !backInStock) {
    await db.delete(followedProducts).where(and(eq(followedProducts.userId, userId), eq(followedProducts.productId, productId)));
    return listFollowedProducts(userId);
  }

  await db
    .insert(followedProducts)
    .values({ userId, productId, priceDrop, backInStock })
    .onConflictDoUpdate({
      target: [followedProducts.userId, followedProducts.productId],
      set: { priceDrop, backInStock },
    });
  return listFollowedProducts(userId);
}

/**
 * How many shoppers are waiting on a product.
 *
 * The requirement is that a back-in-stock request "also reaches the vendor, so
 * they know the level of demand" — this is that number, and it is a count
 * rather than a list because the vendor has no business knowing who.
 */
export async function countFollowers(productId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: followedProducts.id })
    .from(followedProducts)
    .where(and(eq(followedProducts.productId, productId), eq(followedProducts.backInStock, true)));
  return rows.length;
}

export async function listNotificationPreferences(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerNotificationPreferences).where(eq(customerNotificationPreferences.userId, userId));
}

export async function setNotificationPreference(
  userId: number,
  kind: "price_drop" | "bag_reminder" | "new_arrival" | "delivery_update",
  enabled: boolean
) {
  const db = await getDb();
  if (!db) return [];
  await db
    .insert(customerNotificationPreferences)
    .values({ userId, kind, enabled })
    .onConflictDoUpdate({
      target: [customerNotificationPreferences.userId, customerNotificationPreferences.kind],
      set: { enabled },
    });
  return listNotificationPreferences(userId);
}

export async function listOrderTrackingEvents(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orderTrackingEvents).where(eq(orderTrackingEvents.userId, userId));
}
