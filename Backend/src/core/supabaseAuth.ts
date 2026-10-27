/**
 * Supabase Auth: where NetLet's registered accounts live.
 *
 * This is the reason a registration appears under **Authentication → Users** in
 * the Supabase dashboard. It did not before, and the reason was simple: nothing
 * wrote there. Supabase's Authentication page reads `auth.users`, which belongs
 * to Supabase's own auth service, while NetLet kept its accounts in
 * `public.users` with the password in Firebase. The rows were always in
 * Supabase — one page over, in the table editor — but the page somebody looks at
 * to answer "did that registration work" was empty by construction.
 *
 * Supabase Auth owns the credential now: the email, the password, and the reset
 * and verification flows that come with it. `public.users` keeps a mirror row
 * per shopper so saved products, delivery area, notification preferences and
 * order tracking can go on being ordinary foreign keys rather than lookups
 * against a remote service.
 *
 * ## Two keys, and they are not interchangeable
 *
 * - The **service-role key** is a full-power secret. It bypasses row-level
 *   security and can read or change anything in the project, so it never leaves
 *   the server, never reaches the client, and is only ever sent to the `admin`
 *   endpoints below.
 * - The **anon key** is a public identifier, like Firebase's Web API key before
 *   it. It is what the password grant and the recovery endpoint take.
 *
 * They are kept apart deliberately rather than "the service key works for
 * everything": sending the service key to the token endpoint would mean a
 * sign-in request carrying the key that owns the whole project, and one
 * misplaced log line would then be a breach rather than a nuisance.
 *
 * ## The password is checked on the server
 *
 * Exactly as it was with Firebase, and for the same reason. No Supabase client
 * SDK ships to the browser, no Supabase access token is ever held in
 * JavaScript, and the session stays the httpOnly cookie the rest of this server
 * already understands — `signSession` in `_core/auth.ts`, unchanged. The tokens
 * the password grant returns are read for their user object and then dropped.
 *
 * ## Everything degrades
 *
 * With the three variables unset, `isSupabaseAuthConfigured()` answers false
 * and the caller falls back to the local scrypt digest, which is what lets
 * `pnpm dev` run before any of this exists. `passwordStore.ts` is what makes
 * that choice; this module only ever speaks to Supabase.
 */
import { ENV } from "./env.js";

/** True when all three are present: the project URL and both keys. */
export function isSupabaseAuthConfigured(): boolean {
  return Boolean(ENV.supabaseUrl && ENV.supabaseAnonKey && ENV.supabaseServiceRoleKey);
}

/** `https://abc.supabase.co` with any trailing slash removed, so paths join cleanly. */
function base(): string {
  return ENV.supabaseUrl.replace(/\/+$/, "");
}

/**
 * Headers for an endpoint that acts on behalf of the project.
 *
 * `apikey` and `Authorization` both carry the service-role key: GoTrue reads
 * the first to route the request and the second to authorise it, and sending
 * only one gets a 401 that reads like a wrong key.
 */
function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    apikey: ENV.supabaseServiceRoleKey,
    authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
  };
}

/** Headers for the two public endpoints. The anon key, never the other one. */
function anonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    apikey: ENV.supabaseAnonKey,
    authorization: `Bearer ${ENV.supabaseAnonKey}`,
    ...extra,
  };
}

/** Thrown when Supabase already has an account on that address. */
export class SupabaseEmailTaken extends Error {
  constructor() {
    super("SUPABASE_EMAIL_TAKEN");
    this.name = "SupabaseEmailTaken";
  }
}

/**
 * What GoTrue returns for a user, reduced to what NetLet stores.
 *
 * The display name lives in `user_metadata`, which is free-form: Supabase has
 * no `displayName` of its own the way Firebase did. It is read back defensively
 * because anything could be in there — an admin editing a user in the
 * dashboard can put a number in that field.
 */
/**
 * How long a call to Supabase Auth may take. Without one a stalled service held
 * every sign-in, registration and reset open until the platform killed the
 * function; a deadline turns it into the same "could not reach the service"
 * failure a refused connection already is, which the callers report as a fault
 * and never as a wrong password.
 */
const AUTH_DEADLINE_MS = 10_000;

