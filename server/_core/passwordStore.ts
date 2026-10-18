/**
 * Which store holds an account's password, and the one place that asks.
 *
 * Two can hold it — Supabase Auth, and NetLet's own scrypt digest — and six
 * call sites need the answer: registration, sign-in, change password, change
 * email, change display name, send a reset. Before this module each of those
 * wrote its own `if (configured && user.uid) … else …`, which is six copies of
 * one rule.
 *
 * ## Which store owns an account is which column its row has
 *
 * `supabaseUid` or `passwordHash` — exactly one is set, which is what
 * `drizzle/schema.ts` promises and `linkExternalUser` maintains when it adopts
 * a row. So there is no provider flag to keep in step with anything: the column
 * *is* the provider.
 *
 * ## The local digest is the no-configuration fallback, not a second option
 *
 * `activeStore()` answers where a *new* account goes: Supabase when it is
 * configured, otherwise the local digest. That fallback exists so `pnpm dev`
 * works before any third-party account does — nothing in this codebase throws
 * at boot on a missing value, and an unset variable turns a feature off rather
 * than preventing startup. A real deployment configures Supabase and never
 * reaches it.
 *
 * `storeFor(user)` answers where an *existing* account already is. Conflating
 * the two is how a migration locks people out: a deployment that starts
 * checking every password against a service would be asking one that has never
 * heard of most of them.
 *
 * ## Firebase used to be here
 *
 * It held every password until the move to Supabase Auth, and the branches
 * stayed for as long as one row carried a `firebase_uid`. None did, so they went,
 * and the column went after them — `git log` has both if the reasoning is ever
 * wanted.
 *
 * Nothing here tells a caller *why* a sign-in failed. Every store returns null
 * for a wrong password, an unknown address and a disabled account alike, which
 * is what stops any of this being used to ask which addresses are registered.
 */
import { hashPassword, verifyPassword } from "./password.js";
import {
  createSupabaseUser,
  deleteSupabaseUser,
  isSupabaseAuthConfigured,
  isSupabaseEmailTaken,
  isSupabaseMailLimited,
  resendSupabaseSignupCode,
  sendSupabasePasswordReset,
  signInSupabase,
  signUpSupabaseUser,
  updateSupabaseUser,
  verifySupabasePassword,
  verifySupabaseSignupCode,
} from "./supabaseAuth.js";
import { hasLocalCode, issueLocalCode, takeLocalCode } from "./localCodes.js";
import { checkPassword } from "../../Shared/auth/passwordStrength.js";
import { createUser, deleteUserRow, findLoginByEmail, linkExternalUser } from "../logins.js";
import { updateUserPasswordHash } from "../profile.js";
import type { User } from "../../drizzle/schema.js";

export type Store = "supabase" | "local";

/** Thrown when the address already has an account, whichever store said so. */
export class EmailTakenError extends Error {
  constructor() {
    super("EMAIL_TAKEN");
    this.name = "EmailTakenError";
  }
}

/** Thrown when the mail service will not send another code yet. */
export class CodeNotSentError extends Error {
  constructor() {
    super("CODE_NOT_SENT");
    this.name = "CodeNotSentError";
  }
}

/** Thrown when the code was right and the password given beside it is not the account's. */
export class PasswordMismatchError extends Error {
  constructor() {
    super("PASSWORD_MISMATCH");
    this.name = "PasswordMismatchError";
  }
}

/** Thrown when a password being set falls under the floor. */
export class WeakPasswordError extends Error {
  constructor() {
    super("WEAK_PASSWORD");
    this.name = "WeakPasswordError";
  }
}

/** Where a new account goes. */
export function activeStore(): Store {
  return isSupabaseAuthConfigured() ? "supabase" : "local";
}

/**
 * Where this account's password already is.
 *
 * A row with a uid for a service that is no longer configured still answers
 * that service, and the verify below then fails honestly rather than silently
 * falling through to a local digest that is null. Pretending such an account is
 * "local" would let anyone sign into it with any password, because
 * `verifyPassword` against a null hash is the one case that must never be
 * treated as a match.
 */
export function storeFor(user: Pick<User, "supabaseUid" | "passwordHash">): Store {
  return user.supabaseUid ? "supabase" : "local";
}

