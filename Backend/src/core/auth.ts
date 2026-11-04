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
import { COOKIE_NAME, ONE_YEAR_MS } from "../../../Shared/const.js";
import { parse as parseCookies } from "cookie";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../database/schema.js";
import { getUserById } from "../services/db.js";
import { ENV } from "./env.js";

const ISSUER = "netlet";
const AUDIENCE = "netlet-web";
export const SESSION_MAX_AGE_MS = ONE_YEAR_MS;
/**
 * The longest a session lasts when somebody signs in without "Keep me signed
 * in" — on a shared or borrowed device. Its cookie has no expiry, so it ends
 * when the browser closes; this is the ceiling for a browser that restores its
 * session cookies on restart, which several do.
 */
export const SHORT_SESSION_MS = 24 * 60 * 60 * 1000;

function secretKey(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required to issue or verify sessions");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function signSession(userId: number, lifetimeMs: number = SESSION_MAX_AGE_MS): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(new Date(Date.now() + lifetimeMs))
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

/*
 * A pass onto a portal's own address (`Shared/portal.ts`): each address keeps
 * its own session cookie, so somebody signed in on the shop who belongs on a
 * portal is handed a pass that signs them in there once. It is a token of its
 * own kind — another audience, so a pass is never a session and a session
 * never a pass — good for `PORTAL_PASS_MS`, naming the account, the portal it
 * is for, whether the sign-in it came from was to be remembered, and an id the
 * server spends on first use (`spendPortalPass`).
 */
const PASS_AUDIENCE = "netlet-portal-pass";
export const PORTAL_PASS_MS = 60 * 1000;

export type PortalPass = { userId: number; side: "admin" | "vendor"; remember: boolean; id: string };

export async function signPortalPass(userId: number, side: PortalPass["side"], remember: boolean): Promise<string> {
  return new SignJWT({ sub: String(userId), side, remember })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PASS_AUDIENCE)
    .setJti(randomUUID())
    .setExpirationTime(new Date(Date.now() + PORTAL_PASS_MS))
    .sign(secretKey());
}

/** The pass's facts, or null for anything expired, tampered with or not a pass. Never throws. */
export async function verifyPortalPass(token: string): Promise<PortalPass | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: PASS_AUDIENCE });
    const userId = Number(payload.sub);
    const side = payload.side;
    if (!Number.isInteger(userId) || userId <= 0 || (side !== "admin" && side !== "vendor") || typeof payload.jti !== "string") return null;
    return { userId, side, remember: payload.remember !== false, id: payload.jti };
  } catch {
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
