/**
 * The staff desk's door: one password, set in the deployment's environment,
 * and a session cookie this server signs.
 *
 * The cookie is signed with a key derived from the password (or from
 * SESSION_SECRET, when one is set), so changing the password signs every
 * device out — which is what somebody changing it after a phone went missing
 * wants. It names nothing but when it ends.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "shiplee_staff";
export const SESSION_HOURS = 12;
/** A shared password guards every shipment's recipient details, so it is not a short one. */
export const MIN_PASSWORD = 12;

/** Ten wrong passwords from one address in a quarter of an hour, and that address waits. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type StaffKey = { password: string; key: Buffer };

export function staffKey(env: { STAFF_PASSWORD?: string; SESSION_SECRET?: string }): StaffKey | null {
  const password = env.STAFF_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD) return null;
  const key = createHmac("sha256", env.SESSION_SECRET || password).update("shiplee-staff-session-v1").digest();
  return { password, key };
}

/** Compared by their digests, so neither the length nor the content of the password shows in the time taken. */
export function passwordMatches(given: string, staff: StaffKey): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(staff.password).digest();
  return timingSafeEqual(a, b);
}

const sign = (staff: StaffKey, payload: string) => createHmac("sha256", staff.key).update(payload).digest("base64url");

export function makeSession(staff: StaffKey, now: Date): string {
  const ends = Math.floor(now.getTime() / 1000) + SESSION_HOURS * 3600;
  const payload = `v1.${ends}`;
  return `${payload}.${sign(staff, payload)}`;
}

export function sessionValid(staff: StaffKey, value: string | undefined, now: Date): boolean {
  if (!value) return false;
  const match = /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const [, payload, ends, signature] = match as unknown as [string, string, string, string];
  const expected = Buffer.from(sign(staff, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(ends) * 1000 > now.getTime();
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
