/**
 * Moving between pages without a blank moment.
 *
 * A page's code is fetched the first time it is needed, and until it arrives
 * React shows the page's outline instead — and, once it has shown an outline,
 * deliberately keeps it up for at least about 300ms so that a quick sequence
 * of arrivals does not flicker. So every first visit to a page cost at least
 * that: the page being read vanished, a grey outline stood in its place, and
 * the real page arrived after it, on a fast connection as much as a slow one.
 *
 * Here the move waits instead. A press on a link whose page has not arrived
 * starts fetching it and leaves the current page where it is, with a slim bar
 * across the top saying something is happening; the address changes when the
 * code is in, and the new page draws whole. It is how a native app and most
 * large shops move: the old screen stays until the new one is ready. The wait
 * is capped — past `MAX_WAIT_MS` the move happens anyway and the outline does
 * its job — so a slow network is never a press that seems to have done
 * nothing. A second press before the first lands wins, and Back cancels the
 * wait, so nothing arrives after the shopper has gone somewhere else.
 *
 * Most moves never wait at all: `useIntentPrefetch` has usually fetched the
 * page by the time the press lands, and a page already here is moved to at once.
 *
 * This is the router's location hook (`<Router hook>`), so every `<Link>` and
 * every `navigate()` in the app goes through it. The cart, which sits outside
 * the router, calls `navigateWhenReady` itself.
 */
import { navigate as go, useBrowserLocation } from "wouter/use-browser-location";
import { BASE_PATH } from "@/lib/basePath";

/** Longest a press waits for a page's code before moving anyway. */
export const MAX_WAIT_MS = 2500;

type Options = { replace?: boolean; state?: unknown };

/* Given an in-app path, the fetch to wait for — or null when the page is here. */
let pending: (path: string) => (() => Promise<unknown>) | null = () => null;

/** The app tells this module how to find a page's code; see `App`. */
export function setPageResolver(resolve: (path: string) => (() => Promise<unknown>) | null) {
  pending = resolve;
}

/* Whether a move is waiting, for the progress bar. */
let waiting = false;
const listeners = new Set<() => void>();
const setWaiting = (next: boolean) => {
  if (waiting === next) return;
  waiting = next;
  listeners.forEach(listener => listener());
};
export const subscribeWaiting = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const isWaiting = () => waiting;

let ticket = 0;
if (typeof window !== "undefined") {
  /* Back or Forward while a move waits: the shopper has gone elsewhere. */
  window.addEventListener("popstate", () => {
    ticket++;
    setWaiting(false);
  });
}

const inAppPath = (to: string) => {
  const path = to.split(/[?#]/)[0] || "/";
  if (!BASE_PATH) return path;
  return path === BASE_PATH ? "/" : path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
};

/** Moves to `to` (an address with the base path on) once its page's code is here. */
export function navigateWhenReady(to: string, options?: Options) {
  const mine = ++ticket;
  const fetchPage = pending(inAppPath(to));
  if (!fetchPage) {
    setWaiting(false);
    go(to, options);
    return;
  }
  setWaiting(true);
  const cap = new Promise(resolve => window.setTimeout(resolve, MAX_WAIT_MS));
  void Promise.race([fetchPage().catch(() => undefined), cap]).then(() => {
    if (mine !== ticket) return;
    setWaiting(false);
    go(to, options);
  });
}

/** The router's location hook: the browser's address, moved by `navigateWhenReady`. */
export function useReadyLocation(options: { ssrPath?: string } = {}): [string, typeof navigateWhenReady] {
  const [location] = useBrowserLocation(options);
  return [location, navigateWhenReady];
}
