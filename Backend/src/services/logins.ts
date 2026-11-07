/**
 * The writes that create, link and remove an account's mirror row.
 *
 * Outside `db.ts` on purpose, and for the reason `profile.ts` and `orders.ts`
 * are: a function declared inside `db.ts` calls that file's module-local
 * `getDb`, which nothing outside can redirect, so it cannot be pointed at a
 * test database. That was survivable while this was one insert. It stopped
 * being survivable when `linkExternalUser` became the thing that keeps an
 * account from having two password stores at once — a rule whose failure is
 * silent, and which a test therefore has to be able to exercise against real
 * SQL. Import them from here rather than from `db.ts`: re-exporting them there
 * would make a cycle, and a test that redirects `getDb` would then hand the
 * mock to one half of it and the real module to the other.
 */
import { and, eq, isNull } from "drizzle-orm";
import { users, type User } from "../../database/schema.js";
import { isOwnerEmail } from "../core/owner.js";
import { getDb, isDuplicateKeyError } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * One account by address, on a handle the caller already has.
 *
 * This module's own lookup rather than the one in `db.ts`, for exactly the
 * reason the writes moved here: that one reaches for that file's local handle,
 * so a redirected `getDb` would give these writes a test database and their
 * reads the real one — which reads as "the insert worked and the row is not
 * there". It also saves a second `getDb` per call, the handle being open.
 */
async function byEmail(db: Db, email: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

/**
 * One account by address, for a caller with no handle of its own.
 *
 * `passwordStore` reads through this rather than through `db.ts`, so that the
 * reads and the writes of one sign-in are always against the same database. A
 * caller that mixed the two would, under a redirected `getDb`, write the mirror
 * row to one and then fail to find it in the other.
 */
export async function findLoginByEmail(email: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  return byEmail(db, email.trim().toLowerCase());
}

/**
 * Creates an account. Returns null when the address is already registered,
 * rather than throwing, so the caller can answer without leaking which
 * addresses exist.
 *
 * `email` is lowercased here — the single place it is written — so the unique
 * index is case-insensitive regardless of the column's collation.
 */
export async function createUser(input: {
  email: string;
  /** Null when Supabase Auth holds the password for this account. */
  passwordHash?: string | null;
  /** Set when the account was created in Supabase Auth. */
  supabaseUid?: string | null;
  name?: string | null;
}): Promise<User | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const email = input.email.trim().toLowerCase();
  if (await byEmail(db, email)) return null;

  // The owner, if configured, is an admin from the moment they register.
  const role = isOwnerEmail(email) ? "admin" : "user";

  try {
    await db.insert(users).values({
      email,
      passwordHash: input.passwordHash ?? null,
      supabaseUid: input.supabaseUid ?? null,
      name: input.name ?? null,
      role,
      lastSignedIn: new Date(),
    });
  } catch (error) {
    // Two concurrent registrations for one address: the unique index rejects
    // the loser, which is the correct outcome, not an error worth surfacing.
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }

  return (await byEmail(db, email)) ?? null;
}


/**
 * The local row for a Supabase Auth account, created on first sign-in if missing.
 *
 * A shopper can exist in Supabase Auth without a row here — added by hand in the
 * dashboard, registered against another deployment, or created before this
 * database was restored. Sign-in is the moment to reconcile that, rather than
 * refusing an account whose password the service has already accepted. It is
 * also what makes "add a user in the Supabase dashboard" a working way to create
 * a NetLet login.
 *
 * **Only sign-in may call this.** What makes adoption safe is that the service
 * has already checked the password — the caller is holding proof that whoever is
 * asking owns the address. Registration holds no such proof, so it writes through
 * `createUser`, which refuses an address that already has a row; calling this
 * from there hands the existing account, its orders and its role to whoever typed
 * the address into a form. See the rule spelled out above `passwordStore.createLogin`.
 *
 * When a row for the address exists but predates the service, it is adopted:
 * the uid is written onto it and **the local digest cleared**, so the shopper
 * keeps their saved products instead of starting a second account beside them —
 * and so the mutual exclusion the schema promises survives the adoption. Leaving
 * the digest would give one row two password stores, and `storeFor` would then
 * answer whichever it checked first.
 *
 * `create: false` finds and adopts but never makes a row, and answers null
 * where it would have: a sign-up whose code never came back is not an account
 * to make at sign-in, however its address came to be confirmed.
 */
export async function linkExternalUser(input: {
  uid: string;
  email: string;
  name?: string | null;
  create?: boolean;
}): Promise<User | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const email = input.email.trim().toLowerCase();
  const credentials = { supabaseUid: input.uid, passwordHash: null };

  const byUid = await db.select().from(users).where(eq(users.supabaseUid, input.uid)).limit(1);
  if (byUid[0]) return byUid[0];

  const existing = await byEmail(db, email);
  if (existing) {
    await db
      .update(users)
      .set({ ...credentials, name: existing.name ?? input.name ?? null })
      .where(eq(users.id, existing.id));
    return (await byEmail(db, email)) ?? null;
  }

  if (input.create === false) return null;
  return createUser({ email, ...credentials, name: input.name ?? null });
}


/**
 * The owner's account is an administrator whatever happened to it since
 * (`core/owner.ts`): asked at every sign-in, so a role taken away by hand in
 * the database comes back the next time the owner signs in. Answers the row
 * as it now stands.
 */
export async function keepOwnerAdmin<T extends { id: number; email: string | null; role: string }>(user: T): Promise<T> {
  if (user.role === "admin" || !isOwnerEmail(user.email)) return user;
  const db = await getDb();
  if (!db) return user;
  await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
  console.warn(`[auth] the owner's account ${user.id} was not an administrator; made one again`);
  return { ...user, role: "admin" };
}

