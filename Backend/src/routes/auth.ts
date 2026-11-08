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
import { checkPassword, MIN_PASSWORD_LENGTH } from "../../../Shared/auth/passwordStrength.js";
import { SESSION_MAX_AGE_MS, SHORT_SESSION_MS, signFaceChallenge, signPortalPass, signSession, verifyFaceChallenge, verifyPortalPass } from "../core/auth.js";
import { getSessionCookieOptions } from "../core/cookies.js";
import { recordAudit } from "../services/audit.js";
import { ENV } from "../core/env.js";
import { protectedProcedure, publicProcedure, router } from "../core/trpc.js";
import {
  CodeNotSentError,
  EmailTakenError,
  finishRegistration,
  finishReset,
  finishResetWithCode,
  linkLanding,
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
import { tellAccountChanged } from "../services/notifications.js";
import { deleteAccount, deletionCheck } from "../services/accountDeletion.js";
import { saveNameParts } from "../services/profileDetails.js";
import { composeName, NAME_PART_MAX } from "../../../Shared/commerce/profileDetails.js";
import { checkAuthAllowed, clearAccountFailures, recordAuthAttempt, spendFaceChallenge, spendPortalPass, type AttemptKind, type Caller } from "../services/rateLimit.js";
import {
  BiometricKeyError,
  biometricKeyOwner,
  biometricKeysFor,
  registerBiometricKey,
  removeBiometricKey,
  signatureValid,
  touchBiometricKey,
} from "../services/biometricKeys.js";
import { BIOMETRIC_KEY_ID, DEVICE_NAME_MAX, biometricMessage } from "../../../Shared/auth/biometricKey.js";
import { resolveActor } from "../services/inventory.js";
import { isPortalPath, portalDomain, portalOfHost, portalSideFor, type PortalSide } from "../../../Shared/portal.js";
import { recordReferral } from "../services/referral.js";
import type { User } from "../../database/schema.js";
import { randomBytes } from "node:crypto";
import { appleWebClientId, audienceOf, revokeAppleAuthorization } from "../core/appleSignIn.js";
import {
  deleteSupabaseUser,
  isSupabaseAuthConfigured,
  sendSupabasePhoneCode,
  sendSupabaseSignInCode,
  signInSupabaseWithIdToken,
  signUpSupabaseUser,
  SupabaseEmailTaken,
  SupabaseMailLimited,
  SupabasePhoneOff,
  supabaseExternalProviders,
  supabaseUserProviders,
  updateSupabaseUser,
  verifySupabasePhoneCode,
  verifySupabaseSignupCode,
  type IdTokenUser,
} from "../core/supabaseAuth.js";
import { addAccountEmail, findLoginByEmail, keepOwnerAdmin, linkPhoneAccount, linkProviderAccount } from "../services/logins.js";
import { kuwaitMobile } from "../../../Shared/auth/phone.js";
import { issueLocalCode, takeLocalCode } from "../core/localCodes.js";
import { smsReady } from "../core/sms.js";
import { saveDetails, detailsFor } from "../services/profileDetails.js";
import { googleIosClientId, googleWebClientId, namesOf } from "../core/googleSignIn.js";

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
  .min(MIN_PASSWORD_LENGTH)
  .max(200)
  .refine(value => checkPassword(value).acceptable, "auth.passwordTooWeak");

/*
 * Sign-in also says whether to remember the device. Absent means yes, which is
 * what every caller before the box existed expected.
 */
const signInInput = credentials.extend({
  remember: z.boolean().optional(),
  /* Signed in on the shop by somebody who belongs on a portal: hand back a
     pass that signs them in there too (`portalHandover`). The web asks; the
     app, which has no portal address to open, does not. */
  portal: z.boolean().optional(),
});

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
export type PublicUser = Pick<User, "id" | "email" | "phone" | "name" | "role" | "createdAt" | "lastSignedIn">;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
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

/**
 * Sets the session cookie, for a week or for this browser only.
 *
 * **An administrator signing in is on the audit trail** (3.6.3), from the one
 * place every session starts — sign-in, a registration that signs straight in,
 * and the emailed code — so no door onto an administrator's session skips it.
 * The address is kept with it: the question an administrator's sign-in answers
 * is "was that us", and the address is most of the answer.
 */
async function startSession(
  ctx: { req: Parameters<typeof getSessionCookieOptions>[0]; res: { cookie: (name: string, value: string, options: object) => void } },
  given: { id: number; email: string | null; role: string },
  remember = true,
): Promise<void> {
  /* The shop's owner is an administrator whatever happened since (`core/owner.ts`). */
  const user = await keepOwnerAdmin(given);
  /* Not remembered: a cookie with no expiry, which the browser drops when it
     closes, round a token that lapses in a day for a browser that keeps it. */
  if (remember === false) {
    ctx.res.cookie(COOKIE_NAME, await signSession(user.id, SHORT_SESSION_MS), getSessionCookieOptions(ctx.req));
  } else {
    ctx.res.cookie(COOKIE_NAME, await signSession(user.id), { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MAX_AGE_MS });
  }
  if (user.role === "admin") {
    await recordAudit(
      { id: user.id, email: user.email, role: "admin" },
      { action: "admin.signIn", subjectType: "session", subjectId: user.id, subjectLabel: user.email, after: { address: ctx.req.ip ?? null, remembered: remember } },
    );
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
/** Where a link in Supabase's mail lands, for this request: see `linkLanding`. */
function landingFor(req: { protocol?: string; headers?: { host?: string } }): string | undefined {
  const host = req.headers?.host;
  return linkLanding(host ? `${req.protocol ?? "https"}://${host}` : undefined);
}

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

type RequestLike = { protocol?: string; hostname?: string; headers?: { host?: string } };

/** The host a request came to, without its port. */
function hostOf(req: RequestLike): string {
  return (req.hostname ?? req.headers?.host ?? "").replace(/:\d+$/, "").toLowerCase();
}

/**
 * The domain the portals hang from, for this request: the setting, or — on a
 * portal's own address, which is a portal by its name (`portalOfHost`) — the
 * domain that address hangs from. Never guessed from the shop's own address,
 * since a shop whose `admin.` name does not answer would send people nowhere.
 */
function portalDomainFor(req: RequestLike): string | null {
  return portalDomain(process.env.PORTAL_DOMAIN) ?? portalOfHost(hostOf(req), null)?.domain ?? null;
}

/** A portal's origin as this request would reach it: the scheme and port it came in on. */
function portalOriginFor(req: RequestLike, side: PortalSide, domain: string): string {
  const port = /:(\d+)$/.exec(req.headers?.host ?? "")?.[1];
  const scheme = req.protocol === "http" ? "http" : "https";
  return `${scheme}://${side}.${domain}${port ? `:${port}` : ""}`;
}

/**
 * Where somebody signed in here goes to be signed in on their portal too: the
 * portal's sign-in page with a one-time pass in the address's fragment (never
 * its path or query, so no server log, proxy or `Referer` carries it), and the
 * page to land on after. Null for a shopper, while the portals have no
 * addresses of their own, and on the portal they belong on already.
 */
async function portalHandover(
  ctx: { req: RequestLike },
  user: { id: number; role: string },
  next: string | null,
  remember: boolean,
): Promise<{ side: PortalSide; url: string } | null> {
  const domain = portalDomainFor(ctx.req);
  if (!domain) return null;
  const side = portalSideFor(await resolveActor(user));
  if (!side) return null;
  if (portalOfHost(hostOf(ctx.req), domain)?.side === side) return null;
  const pass = await signPortalPass(user.id, side, remember);
  const landing = next && isPortalPath(next) ? next : "/admin";
  return { side, url: `${portalOriginFor(ctx.req, side, domain)}/signin?next=${encodeURIComponent(landing)}#pass=${pass}` };
}

/* One answer for every pass that cannot sign anybody in — expired, spent,
   forged, for the other portal, or for an account that no longer belongs
   there — so a page offered one cannot tell them apart. */
const passRefused = new TRPCError({ code: "UNAUTHORIZED", message: "auth.portalPassRefused" });

/**
 * What Apple hands the page or the app after a sign-in: the identity token,
 * the nonce it was made for — raw here, hashed in what Apple signed — and the
 * one-time authorization code, which is only needed to unlink the Apple ID
 * when an account is deleted.
 */
const appleProof = z.object({
  idToken: z.string().min(20).max(8000),
  nonce: z.string().min(16).max(200),
  code: z.string().max(2000).optional(),
});

type IdProvider = "apple" | "google";

/** Each provider's own words for what can go wrong — message keys. */
const PROVIDER_WORDS = {
  apple: { unavailable: "auth.appleUnavailable", refused: "auth.appleRefused", unreachable: "auth.appleUnreachable", taken: "auth.appleEmailTaken", notThis: "auth.appleNotThisAccount" },
  google: { unavailable: "auth.googleUnavailable", refused: "auth.googleRefused", unreachable: "auth.googleUnreachable", taken: "auth.googleEmailTaken", notThis: "auth.googleNotThisAccount" },
} as const;

/** Whether Supabase has a provider switched on, read from its public settings. */
async function providerOn(provider: IdProvider): Promise<boolean> {
  return (await supabaseExternalProviders())?.[provider] === true;
}

/**
 * Asks Supabase about a provider's token. A refusal is null; a Supabase that
 * cannot be reached is the "could not reach the service" fault, never a
 * refusal of the person.
 */
async function providerUser(provider: IdProvider, proof: { idToken: string; nonce: string }): Promise<IdTokenUser | null> {
  try {
    return await signInSupabaseWithIdToken(provider, proof.idToken, proof.nonce);
  } catch (error) {
    console.error(`[auth] ${provider} sign-in could not reach Supabase: ${error instanceof Error ? error.message : String(error)}`);
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: PROVIDER_WORDS[provider].unreachable });
  }
}

const providerSignInInput = appleProof.extend({
  firstName: z.string().trim().max(NAME_PART_MAX).optional(),
  lastName: z.string().trim().max(NAME_PART_MAX).optional(),
  remember: z.boolean().optional(),
  referral: z.string().trim().max(32).optional(),
  portal: z.boolean().optional(),
});

/**
 * Signs in — or opens an account — with Apple or Google. One door for both,
 * since neither provider's sheet tells them apart: an account there NetLet
 * has met signs into its account, and a new one is an account made now, its
 * address already vouched for, so no code is emailed.
 *
 * Refused, never adopted, for an address another account holds by a
 * password NetLet keeps itself (`linkProviderAccount`): that account signs in
 * the way it was made. An account whose password Supabase holds is linked by
 * Supabase, and lands here as the account it was.
 */
async function providerSignIn(
  ctx: Parameters<typeof startSession>[0] & { req: RequestLike & { ip?: string } },
  provider: IdProvider,
  input: z.infer<typeof providerSignInInput>,
) {
  assertConfigured();
  const words = PROVIDER_WORDS[provider];
  const caller = callerOf(ctx);
  await assertNotThrottled(caller, "login");
  if (!(await providerOn(provider))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: words.unavailable });

  const found = await providerUser(provider, input);
  if (!found || !found.email) {
    await recordAuthAttempt(caller, "login");
    throw new TRPCError({ code: "UNAUTHORIZED", message: words.refused });
  }

  /* Apple hands the name to the page, the first time only; Google's token
     carries it every time. */
  const fromToken = provider === "google" ? namesOf(input.idToken) : { first: null, last: null };
  const first = input.firstName ?? fromToken.first ?? "";
  const last = input.lastName ?? fromToken.last ?? "";
  const name = first || last ? composeName(first, last) : found.name;
  const link = await linkProviderAccount({ uid: found.uid, email: found.email, emailConfirmed: found.emailConfirmed, name });
  if (link.kind === "taken") throw new TRPCError({ code: "CONFLICT", message: words.taken });

  const user = link.user;
  if (link.kind === "created") {
    if (first && last) await saveNameParts(user.id, first, last);
    if (input.referral) await recordReferral(user.id, input.referral);
    /* An address somebody began registering with a password and never
       confirmed, now confirmed by the provider: the password was typed by
       whoever began that sign-up, who need not be the person holding the
       provider's account, so it is replaced with one nobody knows. The owner
       sets their own through Forgot your password. */
    if (found.signedUp && found.providers.includes("email")) {
      await updateSupabaseUser(found.uid, { password: randomBytes(32).toString("base64url") });
    }
  }

  await touchLastSignedIn(user.id);
  await startSession(ctx, user, input.remember);
  return {
    ...toPublicUser(user),
    created: link.kind === "created",
    portal: input.portal ? await portalHandover(ctx, user, null, input.remember !== false) : null,
  };
}

