/**
 * Which store holds an account's password, and the one place that asks.
 *
 * Three can hold it — Supabase Auth, Firebase Authentication, and NetLet's own
 * scrypt digest — and five call sites need the answer: registration, sign-in,
 * change password, change email, change display name, send a reset. Before this
 * module each of those wrote its own `if (firebase && user.firebaseUid) … else
 * …`, which is five copies of one rule, and adding a third store would have
 * made fifteen branches with no single place to read the policy off.
 *
 * ## Which store owns an account is which column its row has
 *
 * `supabaseUid`, `firebaseUid`, `passwordHash` — exactly one is set, which is
 * what `drizzle/schema.ts` promises and `linkExternalUser` maintains when it
 * adopts a row. So there is no provider flag to keep in step with anything: the
 * column *is* the provider.
 *
 * ## What a new account gets, and why that is a different question
 *
 * `activeStore()` answers where a *new* account goes — Supabase when it is
 * configured, otherwise Firebase, otherwise local. `storeFor(user)` answers
 * where an *existing* one already is. Conflating the two is how a migration
 * locks people out: a deployment that moves to Supabase would start checking
 * every password against a service that has never heard of most of them.
 *
 * ## Sign-in tries the active store first, then the legacy ones
 *
 * Only the email and the password arrive, so there is no row to dispatch on
 * yet. The active store goes first because it is both the common case and the
 * one that can create a missing mirror row — which is what lets a user added in
 * the Supabase dashboard sign in here. Then, for an address whose row names an
 * older store, that store. The extra round trips happen only when the first
 * answer was no, so an ordinary sign-in still costs one.
 *
 * Nothing here tells a caller *why* a sign-in failed. Every store returns null
 * for a wrong password, an unknown address and a disabled account alike, which
 * is what stops any of this being used to ask which addresses are registered.
 */
import { hashPassword, verifyPassword } from "./password.js";
import {
  getFirebaseAuth,
  isEmailInUse as isFirebaseEmailInUse,
  isFirebaseConfigured,
  sendFirebasePasswordReset,
  verifyFirebasePassword,
} from "./firebase.js";
import {
  createSupabaseUser,
  deleteSupabaseUser,
  isSupabaseAuthConfigured,
  isSupabaseEmailTaken,
  sendSupabasePasswordReset,
  updateSupabaseUser,
  verifySupabasePassword,
} from "./supabaseAuth.js";
import { createUser, deleteUserRow, findLoginByEmail, linkExternalUser } from "../logins.js";
import { updateUserPasswordHash } from "../profile.js";
import type { User } from "../../drizzle/schema.js";

export type Store = "supabase" | "firebase" | "local";

/** Thrown when the address already has an account, whichever store said so. */
export class EmailTakenError extends Error {
  constructor() {
    super("EMAIL_TAKEN");
    this.name = "EmailTakenError";
  }
}

/** Where a new account goes. */
export function activeStore(): Store {
  if (isSupabaseAuthConfigured()) return "supabase";
  if (isFirebaseConfigured()) return "firebase";
  return "local";
}

/**
 * Where this account's password already is.
 *
 * A row with a uid for a store that is no longer configured still answers that
 * store, and the verify below then fails honestly rather than silently falling
 * through to a local digest that is null. Pretending such an account is
 * "local" would let anyone sign into it with any password, because
 * `verifyPassword` against a null hash is the one case that must never be
 * treated as a match.
 */
export function storeFor(user: Pick<User, "supabaseUid" | "firebaseUid" | "passwordHash">): Store {
  if (user.supabaseUid) return "supabase";
  if (user.firebaseUid) return "firebase";
  return "local";
}

/** Whether this account can be signed into at all, for a caller that must refuse first. */
export function isUsable(user: Pick<User, "supabaseUid" | "firebaseUid" | "passwordHash">): boolean {
  const store = storeFor(user);
  if (store === "supabase") return isSupabaseAuthConfigured();
  if (store === "firebase") return isFirebaseConfigured();
  return Boolean(user.passwordHash);
}

/* ------------------------------------------------------------- creating --- */

/**
 * Creates the credential and mirrors it locally.
 *
 * The local row is written second on purpose: if it fails, the service holds an
 * account with no NetLet row, and the next sign-in creates that row through
 * `linkExternalUser`. The reverse order would leave a NetLet row that can never
 * be signed into — the failure that cannot be recovered by trying again.
 *
 * ## It writes with `createUser`, never `linkExternalUser`, and that is the rule
 *
 * Adoption belongs to sign-in and nowhere else, because what makes it safe there
 * is that a service has just vouched for the password. Registering vouches for
 * nothing: somebody typed an address into a form. Routed through
 * `linkExternalUser` — which is how this read until it was tested — registering
 * an address that already had a NetLet row *took that row over*, because the
 * store's own "already registered" refusal cannot fire for an address the store
 * has never held. So a row whose password was the local scrypt digest, or in
 * Firebase, was claimable by anyone who typed its address into Create account:
 * same `id`, same orders, same `role`, and a session cookie for it. An admin
 * account included.
 *
 * `createUser` refuses an address that has a row, whichever credential column
 * that row carries, and the credential just created is handed back so it cannot
 * hold the address against a later, correct attempt. Every rollback below exists
 * for that: an orphan in the service is a login into nothing, and it would make
 * the honest retry fail forever.
 */