/**
 * What a sign-in with Apple or Google lands on.
 *
 * "existing" is the account the Supabase user already belonged to — found by
 * its uid, which is the case Supabase arranges itself when somebody who
 * registered with a password chooses Apple or Google, since it links an
 * identity with the same verified address to the user it already has.
 * "created" is a new account. "taken" is an address another account holds by
 * a credential the provider did not check — a local password digest, or a
 * different Supabase user — which this refuses rather than adopts, so the
 * answer is to sign in the way that account was made.
 */
export type ProviderLink = { kind: "existing" | "created"; user: User } | { kind: "taken" };

/**
 * The NetLet row for a Supabase user who signed in with Apple or Google.
 *
 * Narrower than `linkExternalUser`, on purpose. That one adopts any row with
 * the address, because a password the service has just checked is proof the
 * caller owns the account; here the proof is the provider's that the caller
 * owns an account there with this address, and a NetLet account that already
 * signs in another way keeps that way rather than gaining a second store.
 * Only a row with no credential at all is adopted, and only for an address
 * Supabase holds as confirmed — the one case `linkExternalUser` exists for,
 * an account that was a row before it was a login.
 */
export async function linkProviderAccount(input: {
  uid: string;
  email: string;
  emailConfirmed: boolean;
  name?: string | null;
}): Promise<ProviderLink> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const byUid = await db.select().from(users).where(eq(users.supabaseUid, input.uid)).limit(1);
  if (byUid[0]) return { kind: "existing", user: byUid[0] };

  const email = input.email.trim().toLowerCase();
  const existing = await byEmail(db, email);
  if (existing) {
    if (existing.supabaseUid || existing.passwordHash || !input.emailConfirmed) return { kind: "taken" };
    await db
      .update(users)
      .set({ supabaseUid: input.uid, passwordHash: null, name: existing.name ?? input.name ?? null })
      .where(eq(users.id, existing.id));
    const adopted = await byEmail(db, email);
    return adopted ? { kind: "existing", user: adopted } : { kind: "taken" };
  }

  const created = await createUser({ email, supabaseUid: input.uid, name: input.name ?? null });
  if (created) return { kind: "created", user: created };
  /* Two sign-ins racing for one new address: the loser finds the winner's
     row, which is the same provider account's. */
  const raced = await db.select().from(users).where(eq(users.supabaseUid, input.uid)).limit(1);
  return raced[0] ? { kind: "existing", user: raced[0] } : { kind: "taken" };
}

/**
 * The NetLet row for a phone a text-message code has just proven.
 *
 * By the Supabase user first, then by the number: an account already signing
 * in with this phone is that account. Otherwise a new account with no email,
 * which its owner may add later (`users_has_identifier` holds that it has the
 * phone). A phone is one account's: a row holding it under another Supabase
 * user — which only a hand edit could make — is "taken", never adopted.
 *
 * With no Supabase (`pnpm dev`, the code in the log) there is no uid, and the
 * number alone is the account.
 */
export async function linkPhoneAccount(input: { uid: string | null; phone: string }): Promise<ProviderLink> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  if (input.uid) {
    const [byUid] = await db.select().from(users).where(eq(users.supabaseUid, input.uid)).limit(1);
    if (byUid) {
      if (byUid.phone !== input.phone) {
        await db.update(users).set({ phone: input.phone }).where(eq(users.id, byUid.id));
        return { kind: "existing", user: { ...byUid, phone: input.phone } };
      }
      return { kind: "existing", user: byUid };
    }
  }

  const [byPhone] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1);
  if (byPhone) {
    if (!input.uid || byPhone.supabaseUid === input.uid) return { kind: "existing", user: byPhone };
    if (byPhone.supabaseUid) return { kind: "taken" };
    await db.update(users).set({ supabaseUid: input.uid }).where(eq(users.id, byPhone.id));
    return { kind: "existing", user: { ...byPhone, supabaseUid: input.uid } };
  }

  try {
    const [created] = await db
      .insert(users)
      .values({ email: null, phone: input.phone, supabaseUid: input.uid, role: "user", lastSignedIn: new Date() })
      .returning();
    return { kind: "created", user: created };
  } catch (error) {
    /* Two codes spent at once for one new number: the loser finds the winner's row. */
    if (!isDuplicateKeyError(error)) throw error;
    const [raced] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1);
    return raced ? { kind: "existing", user: raced } : { kind: "taken" };
  }
}

/**
 * Gives an account with no email the address its owner has just proven, in
 * the same statement that checks nobody else holds it. Null when somebody
 * does — the unique index answers the race the check alone cannot.
 */
export async function addAccountEmail(userId: number, email: string): Promise<User | null> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const address = email.trim().toLowerCase();
  if (await byEmail(db, address)) return null;
  try {
    const [updated] = await db
      .update(users)
      .set({ email: address })
      .where(and(eq(users.id, userId), isNull(users.email)))
      .returning();
    return updated ?? null;
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

/**
 * Removes an account's mirror row.
 *
 * Only for undoing one made moments earlier in the same request — see
 * `passwordStore.deleteLogin`. There is deliberately no "delete my account"
 * anywhere: an order must still render years later, and `order_items` freezes
 * what it needs precisely so a row *can* go, but nobody has decided what a
 * shopper closing their account should mean for a return still in its window.
 */
export async function deleteUserRow(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(users).where(eq(users.id, id));
}

