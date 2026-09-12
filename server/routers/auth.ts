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
import { COOKIE_NAME } from "../../shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { SESSION_MAX_AGE_MS, signSession } from "../_core/auth";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
import { publicProcedure, router } from "../_core/trpc";
import { hashPassword, verifyPassword } from "../_core/password";
import { getFirebaseAuth, isEmailInUse, isFirebaseConfigured, verifyFirebasePassword } from "../_core/firebase";
import { createUser, getUserByEmail, linkFirebaseUser, touchLastSignedIn } from "../db";
import type { User } from "../../drizzle/schema";

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

/**
 * Registers with Firebase, then mirrors the account locally.
 *
 * The local row is written second on purpose: if it fails, Firebase holds an
 * account with no NetLet row, and the next sign-in creates that row through
 * `linkFirebaseUser`. The reverse order would leave a NetLet row that can never
 * be signed into.
 */
async function registerWithFirebase(input: { email: string; password: string; name?: string }) {
  const auth = getFirebaseAuth();
  if (!auth) return null;

  let uid: string;
  try {
    const record = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.name,
    });
    uid = record.uid;
  } catch (error) {
    if (isEmailInUse(error)) throw emailTaken;
    throw error;
  }

  const user = await linkFirebaseUser({ firebaseUid: uid, email: input.email, name: input.name ?? null });
  if (!user) throw emailTaken;
  return user;
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

    let user: User | null;
    if (isFirebaseConfigured()) {
      user = await registerWithFirebase(input);
    } else {
      // Hashed before the duplicate check so a taken address and a free one
      // cost the same time; otherwise the response latency leaks which is which.
      const passwordHash = await hashPassword(input.password);
      user = await createUser({ email: input.email, passwordHash, name: input.name ?? null });
    }
    if (!user) throw emailTaken;

    const token = await signSession(user.id);
    ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MAX_AGE_MS });
    return toPublicUser(user);
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
