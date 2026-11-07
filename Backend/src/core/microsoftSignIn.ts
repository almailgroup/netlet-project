/**
 * Sign in with Microsoft, the parts that are Microsoft's rather than
 * Supabase's — Supabase calls it "Azure".
 *
 * One app registration in Microsoft's Azure portal, for personal accounts
 * (Outlook, Hotmail, Live) and work or school ones, answers both sides with
 * one Application (client) ID: the website asks in a popup for an identity
 * token straight back (`response_type=id_token`, to `/microsoft-return.html`),
 * and the app asks through the system's sign-in sheet for a code and trades
 * it with PKCE, on the `msauth.<bundle id>://auth` address Microsoft gives an
 * iOS app. Supabase checks the token (`signInSupabaseWithIdToken` with
 * "azure"): Microsoft's signature, that it was issued to the client id the
 * dashboard lists, and the nonce. Nothing is kept: there is no Microsoft token
 * to revoke when an account goes. The name is the token's own
 * (`namesOf` in `googleSignIn.ts`, which reads any provider's).
 */
import { ENV } from "./env.js";

/** The client id the website and the app hand Microsoft, or null for no Microsoft button. */
export function microsoftClientId(): string | null {
  return ENV.microsoftSigninClientId || null;
}
