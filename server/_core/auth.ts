/**
 * Session authentication, self-contained.
 *
 * Replaces the previous Manus OAuth integration. A session is a JWT signed with
 * JWT_SECRET, carried in an httpOnly cookie, holding only the user's id — the
 * record is re-read on every request, so a change of role or a deleted account
 * takes effect immediately instead of lingering until the token expires.
 *
 * No third-party identity provider and no new dependency: `jose` was already
 * here for signing, and password hashing uses Node's own scrypt.
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { parse as parseCookies } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { ENV } from "./env";

const ISSUER = "netlet";
const AUDIENCE = "netlet-web";
export const SESSION_MAX_AGE_MS = ONE_YEAR_MS;

function secretKey(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required to issue or verify sessions");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function signSession(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(new Date(Date.now() + SESSION_MAX_AGE_MS))
    .sign(secretKey());
}

/** Returns the user id, or null for anything unverifiable. Never throws. */
export async function verifySession(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const userId = Number(payload.sub);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    // Expired, tampered with, or signed under a rotated secret. All are simply
    // "not signed in" — an invalid cookie must not fail the request.
    return null;
  }
}

/** Reads the session cookie and resolves the current user, or null. */
export async function authenticateRequest(req: Request): Promise<User | null> {
  // Parsed here rather than via cookie-parser: the app registers no such
  // middleware, and `cookie` is already a dependency.
  const token = parseCookies(req.headers.cookie ?? "")[COOKIE_NAME];
  const userId = await verifySession(token);
  if (userId === null) return null;
  return (await getUserById(userId)) ?? null;
}
