/**
 * Sign-up codes when no Supabase project is configured.
 *
 * Supabase sends the real ones. Without it there is nothing to send mail from,
 * and the rule every value in `.env.example` follows is that an unset variable
 * turns a feature down rather than stopping the server — so `pnpm dev` still
 * walks the whole registration, code step included, and the code is written to
 * the server's log instead of an inbox. A real deployment configures Supabase
 * and never reaches this file.
 *
 * **In memory, and that is only acceptable because of who uses it.** One
 * process, one developer: the pending codes live as long as the process does.
 * Served from short-lived instances it would lose a code between the request
 * that issued it and the one that checks it, which is the argument
 * `rateLimit.ts` makes for Postgres — and the reason this is the fallback and
 * never the path.
 *
 * Kept as a digest with an expiry, compared in constant time, and spent on use.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { CODE_LENGTH } from "../../shared/auth/emailCode.js";

/** As long as Supabase's default, so the two paths feel the same. */
export const LOCAL_CODE_TTL_MS = 60 * 60 * 1000;

const pending = new Map<string, { digest: Buffer; expiresAt: number }>();

const keyOf = (email: string) => email.trim().toLowerCase();
const digestOf = (code: string) => createHash("sha256").update(code).digest();

/** Issues a fresh code for the address, replacing any older one, and logs it. */
export function issueLocalCode(email: string): void {
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  pending.set(keyOf(email), { digest: digestOf(code), expiresAt: Date.now() + LOCAL_CODE_TTL_MS });
  console.info(`[auth] no mail service is configured, so the sign-up code for ${keyOf(email)} is ${code}`);
}

/** Whether a code is waiting for this address — what "send it again" asks first. */
export function hasLocalCode(email: string): boolean {
  const entry = pending.get(keyOf(email));
  return Boolean(entry && entry.expiresAt > Date.now());
}

/** True, and the code spent, when it is the one issued and still in date. */
export function takeLocalCode(email: string, code: string): boolean {
  const key = keyOf(email);
  const entry = pending.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    pending.delete(key);
    return false;
  }
  if (!timingSafeEqual(entry.digest, digestOf(code))) return false;
  pending.delete(key);
  return true;
}
