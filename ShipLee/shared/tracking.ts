/**
 * A ShipLee tracking number: "SL" and ten digits, the last a check digit.
 *
 * The check digit (Luhn, the card numbers' rule) is what lets the page say
 * "that number doesn't look right" before asking the server: one wrong digit
 * or two neighbours swapped — the mistakes people make copying a number off a
 * text message — always fail it, so a typo is caught where it is typed rather
 * than answered with "not found", which reads as "your parcel is lost".
 *
 * Nine random digits are a billion numbers, so a number is no way to walk
 * through other people's parcels, and the tracking page shows nothing personal
 * about the recipient either way.
 */
import { foldDigits } from "./digits.js";

export const PREFIX = "SL";
const BODY = 9;

/** The check digit for nine digits, by Luhn: double every second digit from the right. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let digit = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

export type ParsedNumber =
  | { ok: true; number: string }
  | { ok: false; reason: "empty" | "shape" | "check" };

/**
 * What somebody typed, read as a tracking number: spaces, dashes and dots are
 * dropped, the case does not matter, Arabic-Indic digits are digits, and the
 * "SL" may be left off.
 */
export function parseTrackingNumber(input: string): ParsedNumber {
  const compact = foldDigits(input).toUpperCase().replace(/[\s\-._/]/g, "");
  if (!compact) return { ok: false, reason: "empty" };
  const digits = compact.startsWith(PREFIX) ? compact.slice(PREFIX.length) : compact;
  if (!/^\d{10}$/.test(digits)) return { ok: false, reason: "shape" };
  if (checkDigit(digits.slice(0, BODY)) !== Number(digits[BODY])) return { ok: false, reason: "check" };
  return { ok: true, number: PREFIX + digits };
}

/** A new number from nine random digits. The server hands it a secure source. */
export function makeTrackingNumber(randomDigit: () => number): string {
  let body = "";
  for (let i = 0; i < BODY; i++) body += String(randomDigit() % 10);
  /* A number whose first digit is 0 is fine, but reads as shorter when
     somebody drops it over the phone; start from 1 to 9. */
  if (body.startsWith("0")) body = String((randomDigit() % 9) + 1) + body.slice(1);
  return PREFIX + body + String(checkDigit(body));
}
