/**
 * The "I'm not a robot" box on Create account — Google reCAPTCHA v2.
 *
 * The box is drawn by Google's script in the browser, which hands the page a
 * token once it is satisfied; the token proves nothing until the server asks
 * Google about it, so registration asks before a code is ever sent. A bot that
 * skips the box, or replays a token, is refused before NetLet spends a mail on
 * it — which is the abuse that matters here: a registration form that sends
 * email is a way to send email to anybody.
 *
 * **Off until both keys are set**, the rule every value in `.env.example`
 * follows: the box is not drawn and registration does not ask for it. Never
 * half-on — a site key without the secret would draw a box the server could
 * not check, which is a box that only stops people.
 *
 * **A Google that cannot be reached refuses rather than waves through.** A
 * check that passes whenever it fails to run is no check against somebody who
 * can make it fail; the form says to try again, and nothing else on the shop
 * depends on Google being up.
 */
import { ENV } from "./env.js";

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const CAPTCHA_DEADLINE_MS = 10_000;

/** The public key for the browser, or null when the check is off. */
export function captchaSiteKey(): string | null {
  return ENV.recaptchaSiteKey && ENV.recaptchaSecretKey ? ENV.recaptchaSiteKey : null;
}

export type CaptchaVerdict = "passed" | "failed" | "unavailable";

/**
 * Asks Google whether the token is a real, unspent tick.
 *
 * "passed" when the check is off, so callers need not ask first.
 */
export async function checkCaptcha(token: string | undefined, remoteIp: string | null): Promise<CaptchaVerdict> {
  if (!captchaSiteKey()) return "passed";
  if (!token) return "failed";

  const form = new URLSearchParams({ secret: ENV.recaptchaSecretKey, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(CAPTCHA_DEADLINE_MS),
    });
    if (!response.ok) {
      console.error(`[captcha] Google answered HTTP ${response.status}`);
      return "unavailable";
    }
    const body = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (body.success === true) return "passed";
    /* A wrong secret is ours to fix, not the shopper's fault, and every
       registration would fail on it — so it is logged loudly and said as
       "try again later" rather than "you look like a robot". */
    if (body["error-codes"]?.some(code => code === "invalid-input-secret" || code === "missing-input-secret")) {
      console.error("[captcha] Google refused RECAPTCHA_SECRET_KEY — check it matches RECAPTCHA_SITE_KEY.");
      return "unavailable";
    }
    return "failed";
  } catch (error) {
    console.error(`[captcha] could not reach Google: ${String(error)}`);
    return "unavailable";
  }
}
