/**
 * A shopper's own record, as they may change it.
 *
 * Separate from `db.ts` for the same reason `inventory.ts` is: the functions
 * inside `db.ts` call its module-local `getDb`, which nothing outside can
 * redirect, so anything living there is untestable against a real database
 * without a live connection string. Importing `getDb` instead — as this does,
 * and as the inventory layer does — means a test can point the whole layer at
 * an in-process Postgres and exercise the real SQL.
 */
import { eq } from "drizzle-orm";
import { customerPreferences, users, type User } from "../drizzle/schema.js";
import { getDb, isDuplicateKeyError } from "./db.js";

export async function loadUser(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/**
 * Changes the display name. The only profile field with nothing behind it —
 * no credential, no uniqueness — so it needs no verification.
 */
export async function updateUserName(id: number, name: string | null): Promise<User | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.update(users).set({ name }).where(eq(users.id, id)).returning();
  return row;
}

/**
 * Moves the login to a new address.
 *
 * Returns undefined when the address is taken, rather than throwing, so the
 * caller answers the same way it does elsewhere instead of leaking which
 * addresses exist through an error type.
 */
export async function updateUserEmail(id: number, email: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const next = email.trim().toLowerCase();

  // Queried through this module's own handle rather than db.ts's helper: the
  // helper reaches for db.ts's module-local connection, which would put half
  // of one operation on a different database from the other half.
  const [existing] = await db.select().from(users).where(eq(users.email, next)).limit(1);
  if (existing && existing.id !== id) return undefined;

  try {
    const [row] = await db.update(users).set({ email: next }).where(eq(users.id, id)).returning();
    return row;
  } catch (error) {
    // The unique index is the real arbiter; the read above only saves a round
    // trip in the common case and cannot close the race on its own.
    if (isDuplicateKeyError(error)) return undefined;
    throw error;
  }
}

/** Replaces the local scrypt digest. Only used when Supabase Auth is unset. */
export async function updateUserPasswordHash(id: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/** The shopper's stored preferences, or undefined when they have never set one. */
export async function getCustomerProfile(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(customerPreferences).where(eq(customerPreferences.userId, userId)).limit(1);
  return rows[0];
}

/**
 * Remember a shopper's language, delivery area or bag.
 *
 * **An update with nothing in it writes nothing.** `onConflictDoUpdate` with an
 * empty `set` is refused when the statement is *built*, not when a conflict
 * happens — the trap the wishlist's "add to list" fell into first — so `{}`, or
 * a patch whose every key is `undefined`, was a 500 from Drizzle rather than a
 * no-op. It moved here from `db.ts` when a fuzz found it, so a test could reach
 * it: nothing inside `db.ts` can be pointed at a test database.
 */
export async function upsertCustomerProfile(
  userId: number,
  patch: { locale?: "en" | "ar"; deliveryZoneId?: string | null; cartId?: string | null },
) {
  const db = await getDb();
  if (!db) return undefined;
  const set = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  if (Object.keys(set).length === 0) return getCustomerProfile(userId);
  await db
    .insert(customerPreferences)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: customerPreferences.userId, set });
  return getCustomerProfile(userId);
}