export type SupabaseUser = {
  uid: string;
  email: string;
  name: string | null;
  /**
   * Supabase emailed this account a sign-up confirmation: it was asked for on
   * a sign-up form — NetLet's own — rather than added by hand in the dashboard
   * or by an administrator's door, which make an account confirmed and send
   * nothing. Such an account becomes a NetLet login only through the code
   * (`passwordStore.signIn` says why), never by being adopted at sign-in.
   */
  signedUp: boolean;
};

type GoTrueUser = {
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown> | null;
  confirmation_sent_at?: string | null;
  invited_at?: string | null;
};

function toUser(body: GoTrueUser, fallbackEmail: string): SupabaseUser | null {
  if (!body.id) return null;
  const name = body.user_metadata?.name;
  return {
    uid: body.id,
    email: body.email ?? fallbackEmail,
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    /* An invitation sends a mail of its own and is somebody vouching for the
       address, so it is not a sign-up. */
    signedUp: Boolean(body.confirmation_sent_at) && !body.invited_at,
  };
}

/**
 * An endpoint, with where a link in the mail it sends should bring somebody
 * back to.
 *
 * Supabase honours `redirect_to` only for an address on the Site URL's host or
 * in the Redirect URLs list (Authentication → URL Configuration), and falls
 * back to the Site URL otherwise — a new project's is `http://localhost:3000`,
 * which is a blank page on a shopper's phone. `docs/SUPABASE-AUTH.md` says
 * what to set.
 */
function endpoint(path: string, returnTo?: string): string {
  return `${base()}${path}${returnTo ? `?redirect_to=${encodeURIComponent(returnTo)}` : ""}`;
}

/** The text of a failed response, for a log line rather than for a shopper. */
async function reasonFrom(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "(no body)";
  }
}

/**
 * Creates the account, confirmed unless asked otherwise.
 *
 * `email_confirm: true` is the one line here that cannot be left out. Without
 * it Supabase creates the user unconfirmed, and the password grant then refuses
 * every sign-in with "Email not confirmed" — so the account would appear in the
 * dashboard and nobody would ever get in.
 *
 * **This is the administrator's door, not the shopper's.** Opening a store with
 * its owner, or adding a member to one, makes an account for somebody an
 * administrator is vouching for. A shopper registering proves the address
 * themselves, with the code `signUpSupabaseUser` has Supabase send.
 *
 * `confirmed: false` is the one other use: putting a sign-up back to waiting
 * for its code (`passwordStore.signIn`). It sends nothing, so Supabase's mail
 * ceiling cannot stop it half-way; `resendSupabaseSignupCode` sends the code.
 */
