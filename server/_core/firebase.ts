/**
 * Firebase Authentication: where NetLet's registered accounts actually live.
 *
 * Firebase owns the credential — the email, the password, and everything that
 * comes with it later (reset links, verification, a second factor, Google
 * sign-in). NetLet keeps a mirror row per shopper so that saved products,
 * delivery area and notification preferences can go on being ordinary foreign
 * keys instead of documents.
 *
 * The password is checked on the server, not in the browser. The Admin SDK
 * cannot verify a password, so sign-in goes through Identity Toolkit's
 * `signInWithPassword` with the project's Web API key — which is a public
 * identifier, not a secret. Keeping it here rather than in the client means the
 * page never holds a Firebase token, and the session stays the httpOnly cookie
 * the rest of the server already understands.
 *
 * Everything degrades: with no credentials configured `getFirebaseAuth()`
 * answers null and the caller falls back to the local password table, in
 * keeping with the rest of this server's configuration.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { ENV } from "./env.js";

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

/** True when both halves are present: the Admin credential and the Web API key. */
export function isFirebaseConfigured(): boolean {
  return Boolean(ENV.firebaseProjectId && ENV.firebaseClientEmail && ENV.firebasePrivateKey && ENV.firebaseApiKey);
}

let app: App | null = null;

/**
 * The Admin SDK's Auth handle, or null when Firebase is not configured.
 *
 * Initialised once and cached — `initializeApp` throws on a second call with
 * the same name, and a hot reload in development would otherwise trip it.
 */
export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured()) return null;
  if (!app) {
    const existing = getApps();
    app = existing.length
      ? existing[0]
      : initializeApp({
          credential: cert({
            projectId: ENV.firebaseProjectId,
            clientEmail: ENV.firebaseClientEmail,
            // Service-account keys carry real newlines. Environment files
            // cannot, so they travel as the two characters \n and are put back
            // here — otherwise the key parses as a single line and every
            // signature fails with an opaque error.
            privateKey: ENV.firebasePrivateKey.replace(/\\n/g, "\n"),
          }),
          projectId: ENV.firebaseProjectId,
        });
  }
  return getAuth(app);
}

export type FirebaseSignIn = { uid: string; email: string; name: string | null };

/**
 * Verifies an email and password against Firebase.
 *
 * Returns null for any rejection — wrong password, unknown address, disabled
 * account. The caller answers all three the same way, so distinguishing them
 * here would only create a way to ask Firebase which addresses are registered.
 * A network or configuration failure throws, because that is not a wrong
 * password and must not be reported as one.
 */
export async function verifyFirebasePassword(email: string, password: string): Promise<FirebaseSignIn | null> {
  if (!isFirebaseConfigured()) return null;

  const response = await fetch(`${IDENTITY_TOOLKIT}?key=${encodeURIComponent(ENV.firebaseApiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });

  if (response.status === 400) return null;
  if (!response.ok) {
    throw new Error(`Firebase sign-in failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as { localId?: string; email?: string; displayName?: string };
  if (!body.localId) return null;
  return { uid: body.localId, email: body.email ?? email, name: body.displayName || null };
}

/** Raised by the Admin SDK when the address already has an account. */
export const EMAIL_IN_USE = "auth/email-already-exists";

export function isEmailInUse(error: unknown): boolean {
  return (error as { code?: string })?.code === EMAIL_IN_USE;
}
