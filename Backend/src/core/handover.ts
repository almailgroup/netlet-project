/**
 * The token the shopper's QR carries, and the code printed under it, for the
 * driver's check at the door (0086, on the owner's word).
 *
 * **Signed, not stored**: an HMAC of the order's id under the server's secret,
 * so the code needs no column and cannot be guessed from the order reference
 * a driver already sees on the board. What the scan proves is that the driver
 * stood in front of the shopper's own screen — a driver who could make the
 * code from the reference could mark a parcel handed over without meeting
 * anybody. The secret is read when it is used, not at import, so a test that
 * sets it first is answered.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  handoverCodeFrom,
  handoverToken,
  normaliseHandoverCode,
  parseHandoverToken,
} from "../../../Shared/commerce/onlinePayment.js";

const PURPOSE = "netlet-handover:";
const SIGNATURE_BYTES = 18;

function digest(orderId: number): Buffer | null {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${PURPOSE}${orderId}`).digest();
}

/** The QR's token and the code under it, or null on a server with no secret. */
export function handoverFor(orderId: number): { token: string; code: string } | null {
  const bytes = digest(orderId);
  if (!bytes) return null;
  return {
    token: handoverToken(orderId, bytes.subarray(0, SIGNATURE_BYTES).toString("base64url")),
    code: handoverCodeFrom(bytes.subarray(SIGNATURE_BYTES)),
  };
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The order a scanned token names, or null for one this server did not sign. */
export function orderOfToken(token: string): number | null {
  const parsed = parseHandoverToken(token);
  if (!parsed) return null;
  const expected = handoverFor(parsed.orderId);
  if (!expected) return null;
  return same(expected.token, token.trim()) ? parsed.orderId : null;
}

/** Whether a typed code is this order's, read as `normaliseHandoverCode` reads it. */
export function codeMatches(orderId: number, typed: string): boolean {
  const code = normaliseHandoverCode(typed);
  const expected = handoverFor(orderId);
  if (!code || !expected) return false;
  return same(expected.code, code);
}
