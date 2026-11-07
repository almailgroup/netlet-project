/**
 * Supabase's "Send SMS" hook: Supabase makes a phone sign-in's code and calls
 * this with it, and NetLet texts it through its own gateway (`core/sms.ts`).
 *
 * **Signed, or refused.** Supabase signs each call by the Standard Webhooks
 * scheme with the secret the dashboard shows when the hook is made
 * (`SMS_HOOK_SECRET`, `v1,whsec_<base64>`): an HMAC-SHA256 of
 * `<webhook-id>.<webhook-timestamp>.<body>`, base64, in `webhook-signature`
 * as one or more space-separated `v1,<signature>`. Anything unsigned, signed
 * with another key, or older than five minutes is refused before it is read,
 * so nobody else can make the shop send texts.
 *
 * **Kuwaiti mobiles only, here as well as on the form.** This is where a text
 * costs money, and Supabase's own endpoint can be called by anybody holding
 * the project's public key, so the rule is asked again at the last moment.
 *
 * The text names the shop and the code in both languages, the code first so
 * a phone's one-time-code suggestion finds it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { kuwaitMobile } from "../../../Shared/auth/phone.js";
import { ENV } from "./env.js";
import { sendText } from "./sms.js";

const TOLERANCE_SECONDS = 5 * 60;

export type HookAnswer = { status: number; body: object };

const refusal = (status: number, message: string): HookAnswer => ({ status, body: { error: { http_code: status, message } } });

/** The secret's key bytes, from `v1,whsec_<base64>` or a bare `whsec_<base64>`. */
function keyOf(secret: string): Buffer | null {
  const match = /whsec_([A-Za-z0-9+/=]+)/.exec(secret.trim());
  return match ? Buffer.from(match[1], "base64") : null;
}

/** Whether a call carries a valid signature from the secret, made within the tolerance. */
export function signedBy(secret: string, headers: Record<string, string | string[] | undefined>, body: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const key = keyOf(secret);
  const id = String(headers["webhook-id"] ?? "");
  const timestamp = String(headers["webhook-timestamp"] ?? "");
  const offered = String(headers["webhook-signature"] ?? "");
  if (!key || !id || !/^\d+$/.test(timestamp) || !offered) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return offered.split(" ").some(part => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** The text a code goes out in. */
export function codeText(code: string): string {
  return `${code} is your NetLet code. Do not share it.\n${code} رمز نت‑لت الخاص بك. لا تشاركه مع أحد.`;
}

/** Answers one call of the hook. */
export async function handleSmsHook(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<HookAnswer> {
  if (!ENV.smsHookSecret) return refusal(404, "Not found");
  if (!signedBy(ENV.smsHookSecret, headers, rawBody)) return refusal(401, "Signature not valid");

  let payload: { user?: { phone?: unknown }; sms?: { otp?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return refusal(400, "Body is not JSON");
  }
  const phone = kuwaitMobile(typeof payload.user?.phone === "string" ? payload.user.phone : null);
  const code = typeof payload.sms?.otp === "string" ? payload.sms.otp : null;
  if (!phone) return refusal(400, "Only Kuwaiti mobile numbers can be sent a code");
  if (!code || !/^\d{4,10}$/.test(code)) return refusal(400, "No code to send");

  try {
    await sendText(phone, codeText(code));
  } catch (error) {
    console.error(`[sms] a sign-in code could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    return refusal(503, "The text could not be sent");
  }
  return { status: 200, body: {} };
}
