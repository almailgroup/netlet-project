/**
 * `localStorage`, for a browser that may refuse to have one.
 *
 * Reading it is not a safe operation. With site data blocked — Chrome's "block
 * all cookies", a restrictive WebView, some corporate policies — the *getter*
 * throws a `SecurityError` before any key is named, and in a full-storage
 * private window `setItem` throws a quota error. Neither returns null; both
 * throw.
 *
 * That mattered here more than it usually does, because `CustomerProvider`
 * reads the stored locale while it renders and it sits near the root of the
 * tree. One unguarded `getItem` therefore took the whole storefront down to
 * "An unexpected error occurred" — every page, for every visitor with site data
 * off. `referral.ts` had already written the rule down and wrapped all three of
 * its own accesses; the contexts had not, which is what a rule kept in prose
 * next to one caller does.
 *
 * So the rule lives here now and nothing else touches `window.localStorage`:
 *
 * - **A read that fails reads as absent.** Which is true: there is nothing
 *   stored, and there was never going to be.
 * - **A write that fails is dropped in silence.** Everything kept here is a
 *   per-viewer convenience — the language in use, the delivery area, the guest
 *   cart's id, a referral code. Losing one costs a shopper a preference they
 *   can set again. Anything NetLet actually needs is on the server, which is
 *   the reason that trade is available at all.
 */

/** Whatever is stored under `key`, or null — including when storage refuses. */
export function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value` under `key` if the browser allows it. */
export function writeStored(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Blocked or full. The value holds for this page view and no longer. */
  }
}

/** Forget `key`, if there is anywhere to forget it from. */
export function removeStored(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* Nothing was stored, so nothing needs removing. */
  }
}

/**
 * A stored JSON array of strings, or an empty one.
 *
 * Both failures collapse to the same answer on purpose: storage that refused,
 * and a value some earlier version of the site wrote in another shape. Neither
 * is worth a branch at the call site, and neither is worth a crash.
 */
export function readStoredList(key: string): string[] {
  const raw = readStored(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/*
 * `sessionStorage`, by the same rules: it throws where `localStorage` does,
 * and for the same reasons. It holds what belongs to one tab and should end
 * with it — the shop assistant's conversation, kept across a reload but never
 * left on a shared computer once the tab is closed.
 */

/** Whatever this tab stored under `key`, or null — including when storage refuses. */
export function readSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value` for this tab if the browser allows it. */
export function writeSession(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Blocked or full: the conversation holds until the page is left. */
  }
}

/** Forget `key` for this tab. */
export function removeSession(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* Nothing was stored. */
  }
}