/** Whether this account can be signed into at all, for a caller that must refuse first. */
export function isUsable(user: Pick<User, "supabaseUid" | "passwordHash">): boolean {
  return storeFor(user) === "supabase" ? isSupabaseAuthConfigured() : Boolean(user.passwordHash);
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
 * has never held. So a row whose password was the local scrypt digest was
 * claimable by anyone who typed its address into Create account: same `id`, same
 * orders, same `role`, and a session cookie for it. An admin account included.
 *
 * `createUser` refuses an address that has a row, whichever credential column
 * that row carries, and the credential just created is handed back so it cannot
 * hold the address against a later, correct attempt. The rollback below exists
 * for that: an orphan in the service is a login into nothing, and it would make
 * the honest retry fail forever.
 */
export async function createLogin(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<User> {
  if (activeStore() === "supabase") {
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

  /* The password is hashed before the duplicate check, so a taken address and a
     free one cost the same time; otherwise the latency says which is which. */
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({ email: input.email, passwordHash, name: input.name ?? null });
  if (!user) throw new EmailTakenError();
  return user;
}

/* ---------------------------------------------------------- registering --- */

/**
 * Registering is two requests, and the account exists only after the second.
 *
 * The first sends a code to the address; the second takes the code back. A
 * shopper's account is never made from an address nobody has shown they read —
 * an account made at a typo, or at somebody else's address, would be one whose
 * owner can never get in, or one that is not theirs at all.
 *
 * `createLogin` above stays the administrator's door: opening a store with its
 * owner is somebody vouching for an address, which is a different act.
 */
export type Registration = { email: string; password: string; name?: string | null };

/**
 * Sends the code, or — on a project that confirms addresses by itself — makes
 * the account on the spot, which is the one configuration the code step cannot
 * survive and `pnpm preflight` warns about.
 *
 * Refuses an address NetLet already has a row for before anything is sent: a
 * code that ends in "that address is taken" is a mail spent on a refusal.
 */
export async function startRegistration(input: Registration): Promise<{ status: "codeSent" } | { status: "created"; user: User }> {
  const email = input.email.trim().toLowerCase();

  if (activeStore() === "supabase") {
    if (await findLoginByEmail(email)) throw new EmailTakenError();
    let outcome;
    try {
      outcome = await signUpSupabaseUser({ ...input, email });
    } catch (error) {
      if (isSupabaseEmailTaken(error)) throw new EmailTakenError();
      if (isSupabaseMailLimited(error)) throw new CodeNotSentError();
      throw error;
    }
    if (outcome.kind === "codeSent") return { status: "codeSent" };

    console.warn("[auth] Supabase confirmed a new address without sending a code. Turn on \"Confirm email\" under Authentication → Sign In / Providers → Email.");
    const user = await createUser({ email, supabaseUid: outcome.user.uid, name: outcome.user.name ?? input.name ?? null });
    if (!user) {
      await deleteSupabaseUser(outcome.user.uid).catch(() => {});
      throw new EmailTakenError();
    }
    return { status: "created", user };
  }

  /* Hashed whether or not the address is free, so the time taken does not say
     which — the reason `createLogin` hashes first. */
  const [existing] = await Promise.all([findLoginByEmail(email), hashPassword(input.password)]);
  if (existing) throw new EmailTakenError();
  issueLocalCode(email);
  return { status: "codeSent" };
}

/**
 * Sends the code again. Silent for an address with nothing waiting, so the
 * reply never says which addresses are part-way through registering.
 */
export async function resendRegistrationCode(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  if (activeStore() === "supabase") {
    try {
      await resendSupabaseSignupCode(address);
    } catch (error) {
      if (isSupabaseMailLimited(error)) throw new CodeNotSentError();
      throw error;
    }
    return;
  }
  if (hasLocalCode(address)) issueLocalCode(address);
}

/**
 * Takes the code back and makes the account. Null when the code is wrong or
 * has expired.
 *
 * **The password given here is the one the account keeps.** An address can be
 * registered more than once before anybody confirms it — by its owner twice, or
 * by somebody else first — and which password Supabase kept is then whichever
 * it decided to. The person typing the code is the one who reads that inbox, so
 * their password is written over whatever was held, provided it meets the floor
 * a password being *set* has to. Below the floor it must already be the
 * account's: that is the path from sign-in, where an account made before the
 * code step existed is asked for its code, and it is checked rather than
 * written.
 */
export async function finishRegistration(input: Registration & { code: string }): Promise<User | null> {
  const email = input.email.trim().toLowerCase();
  const strong = checkPassword(input.password).acceptable;

  if (activeStore() === "supabase") {
    const confirmed = await verifySupabaseSignupCode(email, input.code);
    if (!confirmed) return null;

    if (strong) {
      await updateSupabaseUser(confirmed.uid, { password: input.password, ...(input.name ? { name: input.name } : {}) });
    } else if (!(await verifySupabasePassword(email, input.password))) {
      throw new PasswordMismatchError();
    }

    const user = await createUser({ email, supabaseUid: confirmed.uid, name: input.name ?? confirmed.name ?? null });
    if (user) return user;
    /* A second press of the same code after the first had already landed. */
    const row = await findLoginByEmail(email);
    if (row?.supabaseUid === confirmed.uid) return row;
    throw new EmailTakenError();
  }

  if (!strong) throw new WeakPasswordError();
  if (!takeLocalCode(email, input.code)) return null;
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({ email, passwordHash, name: input.name ?? null });
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
 * with the credential in Supabase that leftover shows up on the Authentication
 * page: a login into a store that no longer exists, on the one page somebody
 * looks at to see who has an account.
 *
 * Every failure here is swallowed and logged. The caller is already failing the
 * request for a reason the admin can act on, and replacing that with a 500 from
 * the cleanup would hide it. Only ever called for an account created moments
 * ago in the same request, never on an existing one.
 */
export async function deleteLogin(user: User): Promise<void> {
  try {
    /* Nothing outside the row for a local account: the digest goes with it. */
    if (storeFor(user) === "supabase") await deleteSupabaseUser(user.supabaseUid!);
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
 * Returns the NetLet row, or null. See the file header for why the answer never
 * says which of the reasons it was — with one exception, "unconfirmed", which
 * Supabase only gives for the right password (see `signInSupabase`).
 *
 * Supabase goes first, and without reading the row: it is the common case, and
 * it is the only one that can vouch for a credential this database has never
 * seen — which is what lets a user added in the Supabase dashboard sign in here.
 * The row is read only once Supabase has said no, so an ordinary sign-in still
 * costs one round trip.
 */
export async function signIn(email: string, password: string): Promise<User | "unconfirmed" | null> {
  if (activeStore() === "supabase") {
    const verified = await signInSupabase(email, password);
    /* The right password on an address whose code was never typed in: the
       form takes them to the code rather than calling the password wrong. */
    if (verified === "unconfirmed") return "unconfirmed";
    if (verified) {
      return linkExternalUser({ uid: verified.uid, email: verified.email, name: verified.name });
    }
  }

  const row = await findLoginByEmail(email);
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
 * Against the store that owns their account, not the active one. An account no
 * store can vouch for is refused rather than waved through — the failure mode
 * of the alternative is silent and total.
 */
export async function verifyCurrent(user: User, password: string): Promise<boolean> {
  if (storeFor(user) === "supabase") {
    return Boolean(user.supabaseUid) && Boolean(await verifySupabasePassword(user.email, password));
  }
  /* Bound to a const, because `Boolean(...) &&` does not narrow the field for
     the call in the same expression — and a null hash must never reach
     `verifyPassword`, which is the one case that could be read as a match. */
  return user.passwordHash === null ? false : await verifyPassword(password, user.passwordHash);
}

/* -------------------------------------------------------------- changing --- */

/** Replaces the password wherever it is held. */
export async function setPassword(user: User, password: string): Promise<void> {
  if (storeFor(user) === "supabase") {
    await updateSupabaseUser(user.supabaseUid!, { password });
    return;
  }
  await updateUserPasswordHash(user.id, await hashPassword(password));
}

/**
 * Moves the login address in the store that holds it.
 *
 * Called *before* the mirror is updated, and `revertEmail` undoes it if that
 * write fails: sign-in goes to the store, so a mirror that disagrees is the
 * lie. Throws `EmailTakenError` when the store already has that address.
 */
export async function setEmail(user: User, email: string): Promise<void> {
  /* Nothing outside the mirror to move for a local account: the digest is the
     mirror. */
  if (storeFor(user) !== "supabase") return;

  try {
    await updateSupabaseUser(user.supabaseUid!, { email });
  } catch (error) {
    if (isSupabaseEmailTaken(error)) throw new EmailTakenError();
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
 * email is addressed to the wrong name. The local store keeps the name in the
 * mirror and nowhere else, so there is nothing to do for it.
 */
export async function setDisplayName(user: User, name: string | null): Promise<void> {
  if (storeFor(user) === "supabase") await updateSupabaseUser(user.supabaseUid!, { name });
}

/* ----------------------------------------------------------- resetting --- */

/**
 * Asks the configured service to email a reset link.
 *
 * Silent when none is: the local digest has no mail to send from, and the
 * endpoint's reply is identical either way. That sameness is the property that
 * stops it being used to ask who is registered, so it holds for an address with
 * no account and for a deployment with no service alike.
 */
export async function sendReset(email: string, locale: "en" | "ar"): Promise<void> {
  if (isSupabaseAuthConfigured()) await sendSupabasePasswordReset(email, locale);
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
  return isSupabaseAuthConfigured();
}
