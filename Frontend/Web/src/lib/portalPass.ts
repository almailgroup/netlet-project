/**
 * A sign-in carried from one address to a portal's (`Shared/portal.ts`).
 *
 * Each address keeps its own session cookie, so the shop's sign-in does not
 * sign anybody in on `admin.` or `vendor.`. Somebody who belongs on a portal
 * is handed a one-time pass by the server (`auth.login` with `portal`, or
 * `auth.portalPass`), which travels to the portal's sign-in page in the
 * address's fragment — never sent to a server, kept in no log — and is spent
 * there once (`auth.portalHandoff`).
 *
 * Read as the app starts, before anything else looks at the address, and taken
 * out of it at once: a pass left in the address bar or the history is a key to
 * the account for as long as it lives.
 */
import { BASE_PATH } from "@/lib/basePath";
import { PORTAL_SIDE } from "@/lib/portalHost";

let waiting: string | null = null;

/** As the app starts, on a portal's address: keeps the pass and clears the fragment. */
export function catchPortalPass(): void {
  if (typeof window === "undefined" || !PORTAL_SIDE) return;
  const found = /(?:^#|&)pass=([^&]+)/.exec(window.location.hash);
  if (!found) return;
  try {
    waiting = decodeURIComponent(found[1]);
  } catch {
    waiting = null;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname || `${BASE_PATH}/`}${search}`);
}

/** The pass the sign-in page arrived with. Read, not taken: a strict-mode render runs twice. */
export function peekPortalPass(): string | null {
  return waiting;
}

/** Once it has been offered, spent or refused alike. */
export function dropPortalPass(): void {
  waiting = null;
}

/**
 * Opens a portal in a new tab, and says whether the browser let it. A page may
 * open one only soon after a press, and a sign-in's round trip can outlast
 * that in some browsers — so a refusal is reported for the caller to offer a
 * button, whose own press opens it.
 *
 * No `noopener` in the features, because with it `window.open` answers null
 * whether or not the tab opened; the new tab's link back is cut instead.
 */
export function openPortalTab(url: string): boolean {
  const tab = window.open(url, "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
  } catch {
    /* Already on the portal's address: nothing to cut from here. */
  }
  return true;
}
