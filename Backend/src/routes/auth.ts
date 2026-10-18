/**
 * Registration, sign-in and sign-out.
 *
 * Accounts live in **Supabase Auth** when it is configured, which is why a
 * registration appears under Authentication → Users in the Supabase dashboard;
 * `users` keeps a mirror row so the rest of the shopper's data can stay ordinary
 * foreign keys. A deployment with it unconfigured falls back to the local scrypt
 * digest, so this runs before any third-party account exists. Which of the two
 * holds a given password is `Backend/src/core/passwordStore.ts`'s business and not
 * this file's — every procedure below asks it rather than naming a service.
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
import { COOKIE_NAME } from "../../../Shared/const.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkPassword } from "../../../Shared/auth/passwordStrength.js";
import { SESSION_MAX_AGE_MS, SHORT_SESSION_MS, signSession } from "../core/auth.js";
import { getSessionCookieOptions } from "../core/cookies.js";
import { ENV } from "../core/env.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import {
  CodeNotSentError,
  EmailTakenError,
  finishRegistration,
  PasswordMismatchError,
  resendRegistrationCode,
  revertEmail,
  sendReset,
  setDisplayName,
  setEmail,
  setPassword,
  signIn,
  startRegistration,
  verifyCurrent,
  WeakPasswordError,
} from "../core/passwordStore.js";
import { captchaSiteKey, checkCaptcha } from "../core/captcha.js";
import { isCodeShaped, normaliseCode } from "../../../Shared/auth/emailCode.js";
import { touchLastSignedIn } from "../services/db.js";
import { loadUser, updateUserEmail, updateUserName } from "../services/profile.js";
import { checkAuthAllowed, clearAccountFailures, recordAuthAttempt, type AttemptKind, type Caller } from "../services/rateLimit.js";
import { recordReferral } from "../services/referral.js";
import type { User } from "../../database/schema.js";

/*
 * What signing in takes. **No length floor on the password**, only a cap:
 * the ten-character rule is for a password being *set* (`newPassword` below),
 * and holding sign-in to it refused every account whose password predates the
 * rule or was set by hand in the Supabase dashboard — before the password was
 * even checked, as "not in the shape we expected". Capped because scrypt
 * hashes whatever it is given, and an unbounded password is a
 * denial-of-service vector.
 */
const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
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

/*
 * Sign-in also says whether to remember the device. Absent means yes, which is
 * what every caller before the box existed expected.
 */
const signInInput = credentials.extend({ remember: z.boolean().optional() });

const registration = credentials.extend({
  password: newPassword,
  name: z.string().trim().min(1).max(255).optional(),
  /*
   * The referral code the new shopper arrived with (3.1.14), from `?ref=` on
   * whatever link a friend sent them. Optional and never validated here: a
   * code naming nobody is a quiet no rather than a failed registration, since
   * refusing an account over a mistyped invitation loses a customer to fix
   * nothing.
   */
  referral: z.string().trim().max(32).optional(),
  /* The token Google's "I'm not a robot" box handed the page. Asked for only
     while the check is configured (`captchaSiteKey`). */
  captcha: z.string().max(4000).optional(),
});

/**
 * Taking the code back. Everything registration took comes again, because the
 * account is made here and not before — the form still holds it all — and a
 * password may arrive below the floor only on the path from sign-in, where it
 * must already be the account's (`finishRegistration`).
 */
const verification = credentials.extend({
  code: z.string().trim().max(32),
  name: z.string().trim().min(1).max(255).optional(),
  referral: z.string().trim().max(32).optional(),
  remember: z.boolean().optional(),
});

/**
 * The shape sent to the client: never the hash, and never a store's uid.
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

/* The mail service will not send another code yet — Supabase's minute between
   mails to one address, or its hourly ceiling. Not the shopper's doing. */
const codeNotSent = new TRPCError({ code: "TOO_MANY_REQUESTS", message: "auth.codeNotSent" });

