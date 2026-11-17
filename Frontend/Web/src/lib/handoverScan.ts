/**
 * The token a shopper's QR carries to the driver's scan page (0086), in the
 * address's fragment so no server or proxy log ever sees it.
 *
 * Read as the app starts and taken out of the address at once, as the portal
 * pass is: a driver signed out is sent to sign in first, and the fragment
 * would not survive that — so it is kept for the tab (`browserStore`'s session
 * helpers), and the scan page asks for it once signed in.
 */
import { readSession, removeSession, writeSession } from "@/lib/browserStore";
import { tokenFromScan } from "@shared/commerce/onlinePayment";

const KEY = "netlet:handover";

/** As the app starts, on the scan page: keeps the token and clears the fragment. */
export function catchHandoverToken(): void {
  if (typeof window === "undefined") return;
  if (!/\/dispatch\/scan\/?$/.test(window.location.pathname)) return;
  const found = /(?:^#|&)h=([^&]+)/.exec(window.location.hash);
  if (!found) return;
  let token: string | null = null;
  try {
    token = tokenFromScan(decodeURIComponent(found[1]));
  } catch {
    token = null;
  }
  if (token) writeSession(KEY, token);
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
}

/** The token the page arrived with, if any. Read, not taken: a strict-mode render runs twice. */
export function peekHandoverToken(): string | null {
  return readSession(KEY);
}

/** Once it has been offered, answered or refused alike. */
export function dropHandoverToken(): void {
  removeSession(KEY);
}
