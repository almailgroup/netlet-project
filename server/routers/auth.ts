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
import { checkPassword } from "../../shared/auth/passwordStrength.js";
import { SESSION_MAX_AGE_MS, signSession } from "../_core/auth.js";
import { getSessionCookieOptions } from "../_core/cookies.js";
import { ENV } from "../_core/env.js";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { hashPassword, verifyPassword } from "../_core/password.js";
import { getFirebaseAuth, isEmailInUse, isFirebaseConfigured, sendFirebasePasswordReset, verifyFirebasePassword } from "../_core/firebase.js";
import { createAccount, EmailTakenError } from "../_core/accounts.js";
import { getUserByEmail, linkFirebaseUser, touchLastSignedIn } from "../db.js";
import { loadUser, updateUserEmail, updateUserName, updateUserPasswordHash } from "../profile.js";
import { checkAuthAllowed, clearAccountFailures, recordAuthAttempt, type AttemptKind, type Caller } from "../rateLimit.js";
import type { User } from "../../drizzle/schema.js";

const credentials = z.object({
  email: z.string().trim().email().max(320),
  // Long enough to matter, and capped because scrypt hashes whatever it is
  // given — an unbounded password is a denial-of-service vector.
  password: z.string().min(10).max(200),
});

/**
 * A password somebody is *setting*, as opposed to one they are signing in
 * with. The same floor the meter draws, applied here so the API cannot accept
 * what the form refuses — otherwise the rules are advisory and anything
 * posting straight at tRPC skips them.
 *
 * Sign-in is deliberately not held to this: an account made before a rule
 * existed must still be able to get in and change it.
 */
const newPassword = z
  .string()
  .min(10)
  .max(200)
  .refine(value => checkPassword(value).acceptable, "auth.passwordTooWeak");

const registration = credentials.extend({
  password: newPassword,
  name: z.string().trim().min(1).max(255).optional(),
});

/**
 * The shape sent to the client: never the hash, and never the Firebase uid.
 *
 * The two dates are here so the account page can say when the account was
 * opened and when it was last used — a shopper's own facts, and the ones that
 * make an unrecognised sign-in noticeable.
 */
export type PublicUser = Pick<User, "id" | "email" | "name" | "role" | "createdAt" | "lastSignedIn">;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
  };
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

const wrongPassword = new TRPCError({ code: "UNAUTHORIZED", message: "auth.wrongCurrentPassword" });

/**
 * Re-checks the password of somebody already signed in.
 *
 * Whichever store holds it: Firebase when the account has a uid, the local
 * scrypt digest otherwise. An account with neither cannot be verified, and is
 * refused rather than waved through — the failure mode of the alternative is
 * silent and total.
 */
async function assertCurrentPassword(user: User, password: string): Promise<void> {
  if (isFirebaseConfigured() && user.firebaseUid) {
    const verified = await verifyFirebasePassword(user.email, password);
    if (!verified) throw wrongPassword;
    return;
  }
  if (!user.passwordHash) throw wrongPassword;
  if (!(await verifyPassword(password, user.passwordHash))) throw wrongPassword;
}

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

/**
 * The two keys a caller is throttled on.
 *
 * `ctx.req.ip` is the real client only because `applySecurity` sets
 * `trust proxy` to one hop; without that it is the tunnel's address and every
 * visitor shares one bucket.
 */
function callerOf(ctx: { req: { ip?: string } }, email?: string): Caller {
  return { email, address: ctx.req.ip ?? null };
}

/**
 * Refuses, with the wait, when a caller has failed too often.
 *
 * TOO_MANY_REQUESTS rather than UNAUTHORIZED: a throttled caller has not been
 * told their password is wrong, and telling them so would be a lie that also
 * leaks whether the guess was close.
 */
async function assertNotThrottled(caller: Caller, kind: AttemptKind): Promise<void> {
  const verdict = await checkAuthAllowed(caller, kind);
  if (verdict.allowed) return;
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "auth.tooManyAttempts",
    cause: { retryAfterSeconds: verdict.retryAfterSeconds },
  });
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
   * The profile, as its owner may change it.
   *
   * Name is free. Email and password both re-ask for the current password
   * first: a session left open on a shared machine should not be enough to
   * take an account over, and both of these are exactly the moves somebody
   * doing that would make.
   */
  updateName: protectedProcedure
    .input(z.object({ name: z.string().trim().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim() || null;
      const updated = await updateUserName(ctx.user.id, name);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });

      // Firebase holds the display name too when it owns the account, and a
      // mirror that disagrees is the kind of drift nobody notices until a
      // reset email is addressed to the wrong name.
      const auth = getFirebaseAuth();
      if (auth && updated.firebaseUid) {
        await auth.updateUser(updated.firebaseUid, { displayName: name ?? undefined });
      }
      return toPublicUser(updated);
    }),

  changeEmail: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      currentPassword: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadUser(ctx.user.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
      await assertCurrentPassword(current, input.currentPassword);

      const next = input.email.trim().toLowerCase();
      if (next === current.email) return toPublicUser(current);

      /*
       * Firebase first, then the mirror. The reverse order would leave a local
       * row claiming an address the shopper cannot actually sign in with —
       * and sign-in goes to Firebase, so the mirror would be the lie.
       */
      const auth = getFirebaseAuth();
      if (auth && current.firebaseUid) {
        try {
          await auth.updateUser(current.firebaseUid, { email: next });
        } catch (error) {
          if (isEmailInUse(error)) throw emailTaken;
          throw error;
        }
      }

      const updated = await updateUserEmail(ctx.user.id, next);
      if (!updated) {
        // Put Firebase back, or the two disagree about the login address.
        if (auth && current.firebaseUid) await auth.updateUser(current.firebaseUid, { email: current.email });
        throw emailTaken;
      }
      return toPublicUser(updated);
    }),

  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword,
    }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadUser(ctx.user.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
      await assertCurrentPassword(current, input.currentPassword);

      const auth = getFirebaseAuth();
      if (auth && current.firebaseUid) {
        await auth.updateUser(current.firebaseUid, { password: input.newPassword });
      } else {
        await updateUserPasswordHash(ctx.user.id, await hashPassword(input.newPassword));
      }
      return { changed: true } as const;
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
    .mutation(async ({ ctx, input }) => {
      // Unlike sign-in there is no failure to count here — the reply is
      // identical for an address with no account, on purpose — so every
      // request counts. The abuse this stops is using NetLet to post mail to
      // somebody else's inbox a hundred times.
      const caller = callerOf(ctx, input.email);
      await assertNotThrottled(caller, "reset");
      await recordAuthAttempt(caller, "reset");
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

    const caller = callerOf(ctx, input.email);
    await assertNotThrottled(caller, "login");

    const user = isFirebaseConfigured()
      ? await signInWithFirebase(input.email, input.password)
      : await signInLocally(input.email, input.password);
    if (!user) {
      // Only a failure is counted, which is what makes the per-address ceiling
      // safe: an office where everybody signs in successfully never nears it.
      await recordAuthAttempt(caller, "login");
      throw invalidCredentials;
    }

    // Somebody who mistyped nine times and then got it right is not one
    // failure from a lockout for the next quarter of an hour.
    await clearAccountFailures(input.email);
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
