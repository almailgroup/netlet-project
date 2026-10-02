/**
 * The affiliate link somebody arrived through (3.7).
 *
 * `?aff=AFXXXX` on any page. The last one seen wins, and it counts for
 * `ATTRIBUTION_DAYS` from the click — kept here, with the moment it was seen,
 * because only the browser saw the click. The server checks everything else:
 * that the affiliate exists, is approved, and is not the buyer.
 *
 * A per-viewer convenience in `browserStore` like the referral code, for its
 * reason: losing it costs one attribution, not a fact NetLet needs.
 */
import { readStored, removeStored, writeStored } from "@/lib/browserStore";
import { ATTRIBUTION_DAYS, userIdFromAffiliateCode, withinAttribution } from "@shared/commerce/affiliate";

const KEY = "netlet.affiliate";

/** Remember the `?aff=` on this page, if it is shaped like a code. */
export function captureAffiliate(search: string, now = new Date()): void {
  const code = new URLSearchParams(search).get("aff")?.trim().toUpperCase();
  if (!code || userIdFromAffiliateCode(code) === null) return;
  writeStored(KEY, JSON.stringify({ code, at: now.toISOString() }));
}

/** The code to send with an order, if a click inside the window is remembered. */
export function currentAffiliate(now = new Date()): string | null {
  try {
    const stored = JSON.parse(readStored(KEY) ?? "null") as { code?: string; at?: string } | null;
    if (!stored?.code || !stored.at) return null;
    if (!withinAttribution(stored.at, now)) {
      removeStored(KEY);
      return null;
    }
    return stored.code;
  } catch {
    return null;
  }
}

export { ATTRIBUTION_DAYS };
