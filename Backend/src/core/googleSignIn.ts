/**
 * Sign in with Google, the parts that are Google's rather than Supabase's.
 *
 * Supabase checks Google's identity token (`signInSupabaseWithIdToken`) —
 * its signature, that it was issued to one of the Client IDs the dashboard
 * lists for Google, and the nonce. This file holds which client ids the
 * website and the app hand Google, and reading the name a token carries.
 *
 * The website asks Google in a popup for an identity token straight back
 * (`response_type=id_token`, to `/google-return.html`); the app asks through
 * the system's sign-in sheet for a code and trades it with PKCE. Both send a
 * nonce's SHA-256 to Google and the nonce itself to the server, as Apple's do.
 * Nothing is kept: there is no Google token to revoke when an account goes.
 */
import { ENV } from "./env.js";

/** The website's client id, or null when the website offers no Google button. */
export function googleWebClientId(): string | null {
  return ENV.googleSigninWebClientId || null;
}

/** The app's client id, or null when the app offers no Google button. */
export function googleIosClientId(): string | null {
  return ENV.googleSigninIosClientId || null;
}

/**
 * The given and family names an identity token carries, read without
 * checking the signature — Supabase has checked it before this is asked, and
 * the answer only names a new account.
 */
export function namesOf(idToken: string): { first: string | null; last: string | null } {
  const payload = idToken.split(".")[1];
  if (!payload) return { first: null, last: null };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { given_name?: unknown; family_name?: unknown };
    const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null);
    return { first: clean(claims.given_name), last: clean(claims.family_name) };
  } catch {
    return { first: null, last: null };
  }
}
