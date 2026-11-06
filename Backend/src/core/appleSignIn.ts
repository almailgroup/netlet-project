/**
 * Sign in with Apple, the parts that are Apple's rather than Supabase's.
 *
 * Supabase checks Apple's identity token and holds the identity
 * (`signInSupabaseWithIdToken`); this file holds the two things it does not:
 * which client id the website hands Apple's own script, and the request that
 * unlinks NetLet from somebody's Apple ID when they delete their account —
 * which Apple asks every app that offers Sign in with Apple to make, so a
 * deleted account does not go on appearing under "Apps using Apple ID".
 *
 * Revoking needs a client secret: a short JWT signed with a Sign in with
 * Apple key (a .p8 from the Apple Developer site), for the client id the
 * sign-in was made for — the app's bundle id from the phone, the Services ID
 * from the website, which is the identity token's own `aud`. Unset, nothing
 * is revoked and the account is still deleted; the person can remove NetLet
 * from their Apple ID's settings themselves.
 */
import { importPKCS8, SignJWT } from "jose";
import { ENV } from "./env.js";

const APPLE = "https://appleid.apple.com";
const APPLE_DEADLINE_MS = 8_000;

/** The website's client id, or null when the website offers no Apple button. */
export function appleWebClientId(): string | null {
  return ENV.appleSigninServicesId || null;
}

/** Whether the server can unlink an Apple ID on deletion. */
export function canRevokeApple(): boolean {
  return Boolean(ENV.appleSigninTeamId && ENV.appleSigninKeyId && ENV.appleSigninPrivateKey.includes("PRIVATE KEY"));
}

/**
 * The client id an identity token was issued to, read without checking the
 * signature — Supabase has checked it before this is asked, and the answer
 * only decides which client id the revocation names.
 */
export function audienceOf(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud?: unknown };
    if (typeof claims.aud === "string") return claims.aud;
    if (Array.isArray(claims.aud) && typeof claims.aud[0] === "string") return claims.aud[0];
    return null;
  } catch {
    return null;
  }
}

/** The client secret Apple's token endpoints ask for: five minutes is plenty. */
async function clientSecret(clientId: string): Promise<string> {
  const key = await importPKCS8(ENV.appleSigninPrivateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: ENV.appleSigninKeyId })
    .setIssuer(ENV.appleSigninTeamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience(APPLE)
    .setSubject(clientId)
    .sign(key);
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(APPLE_DEADLINE_MS),
  });
}

export type RevokeOutcome = "revoked" | "notConfigured" | "noCode" | "failed";

/**
 * Unlinks NetLet from the Apple ID behind an authorization code: trades the
 * code for a refresh token and revokes that, which ends every token Apple
 * issued NetLet for the person. Never throws — it runs after the account is
 * gone, and a deletion that succeeded is not to be reported as a failure
 * because Apple did not answer; the outcome is logged instead.
 */
export async function revokeAppleAuthorization(input: { clientId: string | null; code: string | null | undefined }): Promise<RevokeOutcome> {
  if (!canRevokeApple() || !input.clientId) return "notConfigured";
  if (!input.code) return "noCode";
  try {
    const secret = await clientSecret(input.clientId);
    const traded = await post("/auth/token", {
      client_id: input.clientId,
      client_secret: secret,
      code: input.code,
      grant_type: "authorization_code",
    });
    if (!traded.ok) {
      console.warn(`[auth] Apple would not trade the code to unlink an account: HTTP ${traded.status}`);
      return "failed";
    }
    const tokens = (await traded.json()) as { refresh_token?: string; access_token?: string };
    const token = tokens.refresh_token ?? tokens.access_token;
    if (!token) return "failed";
    const revoked = await post("/auth/revoke", {
      client_id: input.clientId,
      client_secret: secret,
      token,
      token_type_hint: tokens.refresh_token ? "refresh_token" : "access_token",
    });
    if (!revoked.ok) {
      console.warn(`[auth] Apple refused to revoke a deleted account's token: HTTP ${revoked.status}`);
      return "failed";
    }
    return "revoked";
  } catch (error) {
    console.warn(`[auth] Apple could not be asked to unlink an account: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}
