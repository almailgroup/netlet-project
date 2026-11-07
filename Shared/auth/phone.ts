/**
 * Signing in with a phone number, the rule for which numbers — pure and
 * shared, so the form says what the server refuses.
 *
 * **Kuwaiti mobiles only, on the owner's word.** NetLet delivers in Kuwait
 * alone, every code is a text message somebody pays for, and the abuse a
 * phone sign-up attracts — scripts asking for codes to expensive numbers
 * abroad — is shut out by refusing every number that is not one. A Kuwaiti
 * mobile is +965 and eight digits starting 4, 5, 6 or 9; a landline starts 2
 * and cannot take a text. Arabic-Indic digits, spaces, dashes and a leading
 * 00965 or +965 are all read, by the wishlist's `normalisePhone`.
 */
import { COUNTRY_CODE, formatPhone, normalisePhone } from "../commerce/wishlist.js";

/** The digits a Kuwaiti mobile number may start with. */
const MOBILE_FIRST = new Set(["4", "5", "6", "9"]);

/** `+965` and the eight digits, or null for anything that is not a Kuwaiti mobile. */
export function kuwaitMobile(raw: string | null | undefined): string | null {
  const phone = normalisePhone(raw);
  if (!phone) return null;
  const first = phone.charAt(COUNTRY_CODE.length + 1);
  return MOBILE_FIRST.has(first) ? phone : null;
}

/** What is wrong with a typed number, as a message key, or null. */
export function phoneProblem(raw: string): "auth.phoneRequired" | "auth.phoneInvalid" | null {
  if (!raw.trim()) return "auth.phoneRequired";
  return kuwaitMobile(raw) ? null : "auth.phoneInvalid";
}

/** `+96550123456` → `+965 5012 3456`, a number said back to its owner. */
export function shownPhone(canonical: string): string {
  return `+${COUNTRY_CODE} ${formatPhone(canonical)}`;
}
