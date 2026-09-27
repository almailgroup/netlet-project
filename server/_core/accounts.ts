/**
 * Creating a login, wherever the request comes from.
 *
 * A shopper registering at the storefront and an admin opening a store from the
 * portal both need the same account, made the same way. That branch used to
 * live inside the auth router, so the second caller either imported a router or
 * grew its own copy — and a copy is how one of them quietly stops using the
 * configured password store.
 *
 * It is a thin pass-through to `passwordStore.createLogin` now: which of the
 * three stores holds the password stopped being this file's business the moment
 * there were three of them, and one module deciding that for every caller is
 * the whole point of `passwordStore.ts`. The wrapper stays because both callers
 * import *this* name, and because "the one place an account gets made" is worth
 * being a place.
 */
import { createLogin, EmailTakenError } from "./passwordStore.js";
import type { User } from "../../drizzle/schema.js";

export { EmailTakenError };

export type NewAccount = { email: string; password: string; name?: string | null };

export async function createAccount(input: NewAccount): Promise<User> {
  return createLogin(input);
}
