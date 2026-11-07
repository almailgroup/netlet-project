/**
 * Text messages — the codes a phone sign-in sends.
 *
 * **The owner's gateway is Concept Combined** (conceptcombined.com, a Kuwaiti
 * SMS provider). Its HTTP API is wired in `sendThroughProvider` from its own
 * documentation, which this file waits for: until then `providerConfigured()`
 * is false, `smsReady()` is false, and the shop offers no phone sign-in —
 * a button that asks for a number and never texts is worse than none.
 *
 * **`SMS_LOG_ONLY` writes each text to the server log instead**, for a
 * developer or a staging server walking the whole flow with no gateway;
 * it is ignored on Vercel's production deployment (`env.ts`), and
 * `pnpm preflight` says so, because there it would offer phone sign-in with
 * every shopper's code in the log.
 */
import { ENV } from "./env.js";

/** Whether texts can be sent at all: a gateway, or the log standing in for one. */
export function smsReady(): boolean {
  return providerConfigured() || ENV.smsLogOnly;
}

/** Concept Combined's credentials are set (see the file's note). */
function providerConfigured(): boolean {
  return false;
}

/** Sends one text. Throws when it could not be sent. */
export async function sendText(phone: string, text: string): Promise<void> {
  if (providerConfigured()) {
    await sendThroughProvider(phone, text);
    return;
  }
  if (ENV.smsLogOnly) {
    console.info(`[sms] (log only) to ${phone}: ${text}`);
    return;
  }
  throw new Error("No SMS gateway is configured");
}

async function sendThroughProvider(_phone: string, _text: string): Promise<void> {
  throw new Error("Concept Combined's API is not wired yet");
}