export async function createLogin(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<User> {
  const store = activeStore();

  if (store === "supabase") {
    let uid: string;
    let name: string | null;
    try {
      const created = await createSupabaseUser(input);
      uid = created.uid;
      name = created.name ?? input.name ?? null;
    } catch (error) {
      if (isSupabaseEmailTaken(error)) throw new EmailTakenError();
      throw error;
    }
    const user = await createUser({ email: input.email, supabaseUid: uid, name });
    if (!user) {
      await deleteSupabaseUser(uid).catch(() => {});
      throw new EmailTakenError();
    }
    return user;
  }

  if (store === "firebase") {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase is configured but unavailable");
    let uid: string;
    try {
      const record = await auth.createUser({
        email: input.email,
        password: input.password,
        displayName: input.name ?? undefined,
      });
      uid = record.uid;
    } catch (error) {
      if (isFirebaseEmailInUse(error)) throw new EmailTakenError();
      throw error;
    }
    const user = await createUser({ email: input.email, firebaseUid: uid, name: input.name ?? null });
    if (!user) {
      /* Hand it back here too. This branch used to leave it, so a registration
         that lost the address once could never win it: Firebase answered every
         retry with email-already-in-use for a credential nothing pointed at. */
      await auth.deleteUser(uid).catch(() => {});
      throw new EmailTakenError();
    }
    return user;
  }

  /* The password is hashed before the duplicate check, so a taken address and a
     free one cost the same time; otherwise the latency says which is which. */
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({ email: input.email, passwordHash, name: input.name ?? null });
  if (!user) throw new EmailTakenError();
  return user;
}

/**
 * Undoes a login this request had just created.
 *
 * One caller: `createVendorWithOwner` makes the store, then the owner's account,
 * then the membership that ties them together, and undoes the store if any of
 * that fails — because "a store that exists but cannot be signed into looks
 * finished, so nobody goes back to fix it". The account was left behind, and
 * with the credential now in Supabase that leftover shows up on the
 * Authentication page: a login into a store that no longer exists, on the one
 * page somebody looks at to see who has an account.
 *
 * Every failure here is swallowed and logged. The caller is already failing the
 * request for a reason the admin can act on, and replacing that with a 500 from
 * the cleanup would hide it. Only ever called for an account created moments
 * ago in the same request, never on an existing one.
 */
export async function deleteLogin(user: User): Promise<void> {
  try {
    switch (storeFor(user)) {
      case "supabase":
        await deleteSupabaseUser(user.supabaseUid!);
        break;
      case "firebase": {
        const auth = getFirebaseAuth();
        if (auth) await auth.deleteUser(user.firebaseUid!);
        break;
      }
      default:
        /* Nothing outside the row: the digest goes with it. */
        break;
    }
  } catch (error) {
    console.error(`[auth] could not remove the credential for user ${user.id}: ${String(error)}`);
  }

  try {
    await deleteUserRow(user.id);
  } catch (error) {
    console.error(`[auth] could not remove the mirror row for user ${user.id}: ${String(error)}`);
  }
}

/* ------------------------------------------------------------- signing in --- */

/**
 * Verifies an email and password against whichever store can vouch for them.
 *
 * Returns the NetLet row, or null. See the file header for the order and why
 * the answer never says which of the three reasons it was.
 */
export async function signIn(email: string, password: string): Promise<User | null> {
  const active = activeStore();

  /* The active store goes first, and without reading the row: it is the common
     case, and it is the only one that can vouch for a credential this database
     has never seen — which is what lets a user added in the Supabase dashboard
     sign in here. */
  if (active === "supabase") {
    const verified = await verifySupabasePassword(email, password);
    if (verified) {
      return linkExternalUser({ provider: "supabase", uid: verified.uid, email: verified.email, name: verified.name });
    }
  }
  if (active === "firebase") {
    const verified = await verifyFirebasePassword(email, password);
    if (verified) {
      return linkExternalUser({ provider: "firebase", uid: verified.uid, email: verified.email, name: verified.name });
    }
  }

  /* Past here the active store said no, and what is left is a row whose password
     an older store holds. Read once and use it for both — two reads would be
     two chances for them to disagree, and a wasted round trip on every failed
     sign-in. */
  const row = await findLoginByEmail(email);

  if (active !== "firebase" && row?.firebaseUid && isFirebaseConfigured()) {
    const verified = await verifyFirebasePassword(email, password);
    if (verified) {
      return linkExternalUser({ provider: "firebase", uid: verified.uid, email: verified.email, name: verified.name });
    }
  }

  /* The local digest, which is both the fallback store and the legacy one. */
  if (!row?.passwordHash) {
    /* Hash anyway. Returning early for an address with no local digest would
       make sign-in measurably faster for the addresses that do not have one. */
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, row.passwordHash)) ? row : null;
}

