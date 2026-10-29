/**
 * Back to the page the shopper came from, on the owner's word.
 *
 * A page's own way back used to be a link forward: the account sections'
 * round arrow was `href="/account"`, so pressing it pushed the account home
 * onto the history, and the browser's (or the phone's) Back afterwards
 * returned to the section just left — a loop, and never the page somebody
 * opened the section from (the bell or the heart in the header, a product).
 *
 * Every entry the app writes carries how deep into this visit it is and the
 * address it was opened from (`netletDepth`, `netletFrom`, kept in the entry's
 * own `history.state`, so a reload, Back and Forward each find their own).
 * `goBack` steps back through the browser's own history while there is an
 * entry of this visit behind — the same as the Back button, scroll position
 * and all — and otherwise opens the page's parent instead, so a page reached
 * from another site or a fresh tab never sends the shopper off NetLet.
 *
 * The history is wrapped once, at start-up, after wouter has patched it, so
 * both see every push and replace.
 */
import { BASE_PATH } from "@/lib/basePath";

const DEPTH = "netletDepth";
const FROM = "netletFrom";

type Marked = Record<string, unknown> & { [DEPTH]?: number; [FROM]?: string };

const stateOf = (value: unknown): Marked =>
  value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};

const current = (): Marked => (typeof window === "undefined" ? {} : stateOf(window.history.state));

const here = () => {
  const path = window.location.pathname;
  const inApp = BASE_PATH && path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) || "/" : path;
  return inApp + window.location.search;
};

let installed = false;

export function installHistoryDepth(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const { history } = window;
  if (typeof current()[DEPTH] !== "number") history.replaceState({ ...current(), [DEPTH]: 0 }, "");
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    const depth = (current()[DEPTH] ?? 0) + 1;
    push({ ...stateOf(state), [DEPTH]: depth, [FROM]: here() }, title, url);
  };
  history.replaceState = (state: unknown, title: string, url?: string | URL | null) => {
    const kept = current();
    replace({ ...stateOf(state), [DEPTH]: kept[DEPTH] ?? 0, [FROM]: kept[FROM] }, title, url);
  };
}

/** Whether an entry of this visit is behind this one. */
export function canGoBack(): boolean {
  return (current()[DEPTH] ?? 0) > 0;
}

/** The address this page was opened from in this visit, path and query. */
export function cameFrom(): string | null {
  return canGoBack() ? (current()[FROM] ?? null) : null;
}

/**
 * A press on a page's own way back: Back through the history when this visit
 * has an entry behind, else nothing — the link's own address, the page's
 * parent, is opened instead. Meant for a link's `onClick`, so a press with
 * Ctrl, ⌘ or Shift still opens the parent in a new tab.
 */
export function goBack(event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void {
  if (event.button !== undefined && event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!canGoBack()) return;
  event.preventDefault();
  window.history.back();
}