export async function createSupabaseUser(input: {
  email: string;
  password: string;
  name?: string | null;
  confirmed?: boolean;
}): Promise<SupabaseUser> {
  const response = await fetch(`${base()}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: input.confirmed ?? true,
      user_metadata: input.name ? { name: input.name } : {},
    }),
  });

  if (response.status === 422 || response.status === 409) throw new SupabaseEmailTaken();
  if (!response.ok) {
    const reason = await reasonFrom(response);
    /* 400 covers both "already registered" and a genuinely bad request, and
       GoTrue says which in the body. Guessing either way would turn a taken
       address into a 500, or a real fault into "that email is taken". */
    if (response.status === 400 && /already|registered|exists/i.test(reason)) throw new SupabaseEmailTaken();
    throw new Error(`Supabase user creation failed with HTTP ${response.status}: ${reason}`);
  }

  const user = toUser((await response.json()) as GoTrueUser, input.email);
  if (!user) throw new Error("Supabase user creation returned no id");
  return user;
}

/**
 * Verifies an email and password against Supabase.
 *
 * Returns null for any rejection — wrong password, unknown address, banned
 * user, unconfirmed email. The caller answers all of them the same way, so
 * distinguishing them here would only build a way to ask Supabase which
 * addresses are registered. A network or configuration failure throws, because
 * that is not a wrong password and must not be reported as one.
 *
 * The grant issues a session; it is deliberately not kept. NetLet's session is
 * its own signed cookie, and holding a Supabase refresh token server-side would
 * be a second session to expire, revoke and reason about for no gain.
 */
export async function verifySupabasePassword(email: string, password: string): Promise<SupabaseUser | null> {
  const answer = await signInSupabase(email, password);
  return answer === "unconfirmed" ? null : answer;
}

/**
 * The same check, with the one answer sign-in needs told apart: the password
 * is right and the address has not been confirmed yet.
 *
 * GoTrue checks the password *before* it checks the confirmation, so
 * "unconfirmed" is only ever said to somebody who has just typed the right
 * password — it tells them nothing they could not already find out by signing
 * in, and it lets the form take them to the code rather than calling a right
 * password wrong. Every other refusal stays null.
 */
export async function signInSupabase(email: string, password: string): Promise<SupabaseUser | "unconfirmed" | null> {
  if (!isSupabaseAuthConfigured()) return null;

  const response = await fetch(`${base()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: anonHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({ email, password }),
  });

  /* 400 is a wrong password or an unknown address; 401 is a rejected grant.
     Both are "no", said the same way. */
  if (response.status === 400 || response.status === 401) {
    return /email_not_confirmed|email not confirmed/i.test(await reasonFrom(response)) ? "unconfirmed" : null;
  }
  if (!response.ok) {
    throw new Error(`Supabase sign-in failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
  }

  const body = (await response.json()) as { user?: GoTrueUser };
  return body.user ? toUser(body.user, email) : null;
}

/** Thrown when Supabase will not send another email yet — its own mail ceiling. */
export class SupabaseMailLimited extends Error {
  constructor() {
    super("SUPABASE_MAIL_LIMITED");
    this.name = "SupabaseMailLimited";
  }
}

export function isSupabaseMailLimited(error: unknown): boolean {
  return error instanceof SupabaseMailLimited;
}

/**
 * What registering asked Supabase for: a code is on its way, or the account
 * was confirmed on the spot because the project confirms addresses by itself.
 */
export type SignUpOutcome = { kind: "codeSent" } | { kind: "confirmed"; user: SupabaseUser };

/**
 * Registers through Supabase's own sign-up, which emails a code.
 *
 * The public endpoint and the anon key, unlike `createSupabaseUser`: this is a
 * shopper asking for an account, and what Supabase does with it is what it does
 * for any sign-up — it holds the account unconfirmed and emails the address a
 * code (the "Confirm signup" template, which carries `{{ .Token }}`). Nothing is
 * written to NetLet until the code comes back.
 *
 * **An address Supabase already holds, confirmed, is answered with a user that
 * has no identities and no mail is sent** — GoTrue's way of not saying who is
 * registered to an anonymous caller. That is "taken" here: the form offers
 * signing in, which adopts the account if NetLet has no row for it yet. An
 * address still waiting for its code is sent a fresh one.
 */
export async function signUpSupabaseUser(input: {
  email: string;
  password: string;
  name?: string | null;
  /** Where a link in the mail lands; see `endpoint`. */
  returnTo?: string;
}): Promise<SignUpOutcome> {
  const response = await fetch(endpoint("/auth/v1/signup", input.returnTo), {
    method: "POST",
    headers: anonHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      data: input.name ? { name: input.name } : {},
    }),
  });

  if (response.status === 429) throw new SupabaseMailLimited();
  if (!response.ok) {
    const reason = await reasonFrom(response);
    /* With the project confirming addresses itself, a taken one is refused
       outright rather than disguised. */
    if ((response.status === 400 || response.status === 422) && /already|registered|exists/i.test(reason)) throw new SupabaseEmailTaken();
    if (/rate limit|over_email_send_rate_limit/i.test(reason)) throw new SupabaseMailLimited();
    throw new Error(`Supabase sign-up failed with HTTP ${response.status}: ${reason}`);
  }

  const body = (await response.json()) as GoTrueUser & { access_token?: string; user?: GoTrueUser; identities?: unknown[] };
  if (body.access_token && body.user) {
    const user = toUser(body.user, input.email);
    if (!user) throw new Error("Supabase sign-up returned a session with no user");
    return { kind: "confirmed", user };
  }
  const user = body.user ?? body;
  if (Array.isArray((user as { identities?: unknown[] }).identities) && (user as { identities: unknown[] }).identities.length === 0) {
    throw new SupabaseEmailTaken();
  }
  return { kind: "codeSent" };
}

/**
 * Sends the sign-up code again.
 *
 * Silent for an address with nothing waiting — already confirmed, or never
 * registered — because the reply must not say which. Supabase's minute between
 * mails to one address is `SupabaseMailLimited`, which the form turns into
 * "wait a moment" rather than a fault.
 */
export async function resendSupabaseSignupCode(email: string, returnTo?: string): Promise<void> {
  const response = await fetch(endpoint("/auth/v1/resend", returnTo), {
    method: "POST",
    headers: anonHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({ type: "signup", email }),
  });

  if (response.status === 429) throw new SupabaseMailLimited();
  if (response.ok) return;
  const reason = await reasonFrom(response);
  if (/rate limit|over_email_send_rate_limit|security purposes/i.test(reason)) throw new SupabaseMailLimited();
  if (response.status === 400 || response.status === 404 || response.status === 422) return;
  throw new Error(`Supabase could not resend the sign-up code: HTTP ${response.status}: ${reason}`);
}

/**
 * Checks a sign-up code, which confirms the account in Supabase when it is right.
 *
 * `type: "email"` is GoTrue's current name for an emailed code; for an address
 * not yet confirmed it checks the sign-up token, which is the one the "Confirm
 * signup" mail carried. A wrong code and an expired one are both null — GoTrue
 * answers them with one message, and the form says "that code is not right, or
 * it has expired" for both.
 */
export async function verifySupabaseSignupCode(email: string, code: string): Promise<SupabaseUser | null> {
  const response = await fetch(`${base()}/auth/v1/verify`, {
    method: "POST",
    headers: anonHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({ type: "email", email, token: code }),
  });

  if ([400, 401, 403, 404, 410, 422].includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`Supabase code check failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
  }

  const body = (await response.json()) as { user?: GoTrueUser };
  return body.user ? toUser(body.user, email) : null;
}

/**
 * Whether the project confirms addresses by itself — Authentication → Sign In
 * / Providers → Email → "Confirm email" switched off.
 *
 * Then no code is ever sent and an account is usable the moment it is asked
 * for, which is the one setting that makes the code step impossible. Asked by
 * `pnpm preflight` and the features page, never on a shopper's path. Null when
 * it cannot be told.
 */
export async function supabaseConfirmsEmailItself(): Promise<boolean | null> {
  if (!isSupabaseAuthConfigured()) return null;
  try {
    const response = await fetch(`${base()}/auth/v1/settings`, {
      headers: anonHeaders(),
      signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { mailer_autoconfirm?: boolean };
    return typeof body.mailer_autoconfirm === "boolean" ? body.mailer_autoconfirm : null;
  } catch {
    return null;
  }
}

/**
 * Asks Supabase to email a password-reset link.
 *
 * Supabase composes and sends the message itself, so this needs no mail
 * provider, no templates and no outbound SMTP — the same property that let the
 * reset link be real rather than decorative under Firebase. The default
 * project mailer is rate-limited and is meant for development; a real
 * deployment points Supabase at its own SMTP in the dashboard, which is a
 * setting rather than code.
 *
 * Returns nothing in every case, including an address with no account. Passing
 * back "no such user" would turn this into the enumeration oracle that sign-in
 * is careful to avoid. A configuration or network failure still throws, because
 * that is a fault to fix rather than an answer to give.
 *
 * The link in the mail goes through Supabase and comes back to `returnTo`
 * with a token for the account, which the sign-in page spends on the new
 * password (`setPasswordFromLink`). Without a page there to take it, the link
 * signed into Supabase and changed nothing.
 *
 * The locale is taken and not sent: Supabase localises from the template, not
 * the request. It stays in the signature for when the templates are
 * translated in the dashboard, and the callers already have it to hand.
 */
export async function sendSupabasePasswordReset(email: string, _locale: "en" | "ar", returnTo?: string): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  const response = await fetch(endpoint("/auth/v1/recover", returnTo), {
    method: "POST",
    headers: anonHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({ email }),
  });

  /* 400 and 422 are "no such address" and the like: silent on purpose, above.
     429 is Supabase's own mail ceiling, which is a fault on our side rather
     than an answer about this address — logged by the caller, not raised at the
     person who asked. */
  if (response.status === 400 || response.status === 422) return;
  if (!response.ok) {
    throw new Error(`Supabase password reset failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
  }
}

/** How setting a password from a reset link went. */
export type LinkPasswordOutcome = "changed" | "expired" | "same" | "weak";

/**
 * Sets the password of the account a reset link signed into.
 *
 * The reset mail's link goes through Supabase, which checks it and sends the
 * browser back to NetLet with a short-lived access token for that account in
 * the address's fragment. That token is the proof the link was opened, and it
 * is spent here on one thing: `PUT /auth/v1/user`, which changes the password
 * of the account the token names and no other. It is not kept — NetLet's
 * session is its own cookie, the rule `verifySupabasePassword` follows.
 *
 * "expired" is a token Supabase no longer accepts (an hour old, or signed out);
 * "same" and "weak" are Supabase's own refusals — the current password again,
 * or below the project's own floor — which the page says in words.
 */
export async function setPasswordFromLink(accessToken: string, password: string): Promise<{ outcome: LinkPasswordOutcome; user: SupabaseUser | null }> {
  const response = await fetch(`${base()}/auth/v1/user`, {
    method: "PUT",
    headers: anonHeaders({ authorization: `Bearer ${accessToken}` }),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify({ password }),
  });

  if (response.status === 401 || response.status === 403) return { outcome: "expired", user: null };
  if (response.status === 400 || response.status === 422) {
    const reason = await reasonFrom(response);
    if (/same_password|different from the old/i.test(reason)) return { outcome: "same", user: null };
    if (/weak_password|password/i.test(reason)) return { outcome: "weak", user: null };
    if (/jwt|token|session/i.test(reason)) return { outcome: "expired", user: null };
    throw new Error(`Supabase could not set the password: HTTP ${response.status}: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Supabase could not set the password: HTTP ${response.status}: ${await reasonFrom(response)}`);
  }

  return { outcome: "changed", user: toUser((await response.json()) as GoTrueUser, "") };
}

/**
 * Changes what Supabase holds for an existing account.
 *
 * Only the fields given are sent. Passing `name: null` clears it, which is
 * different from not passing it at all — the same distinction the profile form
 * makes between "no display name" and "leave the display name alone".
 */
export async function updateSupabaseUser(
  uid: string,
  patch: { email?: string; password?: string; name?: string | null },
): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  const body: Record<string, unknown> = {};
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.password !== undefined) body.password = patch.password;
  if (patch.name !== undefined) body.user_metadata = { name: patch.name ?? null };
  /* An empty patch would be a round trip that changes nothing, and GoTrue
     answers it with a 200 that hides the caller's mistake. */
  if (Object.keys(body).length === 0) return;

  const response = await fetch(`${base()}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
    method: "PUT",
    headers: adminHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
    body: JSON.stringify(body),
  });

  if (response.status === 422 || response.status === 409) throw new SupabaseEmailTaken();
  if (!response.ok) {
    const reason = await reasonFrom(response);
    if (response.status === 400 && /already|registered|exists/i.test(reason)) throw new SupabaseEmailTaken();
    throw new Error(`Supabase user update failed with HTTP ${response.status}: ${reason}`);
  }
}

/**
 * Removes the account from Supabase.
 *
 * Two callers. A rollback: `createVendorWithOwner` writes the vendor, then the
 * login, and undoes the first if the second fails — a credential left behind
 * by a half-made store is a login into nothing. And a sign-up Supabase
 * confirmed by its own link, which `passwordStore.signIn` makes again waiting
 * for its code.
 *
 * A 404 is success — whatever this was asked to remove is not there.
 */
export async function deleteSupabaseUser(uid: string): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  const response = await fetch(`${base()}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    headers: adminHeaders(),
    signal: AbortSignal.timeout(AUTH_DEADLINE_MS),
  });

  if (response.ok || response.status === 404) return;
  throw new Error(`Supabase user deletion failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
}

export function isSupabaseEmailTaken(error: unknown): boolean {
  return error instanceof SupabaseEmailTaken;
}