/**
 * Re-checks the password of somebody already signed in.
 *
 * Against the store that owns their account, not the active one: a shopper
 * whose password is still in Firebase must be able to confirm it to change
 * their email. An account no store can vouch for is refused rather than waved
 * through — the failure mode of the alternative is silent and total.
 */
export async function verifyCurrent(user: User, password: string): Promise<boolean> {
  switch (storeFor(user)) {
    case "supabase":
      return Boolean(user.supabaseUid) && Boolean(await verifySupabasePassword(user.email, password));
    case "firebase":
      return isFirebaseConfigured() && Boolean(await verifyFirebasePassword(user.email, password));
    default:
      /* Bound to a const, because `Boolean(...) &&` does not narrow the field
         for the call in the same expression — and a null hash must never reach
         `verifyPassword`, which is the one case that could be read as a match. */
      return user.passwordHash === null ? false : await verifyPassword(password, user.passwordHash);
  }
}

/* -------------------------------------------------------------- changing --- */

/** Replaces the password wherever it is held. */
export async function setPassword(user: User, password: string): Promise<void> {
  switch (storeFor(user)) {
    case "supabase":
      await updateSupabaseUser(user.supabaseUid!, { password });
      return;
    case "firebase": {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error("Firebase holds this password but is not configured");
      await auth.updateUser(user.firebaseUid!, { password });
      return;
    }
    default:
      await updateUserPasswordHash(user.id, await hashPassword(password));
  }
}

/**
 * Moves the login address in the store that holds it.
 *
 * Called *before* the mirror is updated, and `revertEmail` undoes it if that
 * write fails: sign-in goes to the store, so a mirror that disagrees is the
 * lie. Throws `EmailTakenError` when the store already has that address.
 */
export async function setEmail(user: User, email: string): Promise<void> {
  try {
    switch (storeFor(user)) {
      case "supabase":
        await updateSupabaseUser(user.supabaseUid!, { email });
        return;
      case "firebase": {
        const auth = getFirebaseAuth();
        if (!auth) throw new Error("Firebase holds this account but is not configured");
        await auth.updateUser(user.firebaseUid!, { email });
        return;
      }
      default:
        /* Nothing outside the mirror to move: the digest is the mirror. */
        return;
    }
  } catch (error) {
    if (isSupabaseEmailTaken(error) || isFirebaseEmailInUse(error)) throw new EmailTakenError();
    throw error;
  }
}

/** Puts the address back, for the caller whose mirror write lost the race. */
export async function revertEmail(user: User, email: string): Promise<void> {
  await setEmail(user, email).catch(error => {
    /* Swallowed: the caller is already failing the request, and a second
       failure here would replace a refusal the shopper can act on with a 500.
       Logged, because the two are now out of step and somebody must know. */
    console.error(`[auth] could not restore the login address for user ${user.id}: ${String(error)}`);
  });
}

/**
 * Keeps the display name in step where the store holds one too.
 *
 * A mirror that disagrees is the kind of drift nobody notices until a reset
 * email is addressed to the wrong name.
 */
export async function setDisplayName(user: User, name: string | null): Promise<void> {
  switch (storeFor(user)) {
    case "supabase":
      await updateSupabaseUser(user.supabaseUid!, { name });
      return;
    case "firebase": {
      const auth = getFirebaseAuth();
      if (!auth) return;
      await auth.updateUser(user.firebaseUid!, { displayName: name ?? undefined });
      return;
    }
    default:
      /* The local store keeps the name in the mirror and nowhere else. */
      return;
  }
}

/* ----------------------------------------------------------- resetting --- */

/**
 * Asks whichever service is configured to email a reset link.
 *
 * Both are asked when both are configured, because the address might belong to
 * either and this endpoint must not look up which — the reply is identical for
 * an address with no account anywhere, which is the property that stops it
 * being used to ask who is registered. A service with no such address answers
 * the same silence.
 */
export async function sendReset(email: string, locale: "en" | "ar"): Promise<void> {
  if (isSupabaseAuthConfigured()) await sendSupabasePasswordReset(email, locale);
  if (isFirebaseConfigured()) await sendFirebasePasswordReset(email, locale);
}

/**
 * Whether a reset link could actually have been sent.
 *
 * The shopper-facing endpoint never says, on purpose. The admin one does: it
 * takes a user id it already has on screen rather than an address somebody
 * could be guessing, and an administrator told "sent" would otherwise wait for
 * an email that was never coming.
 */
export function canSendReset(): boolean {
  return isSupabaseAuthConfigured() || isFirebaseConfigured();
}