/**
 * Whether "Continue with phone number" can be offered: with Supabase, its
 * phone sign-in switched on and NetLet able to text (`smsReady`, with the
 * hook's secret, since Supabase hands the code to the hook); with none
 * (`pnpm dev`), always, the code going to the log.
 */
async function phoneReady(external?: Record<string, boolean> | null): Promise<boolean> {
  if (!isSupabaseAuthConfigured()) return true;
  const settings = external === undefined ? await supabaseExternalProviders() : external;
  return settings?.phone === true && smsReady() && Boolean(ENV.smsHookSecret);
}

/** Has a code texted to a Kuwaiti mobile, by Supabase, or written to the log. */
async function textCode(phone: string): Promise<void> {
  if (!isSupabaseAuthConfigured()) {
    issueLocalCode(phone, "phone");
    return;
  }
  try {
    await sendSupabasePhoneCode(phone);
  } catch (error) {
    if (error instanceof SupabaseMailLimited) throw codeNotSent;
    if (error instanceof SupabasePhoneOff) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable" });
    console.error(`[auth] a phone code could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.phoneUnreachable" });
  }
}

/** The Supabase user a texted code proves (no uid with no Supabase), or null. */
async function checkTextedCode(phone: string, code: string): Promise<{ uid: string | null } | null> {
  if (!isCodeShaped(code)) return null;
  if (!isSupabaseAuthConfigured()) return takeLocalCode(phone, code, "phone") ? { uid: null } : null;
  try {
    const user = await verifySupabasePhoneCode(phone, code);
    return user ? { uid: user.uid } : null;
  } catch (error) {
    console.error(`[auth] a phone code could not be checked: ${error instanceof Error ? error.message : String(error)}`);
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.phoneUnreachable" });
  }
}

/**
 * Emails a sign-in code to an account that exists, and nothing anywhere else,
 * without saying which: Supabase sends to the users it holds (`create_user:
 * false`), and with no Supabase the code is written to the log for a local
 * account. **A refusal from the mail service is logged, never said**: GoTrue
 * holds back a second code to an address it mailed a minute ago, and only to
 * an address it holds, so "wait a moment" would answer who is registered —
 * the reset's rule. The form waits out that minute before "Send it again".
 */
async function emailSignInCode(email: string, returnTo?: string): Promise<void> {
  try {
    if (isSupabaseAuthConfigured()) {
      await sendSupabaseSignInCode(email, returnTo);
      return;
    }
    const user = await findLoginByEmail(email);
    if (user && user.passwordHash) issueLocalCode(email, "sign-in");
  } catch (error) {
    if (!(error instanceof SupabaseMailLimited)) {
      console.error(`[auth] a sign-in code could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Whether any account already holds this address. */
async function addressHeld(email: string): Promise<boolean> {
  return Boolean(await findLoginByEmail(email));
}

/** The proven number as the driver's, unless the account already gave one. */
async function rememberDriverPhone(userId: number, phone: string): Promise<void> {
  try {
    const details = await detailsFor(userId);
    if (!details.phone) await saveDetails(userId, { phone });
  } catch (error) {
    console.warn(`[auth] the driver's number was not saved for account ${userId}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
   * Which other ways in are switched on. Apple in the app while Supabase has
   * Apple on, and on the website too once a Services ID is set — `web` is that
   * id, which the page hands Apple's own script. Google wherever its client id
   * for that side is set and Supabase has Google on — `web` and `ios` are the
   * ids the page and the app hand Google.
   */
  providers: publicProcedure.query(async () => {
    const external = await supabaseExternalProviders();
    const apple = external?.apple === true;
    const google = external?.google === true;
    return {
      apple: { app: apple, web: apple ? appleWebClientId() : null },
      google: { web: google ? googleWebClientId() : null, ios: google ? googleIosClientId() : null },
      phone: await phoneReady(external),
    };
  }),

  /** Signs in, or opens an account, with Apple (`providerSignIn`). */
  appleSignIn: publicProcedure
    .input(providerSignInInput)
    .mutation(({ ctx, input }) => providerSignIn(ctx, "apple", input)),

  /** Signs in, or opens an account, with Google (`providerSignIn`). */
  googleSignIn: publicProcedure
    .input(providerSignInInput)
    .mutation(({ ctx, input }) => providerSignIn(ctx, "google", input)),

  /**
   * "Continue with phone number", first half: a six-digit code by text to a
   * Kuwaiti mobile (`kuwaitMobile`, the only numbers NetLet texts). The same
   * reply whether the number has an account or not — signing in and opening
   * one are one door — and every send counts, by address and by number, the
   * sign-up code's `codeSend`; Google's "I'm not a robot" box guards it while
   * it is configured, as it guards Create account, since every text costs.
   */
  phoneStart: publicProcedure
    .input(z.object({ phone: z.string().trim().min(1).max(32), captcha: z.string().max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const phone = kuwaitMobile(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "auth.phoneInvalid" });
      if (!(await phoneReady())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable" });
      const caller = callerOf(ctx, phone);
      await assertNotThrottled(caller, "codeSend");
      const human = await checkCaptcha(input.captcha, ctx.req.ip ?? null);
      if (human === "unavailable") throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.captchaUnavailable" });
      if (human === "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.captchaFailed" });
      await recordAuthAttempt(caller, "codeSend");
      await textCode(phone);
      return { sent: true as const, phone };
    }),

  /**
   * The second half: the code, and the account it opens. An account already
   * signing in with this number is that account; a new one has no email, and
   * the answer's `needsEmail` is what has the form offer adding one, which
   * its owner may skip. A wrong code counts as a `codeMiss`, by address and by
   * number, the emailed code's ceiling.
   */
  phoneVerify: publicProcedure
    .input(z.object({
      phone: z.string().trim().min(1).max(32),
      code: z.string().trim().min(1).max(20),
      remember: z.boolean().optional(),
      referral: z.string().trim().max(32).optional(),
      portal: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const phone = kuwaitMobile(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "auth.phoneInvalid" });
      const caller = callerOf(ctx, phone);
      await assertNotThrottled(caller, "codeMiss");
      const code = normaliseCode(input.code);
      if (!isCodeShaped(code)) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
      }
      const proven = await checkTextedCode(phone, code);
      if (!proven) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.phoneCodeWrong" });
      }
      const link = await linkPhoneAccount({ uid: proven.uid, phone });
      if (link.kind === "taken") throw new TRPCError({ code: "CONFLICT", message: "auth.phoneTaken" });
      const user = link.user;
      if (link.kind === "created") {
        if (input.referral) await recordReferral(user.id, input.referral);
        /* The number just proven is the one a driver calls, until its owner
           says otherwise; quietly skipped before migration 0070 is pasted. */
        await rememberDriverPhone(user.id, phone);
      }
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, input.remember);
      return {
        ...toPublicUser(user),
        created: link.kind === "created",
        needsEmail: !user.email,
        portal: input.portal ? await portalHandover(ctx, user, null, input.remember !== false) : null,
      };
    }),

  /**
   * Adding an email to an account made with a phone, first half: a code to
   * the address, so a typo cannot hand the account to whoever holds it — an
   * address is where a forgotten password is sent. Through Supabase's own
   * sign-up mail, the "Confirm signup" template NetLet already prints the
   * code in; the address it parks there is removed once the code comes back.
   */
  addEmailStart: protectedProcedure
    .input(z.object({ email: z.string().trim().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadUser(ctx.user.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
      if (current.email) throw new TRPCError({ code: "BAD_REQUEST", message: "auth.emailAlreadyAdded" });
      const email = input.email.trim().toLowerCase();
      const caller = callerOf(ctx, email);
      await assertNotThrottled(caller, "codeSend");
      await recordAuthAttempt(caller, "codeSend");
      if (await addressHeld(email)) throw emailTaken;
      if (!isSupabaseAuthConfigured()) {
        issueLocalCode(email, "add-email");
        return { sent: true as const, email };
      }
      try {
        const started = await signUpSupabaseUser({ email, password: randomBytes(32).toString("base64url"), returnTo: landingFor(ctx.req) });
        /* A project that confirms addresses itself sends no code: there is
           nothing to prove, so the address it made is taken back and the
           form is told the mail could not be sent. */
        if (started.kind === "confirmed") {
          await deleteSupabaseUser(started.user.uid);
          throw codeNotSent;
        }
      } catch (error) {
        if (error instanceof SupabaseEmailTaken) throw emailTaken;
        if (error instanceof SupabaseMailLimited) throw codeNotSent;
        throw error;
      }
      return { sent: true as const, email };
    }),

  /** The second half: the code, then the address is the account's. */
  addEmailVerify: protectedProcedure
    .input(z.object({ email: z.string().trim().email().max(320), code: z.string().trim().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadUser(ctx.user.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
      if (current.email) throw new TRPCError({ code: "BAD_REQUEST", message: "auth.emailAlreadyAdded" });
      const email = input.email.trim().toLowerCase();
      const caller = callerOf(ctx, email);
      await assertNotThrottled(caller, "codeMiss");
      const code = normaliseCode(input.code);
      if (!isCodeShaped(code)) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
      }
      if (isSupabaseAuthConfigured()) {
        const parked = await verifySupabaseSignupCode(email, code);
        if (!parked) {
          await recordAuthAttempt(caller, "codeMiss");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
        }
        /* The address was parked on a Supabase user of its own to be proven;
           proven, it moves to the account's. */
        await deleteSupabaseUser(parked.uid);
        if (current.supabaseUid) {
          try {
            await updateSupabaseUser(current.supabaseUid, { email, emailConfirmed: true });
          } catch (error) {
            if (error instanceof SupabaseEmailTaken) throw emailTaken;
            throw error;
          }
        }
      } else if (!takeLocalCode(email, code, "add-email")) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
      }
      const updated = await addAccountEmail(current.id, email);
      if (!updated) throw emailTaken;
      return toPublicUser(updated);
    }),

  /**
   * How the signed-in account signs in, for the pages that ask for a password
   * again: deleting the account confirms with Apple for an Apple account, and
   * the password card says there is none to change. When Supabase cannot say,
   * the answer is the password, as it always was.
   */
  myProviders: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (user.supabaseUid) {
      const named = await supabaseUserProviders(user.supabaseUid);
      if (named) return { password: named.includes("email"), apple: named.includes("apple"), google: named.includes("google"), phone: Boolean(user.phone) };
    }
    /* An account made with a phone alone, with no Supabase to ask (`pnpm dev`). */
    if (!user.email) return { password: false, apple: false, google: false, phone: true };
    return { password: true, apple: false, google: false, phone: Boolean(user.phone) };
  }),

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
      started = await startRegistration({ ...input, returnTo: landingFor(ctx.req) });
    } catch (error) {
      if (error instanceof EmailTakenError) throw emailTaken;
      if (error instanceof CodeNotSentError) throw codeNotSent;
      throw error;
    }

    if (started.status === "codeSent") return { status: "verify" as const, email: input.email.trim().toLowerCase() };

    if (input.referral) await recordReferral(started.user.id, input.referral);
    await startSession(ctx, started.user);
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
    await startSession(ctx, user, input.remember);
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
        await resendRegistrationCode(input.email, landingFor(ctx.req));
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

  /**
   * The name as "Your profile" asks for it, a first and a last name (the
   * owner's reference). The parts are kept, and the display name every other
   * page reads is written from them, through the same two writes as
   * `updateName`.
   */
  updateNameParts: protectedProcedure
    .input(z.object({
      firstName: z.string().trim().min(1, "profile.nameRequired").max(NAME_PART_MAX, "profile.nameTooLong"),
      lastName: z.string().trim().min(1, "profile.nameRequired").max(NAME_PART_MAX, "profile.nameTooLong"),
    }))
    .mutation(async ({ ctx, input }) => {
      await saveNameParts(ctx.user.id, input.firstName, input.lastName);
      const name = composeName(input.firstName, input.lastName);
      const updated = await updateUserName(ctx.user.id, name);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
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
        if (current.email) await revertEmail(current, current.email);
        throw emailTaken;
      }
      await tellAccountChanged(updated.id, "email", { email: next });
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
      await tellAccountChanged(current.id, "password");
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
        await sendReset(input.email, input.locale, landingFor(ctx.req));
      } catch (error) {
        // A fault on our side is logged, never surfaced: the shopper cannot
        // act on it, and the reply must not vary by address.
        console.error(`[auth] password reset could not be sent: ${String(error)}`);
      }
      return { sent: true } as const;
    }),

  /**
   * The end of a reset: the new password, set with the token Supabase handed
   * back when the link in the mail was opened, and then signed in with.
   *
   * The token is the proof the link was opened and is spent on this alone
   * (`setPasswordFromLink`). The new password is held to the floor every new
   * password is. Signing in afterwards goes through `signIn` like any other,
   * so a sign-up whose code never came back is sent its code here too rather
   * than let in — the reset link proves the inbox, but only the code makes a
   * shopper's account. A stale link counts against the address, as a wrong
   * code does.
   */
  completeReset: publicProcedure
    .input(z.object({ token: z.string().trim().min(20).max(4000), password: newPassword, remember: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const caller = callerOf(ctx);
      await assertNotThrottled(caller, "reset");

      const { outcome, email } = await finishReset(input.token, input.password);
      if (outcome === "same") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.resetSamePassword" });
      if (outcome === "weak") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.passwordTooWeak" });
      if (outcome !== "changed" || !email) {
        await recordAuthAttempt(caller, "reset");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.resetLinkExpired" });
      }

      const user = await signIn(email, input.password, landingFor(ctx.req));
      if (user === "unconfirmed") return { status: "verify" as const, email };
      if (!user) throw invalidCredentials;
      await tellAccountChanged(user.id, "password");
      await clearAccountFailures(email);
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, input.remember);
      return { status: "signedIn" as const, user: toPublicUser(user) };
    }),

  /**
   * The end of a reset by the six-digit code in the mail (on the owner's word:
   * "password recovery using a verification code sent to the registered
   * email"), with the new password, and then signed in with — `completeReset`
   * for the code rather than the link. A wrong code counts against the address
   * as a wrong sign-up code does; "wrong" answers a code, an expired code and
   * an address with no account alike.
   */
  resetWithCode: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(320), code: z.string().max(32), password: newPassword, remember: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const caller = callerOf(ctx, input.email);
      await assertNotThrottled(caller, "codeMiss");
      const code = normaliseCode(input.code);
      if (!isCodeShaped(code)) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
      }

      const { outcome, email } = await finishResetWithCode(input.email, code, input.password);
      if (outcome === "same") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.resetSamePassword" });
      if (outcome === "weak") throw new TRPCError({ code: "BAD_REQUEST", message: "auth.passwordTooWeak" });
      if (outcome !== "changed" || !email) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
      }

      const user = await signIn(email, input.password, landingFor(ctx.req));
      if (user === "unconfirmed") return { status: "verify" as const, email };
      if (!user) throw invalidCredentials;
      await tellAccountChanged(user.id, "password");
      await clearAccountFailures(email);
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, input.remember);
      return { status: "signedIn" as const, user: toPublicUser(user) };
    }),

  /**
   * "Sign in with a one-time code" (on the owner's word: "two options for
   * signing in … by password or by a one-time code"), first half: six digits
   * emailed to the account. The same reply for an address with no account,
   * so it cannot be used to ask who is registered, and every request counts,
   * by address and by email — a form that sends mail is a way to post into
   * somebody's inbox, the reset's reason.
   */
  codeStart: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const email = input.email.trim().toLowerCase();
      const caller = callerOf(ctx, email);
      await assertNotThrottled(caller, "codeSend");
      await recordAuthAttempt(caller, "codeSend");
      await emailSignInCode(email, landingFor(ctx.req));
      return { sent: true as const, email };
    }),

  /**
   * The second half: the code, and the account it signs into. The code proves
   * the inbox, which is a proof as strong as the password — so an account
   * Supabase holds that NetLet has no row for yet becomes one, Apple's rule
   * (`linkProviderAccount`): an address a NetLet account holds by another
   * credential is refused, never adopted, and a sign-up whose code never came
   * back has its password replaced with one nobody knows, since whoever typed
   * it need not be whoever reads the inbox. A wrong code counts as a
   * `codeMiss`, and "wrong" answers a wrong code, an expired one and an
   * address with no account alike.
   */
  codeSignIn: publicProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      code: z.string().trim().min(1).max(20),
      remember: z.boolean().optional(),
      portal: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const email = input.email.trim().toLowerCase();
      const caller = callerOf(ctx, email);
      await assertNotThrottled(caller, "codeMiss");
      const code = normaliseCode(input.code);
      if (!isCodeShaped(code)) {
        await recordAuthAttempt(caller, "codeMiss");
        throw new TRPCError({ code: "BAD_REQUEST", message: "auth.codeShape" });
      }

      let user: User | undefined;
      if (isSupabaseAuthConfigured()) {
        let proven;
        try {
          proven = await verifySupabaseSignupCode(email, code);
        } catch (error) {
          console.error(`[auth] a sign-in code could not be checked: ${error instanceof Error ? error.message : String(error)}`);
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "auth.codeUnreachable" });
        }
        if (!proven) {
          await recordAuthAttempt(caller, "codeMiss");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
        }
        const link = await linkProviderAccount({ uid: proven.uid, email: proven.email, emailConfirmed: true, name: proven.name });
        if (link.kind === "taken") throw new TRPCError({ code: "CONFLICT", message: "auth.codeUsePassword" });
        if (link.kind === "created" && proven.signedUp) {
          await updateSupabaseUser(proven.uid, { password: randomBytes(32).toString("base64url") });
        }
        user = link.user;
      } else {
        const found = takeLocalCode(email, code, "sign-in") ? await findLoginByEmail(email) : undefined;
        if (!found) {
          await recordAuthAttempt(caller, "codeMiss");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.codeWrong" });
        }
        user = found;
      }

      await clearAccountFailures(email);
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, input.remember);
      return { ...toPublicUser(user), portal: input.portal ? await portalHandover(ctx, user, null, input.remember !== false) : null };
    }),

  /**
   * Face ID, first half (`Shared/auth/biometricKey.ts`): a challenge for the
   * phone's key to sign. `active` says whether NetLet still holds that key —
   * told only to somebody who has the key's random id, so it is no way to ask
   * about an address — and lets the phone put its own key away rather than
   * ask for a face it cannot use.
   */
  biometricChallenge: publicProcedure
    .input(z.object({ keyId: z.string().regex(BIOMETRIC_KEY_ID) }))
    .mutation(async ({ input }) => ({
      challenge: await signFaceChallenge(input.keyId),
      active: (await biometricKeyOwner(input.keyId)) !== null,
    })),

  /**
   * Face ID, second half: the challenge signed by the phone's key, which the
   * phone does only after Face ID. Spent once, checked against the public half
   * NetLet keeps, and signed in like any other door. Every way it fails is one
   * refusal and counts against the address, except a key NetLet no longer
   * holds (turned off, or the account deleted), which says so, so the phone
   * forgets it and offers the password or a code.
   */
  biometricSignIn: publicProcedure
    .input(z.object({
      keyId: z.string().regex(BIOMETRIC_KEY_ID),
      challenge: z.string().min(20).max(2000),
      signature: z.string().min(16).max(400),
      remember: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const caller = callerOf(ctx);
      await assertNotThrottled(caller, "faceMiss");
      const failed = async () => {
        await recordAuthAttempt(caller, "faceMiss");
        return new TRPCError({ code: "UNAUTHORIZED", message: "auth.faceIdFailed" });
      };
      const challenge = await verifyFaceChallenge(input.challenge);
      if (!challenge || challenge.keyId !== input.keyId) throw await failed();
      const owner = await biometricKeyOwner(input.keyId);
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "auth.faceIdOff" });
      if (!signatureValid(owner.publicKey, biometricMessage(input.challenge), input.signature)) throw await failed();
      if (!(await spendFaceChallenge(challenge.id))) throw await failed();
      const { user } = owner;

      await touchBiometricKey(input.keyId);
      if (user.email) await clearAccountFailures(user.email);
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, input.remember);
      return { ...toPublicUser(user), portal: null };
    }),

  /**
   * Sets Face ID up on this phone for the account signed in: the public half of
   * the key the phone just made. Refused before migration 0078 is pasted
   * (`auth.faceIdUnavailable`), past `MAX_BIOMETRIC_KEYS` phones, and for a key
   * that is not a P-256 point.
   */
  biometricRegister: protectedProcedure
    .input(z.object({
      keyId: z.string().regex(BIOMETRIC_KEY_ID),
      publicKey: z.string().min(80).max(200),
      deviceName: z.string().max(DEVICE_NAME_MAX * 2).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        await registerBiometricKey(ctx.user.id, input);
      } catch (error) {
        if (error instanceof BiometricKeyError) {
          throw new TRPCError({ code: error.message === "auth.faceIdUnavailable" ? "PRECONDITION_FAILED" : "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
      return { ok: true } as const;
    }),

  /** The phones this account has Face ID set up on; `ready` is false until 0078 is pasted. */
  biometricKeys: protectedProcedure.query(({ ctx }) => biometricKeysFor(ctx.user.id)),

  /** Turns Face ID off for one of this account's phones. */
  biometricRemove: protectedProcedure
    .input(z.object({ keyId: z.string().regex(BIOMETRIC_KEY_ID) }))
    .mutation(async ({ ctx, input }) => ({ removed: await removeBiometricKey(ctx.user.id, input.keyId) })),

  login: publicProcedure.input(signInInput).mutation(async ({ ctx, input }) => {
    assertConfigured();

    const caller = callerOf(ctx, input.email);
    await assertNotThrottled(caller, "login");

    const user = await signIn(input.email, input.password, landingFor(ctx.req));
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
    await startSession(ctx, user, input.remember);
    return { ...toPublicUser(user), portal: input.portal ? await portalHandover(ctx, user, null, input.remember !== false) : null };
  }),

  /**
   * A pass onto the portal this account belongs on, for somebody already
   * signed in here: the shop's own `/admin` sending a store's owner on, or one
   * portal sending somebody who belongs on the other. Null when there is no
   * portal to send them to.
   */
  portalPass: protectedProcedure
    .input(z.object({ next: z.string().max(500).optional() }).optional())
    .mutation(({ ctx, input }) => portalHandover(ctx, ctx.user, input?.next ?? null, true)),

  /**
   * Spends a pass on the portal it was made for, which signs its account in
   * here — once. The account is asked again whether it belongs on this
   * portal, since rights taken away in the minute a pass lives must not ride
   * in on it.
   */
  portalHandoff: publicProcedure
    .input(z.object({ pass: z.string().min(20).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      const pass = await verifyPortalPass(input.pass);
      if (!pass) throw passRefused;
      const domain = portalDomainFor(ctx.req);
      if (!domain || portalOfHost(hostOf(ctx.req), domain)?.side !== pass.side) throw passRefused;
      const user = await loadUser(pass.userId);
      if (!user || portalSideFor(await resolveActor(user)) !== pass.side) throw passRefused;
      if (!(await spendPortalPass(pass.id))) throw passRefused;
      await touchLastSignedIn(user.id);
      await startSession(ctx, user, pass.remember);
      return toPublicUser(user);
    }),

  /**
   * What stands between the shopper and deleting their account, and the
   * points that would go with it — read by "Your profile" before anybody
   * presses Delete (`services/accountDeletion.ts`).
   */
  deletionCheck: protectedProcedure.query(({ ctx }) => deletionCheck(ctx.user)),

  /**
   * Deletes the signed-in account, for good, on the owner's word. Asks for
   * the password again — a session left open on a shared machine must not be
   * enough to erase somebody — checks what would refuse it again under a lock,
   * and ends this session; every other session finds no account and is signed
   * out with it.
   */
  deleteAccount: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1).max(200).optional(),
      /* An Apple account has no password to ask for, so it confirms with
         Apple instead — and the code Apple hands back is what unlinks the
         Apple ID once the account is gone. */
      apple: appleProof.optional(),
      /* A Google account the same way, by Google's confirmation. */
      google: appleProof.optional(),
      /* An account made with a phone confirms with a code texted to it
         (`phoneStart` with the account's own number). */
      phoneCode: z.string().trim().min(1).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadUser(ctx.user.id);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "auth.noAccount" });
      const confirmation = input.apple ? ("apple" as const) : input.google ? ("google" as const) : null;
      if (confirmation) {
        const found = await providerUser(confirmation, (input.apple ?? input.google)!);
        if (!found || !current.supabaseUid || found.uid !== current.supabaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: PROVIDER_WORDS[confirmation].notThis });
        }
      } else if (input.phoneCode && current.phone) {
        const caller = callerOf(ctx, current.phone);
        await assertNotThrottled(caller, "codeMiss");
        const proven = await checkTextedCode(current.phone, normaliseCode(input.phoneCode));
        if (!proven || (current.supabaseUid && proven.uid !== current.supabaseUid)) {
          await recordAuthAttempt(caller, "codeMiss");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "auth.phoneCodeWrong" });
        }
      } else if (input.currentPassword) {
        await assertCurrentPassword(current, input.currentPassword);
      } else {
        throw wrongPassword;
      }
      let outcome;
      try {
        outcome = await deleteAccount(current);
      } catch (error) {
        console.error(`[auth] could not delete account ${current.id}: ${String(error)}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "account.deleteFailed" });
      }
      if (!outcome.deleted) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `account.deleteBlocked.${outcome.blockers[0] ?? "admin"}` });
      }
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      if (input.apple) {
        const outcome = await revokeAppleAuthorization({ clientId: audienceOf(input.apple.idToken), code: input.apple.code });
        if (outcome !== "revoked") console.warn(`[auth] deleted account ${current.id} left its Apple ID linked: ${outcome}`);
      }
      return { deleted: true } as const;
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
    return { success: true } as const;
  }),
});
