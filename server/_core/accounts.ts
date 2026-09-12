/**
 * Creating a login, wherever the request comes from.
 *
 * A shopper registering at the storefront and an admin opening a store from
 * the portal both need the same account, made the same way: Firebase holds
 * the password when it is configured, and the local scrypt digest does when it
 * is not. That branch used to live only inside the auth router, so the second
 * caller either imported a router or grew its own copy — and a second copy is
 * how one of them quietly stops using Firebase.
 *
 * It lives in `_core` rather than beside either caller because neither owns
 * it.
 */
import { getFirebaseAuth, isEmailInUse, isFirebaseConfigured } from "./firebase.js";
import { hashPassword } from "./password.js";
import { createUser, linkFirebaseUser } from "../db.js";
import type { User } from "../../drizzle/schema.js";

export type NewAccount = { email: string; password: string; name?: string | null };

/** Thrown when the address already has an account. Callers translate it. */
export class EmailTakenError extends Error {
  constructor() {
    super("EMAIL_TAKEN");
    this.name = "EmailTakenError";
  }
}

/**
 * Registers with Firebase, then mirrors the account locally.
 *
 * The local row is written second on purpose: if it fails, Firebase holds an
 * account with no NetLet row, and the next sign-in creates that row through
 * `linkFirebaseUser`. The reverse order would leave a NetLet row that can
 * never be signed into.
 */
async function createWithFirebase(input: NewAccount): Promise<User> {
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
    if (isEmailInUse(error)) throw new EmailTakenError();
    throw error;
  }

  const user = await linkFirebaseUser({ firebaseUid: uid, email: input.email, name: input.name ?? null });
  if (!user) throw new EmailTakenError();
  return user;
}

/**
 * Creates an account through whichever password store is configured.
 *
 * The password is hashed before the duplicate check on the local path, so a
 * taken address and a free one cost the same time; otherwise the response
 * latency leaks which is which.
 */
export async function createAccount(input: NewAccount): Promise<User> {
  if (isFirebaseConfigured()) return createWithFirebase(input);

  const passwordHash = await hashPassword(input.password);
  const user = await createUser({ email: input.email, passwordHash, name: input.name ?? null });
  if (!user) throw new EmailTakenError();
  return user;
}
