/**
 * The shop's owner: the account `OWNER_EMAIL` names, which is NetLet's
 * administrator for good, on the owner's word ("make sure that this account
 * stays as super admin").
 *
 * Three rules follow from it, each where the act is: an account made with
 * this address is an administrator from the start (`logins.createUser`), no
 * administrator can take that away (`setUserAdmin`, `OWNER_STAYS`), and a
 * sign-in puts it back if anything else ever did — a hand edit in the
 * database included (`logins.keepOwnerAdmin`). An administrator still cannot
 * delete their own account, so the owner cannot either.
 */
import { ENV } from "./env.js";

export function ownerEmail(): string {
  return ENV.ownerEmail.trim().toLowerCase();
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = ownerEmail();
  return Boolean(owner && email && email.trim().toLowerCase() === owner);
}
