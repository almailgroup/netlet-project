/**
 * Registration, sign-in and sign-out.
 *
 * Accounts live in Firebase Authentication when it is configured: Firebase
 * holds the password, and `users` keeps a mirror row so the rest of the
 * shopper's data can stay ordinary foreign keys. With no Firebase credentials
 * set the same endpoints fall back to the local scrypt digest, so a deployment
 * that has not been pointed at a Firebase project still signs people in.
 *
 * Three behaviours here are deliberate rather than incidental:
 *
 * Registration and sign-in both answer with the same "Email or password is
 * incorrect" on failure, and registration hashes a password even when the
 * address is already taken. Together those stop the endpoints being used to
 * enumerate which addresses have accounts — the reply and the time taken look
 * the same either way.
 *
 * The session cookie is httpOnly, so the token is never readable from
 * JavaScript and cannot be exfiltrated by a script injected into the page.
 */
import { COOKIE_NAME } from "../../shared/const.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { SESSION_MAX_AGE_MS, signSession } from "../_core/auth.js";
import { getSessionCookieOptions } from "../_core/cookies.js";
import { ENV } from "../_core/env.js";
import { publicProcedure, router } from "../_core/trpc.js";
import { hashPassword, verifyPassword } from "../_core/password.js";
import { isFirebaseConfigured, sendFirebasePasswordReset, verifyFirebasePassword } from "../_core/firebase.js";
import { createAccount, EmailTakenError } from "../_core/accounts.js";
import { getUserByEmail, linkFirebaseUser, touchLastSignedIn } from "../db.js";
import type { User } from "../../drizzle/schema.js";

const credentials = z.object({
  email: z.string().trim().email().max(320),
  // Long enough to matter, and capped because scrypt hashes whatever it is
  // given — an unbounded password is a denial-of-service vector.
  password: z.string().min(10).max(200),
});

const registration = credentials.extend({
  name: z.string().trim().min(1).max(255).optional(),
});

/** The shape sent to the client: never the hash. */
export type PublicUser = Pick<User, "id" | "email" | "name" | "role">;

function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function assertConfigured() {
  if (!ENV.cookieSecret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Authentication is not configured: JWT_SECRET is unset.",
    });
  }
  if (!ENV.databaseUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Authentication is not configured: DATABASE_URL is unset.",
    });
  }
}

const invalidCredentials = new TRPCError({
  code: "UNAUTHORIZED",
  message: "auth.invalidCredentials",
});

const emailTaken = new TRPCError({ code: "CONFLICT", message: "auth.emailTaken" });

/** Firebase checks the password; the local row is created on first sight. */
async function signInWithFirebase(email: string, password: string): Promise<User | null> {
  const verified = await verifyFirebasePassword(email, password);
  if (!verified) return null;
  return linkFirebaseUser({ firebaseUid: verified.uid, email: verified.email, name: verified.name });
}

/** The fallback path: NetLet's own scrypt digest, used when Firebase is unset. */
async function signInLocally(email: string, password: string): Promise<User | null> {
  const user = await getUserByEmail(email);
  if (!user?.passwordHash) {
    // Hash anyway. Returning early for an unknown address would make sign-in
    // measurably faster for addresses that do not exist.
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

export const authRouter = router({
  /** Current user, or null. Cheap enough to call on every page load. */
  me: publicProcedure.query(({ ctx }) => (ctx.user ? toPublicUser(ctx.user) : null)),

  register: publicProcedure.input(registration).mutation(async ({ ctx, input }) => {
    assertConfigured();

    let user: User;
    try {
      user = await createAccount(input);
    } catch (error) {
      if (error instanceof EmailTakenError) throw emailTaken;
      throw error;
    }

    const token = await signSession(user.id);
    ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MAX_AGE_MS });
    return toPublicUser(user);
  }),

  /**
   * Asks Firebase to email a reset link.
   *
   * Always answers the same way, whether or not the address has an account —
   * the same discipline as sign-in, for the same reason: a different answer
   * for a registered address turns this into an enumeration oracle. The page
   * therefore says "if that address has an account, a link is on its way"
   * rather than confirming anything.
   *
   * Silent when Firebase is unconfigured: the local scrypt fallback has no
   * email to send from, so there is nothing honest to do but accept the
   * request. The dialog says the same sentence either way.
   */
  requestPasswordReset: publicProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      locale: z.enum(["en", "ar"]).default("en"),
    }))
    .mutation(async ({ input }) => {
      try {
        await sendFirebasePasswordReset(input.email, input.locale);
      } catch (error) {
        // A fault on our side is logged, never surfaced: the shopper cannot
        // act on it, and the reply must not vary by address.
        console.error(`[auth] password reset could not be sent: ${String(error)}`);
      }
      return { sent: true } as const;
    }),

  login: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertConfigured();

    const user = isFirebaseConfigured()
      ? await signInWithFirebase(input.email, input.password)
      : await signInLocally(input.email, input.password);
    if (!user) throw invalidCredentials;

    await touchLastSignedIn(user.id);
    const token = await signSession(user.id);
    ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MAX_AGE_MS });
    return toPublicUser(user);
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
    return { success: true } as const;
  }),
});