/** Sets the session cookie, for a week or for this browser only. */
async function startSession(
  ctx: { req: Parameters<typeof getSessionCookieOptions>[0]; res: { cookie: (name: string, value: string, options: object) => void } },
  userId: number,
  remember = true,
): Promise<void> {
  /* Not remembered: a cookie with no expiry, which the browser drops when it
     closes, round a token that lapses in a day for a browser that keeps it. */
  if (remember === false) {
    ctx.res.cookie(COOKIE_NAME, await signSession(userId, SHORT_SESSION_MS), getSessionCookieOptions(ctx.req));
  } else {
    ctx.res.cookie(COOKIE_NAME, await signSession(userId), { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MAX_AGE_MS });
  }
}

/**
 * Re-checks the password of somebody already signed in.
 *
 * Against the store that owns their account rather than the one new accounts go
 * to, which `verifyCurrent` decides — the two differ for a row written before
 * the current configuration. An account no store can vouch for is refused rather
 * than waved through: the failure mode of the alternative is silent and total.
 */
async function assertCurrentPassword(user: User, password: string): Promise<void> {
  if (!(await verifyCurrent(user, password))) throw wrongPassword;
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

  /**
   * What the Create account form needs before it is drawn: whether to draw
   * Google's box, and the public key it draws with. Null is "no box".
   */
  signupOptions: publicProcedure.query(() => ({ captchaSiteKey: captchaSiteKey() })),

  /**
   * The first half of registering: the human check, then a code to the address.
   *
   * Nothing is made in NetLet here. The account exists once the code comes
   * back through `verifyEmail` — an address nobody has shown they read is not
   * one to open an account on. Every request counts against the sender's
   * ceiling, sent or refused, because what is being protected is somebody
   * else's inbox.
   *
   * Answers `signedIn` only on a Supabase project that confirms addresses by
   * itself, where no code is sent and the account is made on the spot — the
   * configuration `pnpm preflight` warns about.
   */
  register: publicProcedure.input(registration).mutation(async ({ ctx, input }) => {
    assertConfigured();

    const caller = callerOf(ctx, input.email);
    await assertNotThrottled(caller, "codeSend");

    const human = await checkCaptcha(input.captcha, ctx.req.ip ?? null);
    if (human === "unavailable") throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.captchaUnavailable" });
    if (human === "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.captchaFailed" });

    await recordAuthAttempt(caller, "codeSend");
    let started;
    try {
      started = await startRegistration(input);
    } catch (error) {
      if (error instanceof EmailTakenError) throw emailTaken;
      if (error instanceof CodeNotSentError) throw codeNotSent;
      throw error;
    }

    if (started.status === "codeSent") return { status: "verify" as const, email: input.email.trim().toLowerCase() };

    if (input.referral) await recordReferral(started.user.id, input.referral);
    await startSession(ctx, started.user.id);
    return { status: "signedIn" as const, user: toPublicUser(started.user) };
  }),

  /**
   * The second half: the code, and the account made from it.
   *
   * A wrong code counts like a wrong password, against the address and the
   * account both, and a throttled caller is told so rather than told the code
   * is wrong — six digits are a million guesses, and a ceiling of ten a quarter
   * of an hour is what makes that a number nobody reaches.
   */
  verifyEmail: publicProcedure.input(verification).mutation(async ({ ctx, input }) => {
    assertConfigured();

    const caller = callerOf(ctx, input.email);
    await assertNotThrottled(caller, "codeMiss");

    const code = normaliseCode(input.code);
    if (!isCodeShaped(code)) {
      await recordAuthAttempt(caller, "codeMiss");
      throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
    }

    let user: User | null;
    try {
      user = await finishRegistration({ email: input.email, password: input.password, name: input.name ?? null, code });
    } catch (error) {
      if (error instanceof EmailTakenError) throw emailTaken;
      if (error instanceof PasswordMismatchError) throw invalidCredentials;
      if (error instanceof WeakPasswordError) throw new TRPCError({ code: "BAD_REQUEST", message: "auth.passwordTooWeak" });
      throw error;
    }
    if (!user) {
      await recordAuthAttempt(caller, "codeMiss");
      throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
    }

    /* Recorded, not paid. The points land when this account's first order is
       paid for — a scheme that pays at registration pays for registrations.
       Forgotten by the page once used, so an invitation cannot ride along on a
       second account made from the same browser. */
    if (input.referral) await recordReferral(user.id, input.referral);
    await touchLastSignedIn(user.id);
    await startSession(ctx, user.id, input.remember);
    return toPublicUser(user);
  }),

  /**
   * Sends the code again. The same reply whether or not anything was waiting
   * for that address, so it cannot be used to ask who is part-way through
   * registering; every request counts, as a reset does.
   */
  resendCode: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const caller = callerOf(ctx, input.email);
      await assertNotThrottled(caller, "codeSend");
      await recordAuthAttempt(caller, "codeSend");
      try {
        await resendRegistrationCode(input.email);
      } catch (error) {
        if (error instanceof CodeNotSentError) throw codeNotSent;
        console.error(`[auth] sign-up code could not be resent: ${String(error)}`);
      }
      return { sent: true } as const;
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

      // The store holds a display name too when it owns the account, and a
      // mirror that disagrees is the kind of drift nobody notices until a
      // reset email is addressed to the wrong name.
      await setDisplayName(updated, name);
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
       * The store first, then the mirror. The reverse order would leave a local
       * row claiming an address the shopper cannot actually sign in with — and
       * sign-in goes to the store, so the mirror would be the lie.
       */
      try {
        await setEmail(current, next);
      } catch (error) {
        if (error instanceof EmailTakenError) throw emailTaken;
        throw error;
      }

      const updated = await updateUserEmail(ctx.user.id, next);
      if (!updated) {
        // Put the store back, or the two disagree about the login address.
        await revertEmail(current, current.email);
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

      await setPassword(current, input.newPassword);
      return { changed: true } as const;
    }),

  /**
   * Asks whichever service is configured to email a reset link.
   *
   * Always answers the same way, whether or not the address has an account —
   * the same discipline as sign-in, for the same reason: a different answer
   * for a registered address turns this into an enumeration oracle. The page
   * therefore says "if that address has an account, a link is on its way"
   * rather than confirming anything.
   *
   * Silent when no service is configured: the local scrypt fallback has no
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
        await sendReset(input.email, input.locale);
      } catch (error) {
        // A fault on our side is logged, never surfaced: the shopper cannot
        // act on it, and the reply must not vary by address.
        console.error(`[auth] password reset could not be sent: ${String(error)}`);
      }
      return { sent: true } as const;
    }),

  login: publicProcedure.input(signInInput).mutation(async ({ ctx, input }) => {
    assertConfigured();

    const caller = callerOf(ctx, input.email);
    await assertNotThrottled(caller, "login");

    const user = await signIn(input.email, input.password);
    if (!user) {
      // Only a failure is counted, which is what makes the per-address ceiling
      // safe: an office where everybody signs in successfully never nears it.
      await recordAuthAttempt(caller, "login");
      throw invalidCredentials;
    }
    /* The right password on an account whose code never came back. Not a
       failure, and not "wrong password": the form asks for the code. */
    if (user === "unconfirmed") throw new TRPCError({ code: "FORBIDDEN", message: "auth.emailNotConfirmed" });

    // Somebody who mistyped nine times and then got it right is not one
    // failure from a lockout for the next quarter of an hour.
    await clearAccountFailures(input.email);
    await touchLastSignedIn(user.id);
    await startSession(ctx, user.id, input.remember);
    return toPublicUser(user);
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
    return { success: true } as const;
  }),
});
