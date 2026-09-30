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
export type SupabaseUser = { uid: string; email: string; name: string | null };

type GoTrueUser = { id?: string; email?: string; user_metadata?: Record<string, unknown> | null };

function toUser(body: GoTrueUser, fallbackEmail: string): SupabaseUser | null {
  if (!body.id) return null;
  const name = body.user_metadata?.name;
  return {
    uid: body.id,
    email: body.email ?? fallbackEmail,
    name: typeof name === "string" && name.trim() ? name.trim() : null,
  };
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
 * Creates the account, confirmed.
 *
 * `email_confirm: true` is the one line here that cannot be left out. Without
 * it Supabase creates the user unconfirmed, and the password grant then refuses
 * every sign-in with "Email not confirmed" — so registration would appear to
 * work, the row would appear in the dashboard, and nobody would ever get in.
 * NetLet is not running an email-verification flow yet; when it does, this
 * becomes false and the verification mail becomes the gate.
 */
export async function createSupabaseUser(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<SupabaseUser> {
  const response = await fetch(`${base()}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
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
  if (!isSupabaseAuthConfigured()) return null;

  const response = await fetch(`${base()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: anonHeaders(),
    body: JSON.stringify({ email, password }),
  });

  /* 400 is a wrong password or an unknown address; 401 is a rejected grant.
     Both are "no", said the same way. */
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Supabase sign-in failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
  }

  const body = (await response.json()) as { user?: GoTrueUser };
  return body.user ? toUser(body.user, email) : null;
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
 * The locale rides along as `gotrue_meta_security` is not the place for it —
 * Supabase localises from the template, not the request — so the locale is
 * taken and not sent. It stays in the signature because when the templates are
 * translated in the dashboard, this is where the redirect would carry the
 * language, and the callers already have it to hand.
 */
export async function sendSupabasePasswordReset(email: string, _locale: "en" | "ar"): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  const response = await fetch(`${base()}/auth/v1/recover`, {
    method: "POST",
    headers: anonHeaders(),
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
 * Only one caller, and it is a rollback: `createVendorWithOwner` writes the
 * vendor, then the login, and undoes the first if the second fails. A
 * credential left behind by a half-made store is a login into nothing.
 *
 * A 404 is success — whatever this was asked to remove is not there.
 */
export async function deleteSupabaseUser(uid: string): Promise<void> {
  if (!isSupabaseAuthConfigured()) return;

  const response = await fetch(`${base()}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });

  if (response.ok || response.status === 404) return;
  throw new Error(`Supabase user deletion failed with HTTP ${response.status}: ${await reasonFrom(response)}`);
}

export function isSupabaseEmailTaken(error: unknown): boolean {
  return error instanceof SupabaseEmailTaken;
}
