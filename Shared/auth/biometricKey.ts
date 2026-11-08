/**
 * Signing in with Face ID on the iPhone: the rules the app and the server
 * both hold.
 *
 * The phone makes a P-256 key pair in its Secure Enclave that can be used only
 * after Face ID, and hands NetLet the public half with a random id that names
 * the key on the phone. To sign in, the server hands out a short-lived
 * challenge for that id, the phone signs it — which is the Face ID prompt —
 * and the server checks the signature against the public half it keeps
 * (`biometric_keys`). NetLet never sees a face or a fingerprint: the phone
 * does, and answers with a signature or nothing.
 *
 * The id is random and kept on the phone beside the email it signs in to, so
 * the sign-in form shows Face ID only where this phone has a key for the
 * address typed — nobody learns from it whether an address has an account.
 */

/** A key's id: random, URL-safe, long enough that guessing one is not a way in. */
export const BIOMETRIC_KEY_ID = /^[A-Za-z0-9_-]{22,64}$/;

/** At most this many phones per account have Face ID set up. */
export const MAX_BIOMETRIC_KEYS = 10;

/** How long a sign-in challenge lasts: long enough for a Face ID prompt and a retry. */
export const BIOMETRIC_CHALLENGE_MS = 2 * 60 * 1000;

/** A phone's name as it is shown on the account, cut to this. */
export const DEVICE_NAME_MAX = 80;

/**
 * What the phone signs: the challenge with a prefix of its own, so a signature
 * made for this can never stand for anything else the key might sign.
 */
export function biometricMessage(challenge: string): string {
  return `netlet-face-id:${challenge}`;
}

/** The shown name for a phone: trimmed, never empty, cut to the column. */
export function deviceNameOf(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, DEVICE_NAME_MAX) : null;
}
