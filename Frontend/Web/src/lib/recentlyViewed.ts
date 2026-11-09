/**
 * What this device looked at lately — the "Previously viewed" shelf, on the
 * owner's word ("products that customers have recently browsed, allowing them
 * to easily revisit items without searching again").
 *
 * Kept on the device through `browserStore`, the recent searches' rule: a
 * viewing history is the kind of thing a shopper should not have to wonder
 * about, so nothing here goes to the server to be stored, and the shelf
 * offers to clear it. The one place the ids leave the device is with a
 * request for the shopper's picks (`recommendations.forMe`), where they are
 * the weakest signal and are read and dropped — the privacy policy says so.
 *
 * The product page records an opening by the product's id, newest first and
 * once; the shelf reads the products back by id (`commerce.products.byIds`),
 * so what is drawn is today's price and photo and not a copy of the page.
 * Nothing older than `VIEWED_DAYS` is offered back: "previously viewed" is a
 * way back to last week's browsing, not a record of last year's.
 */
import { readStored, removeStored, writeStored } from "@/lib/browserStore";

const KEY = "netlet.recentlyViewed";
/** The most kept, and the most a request for picks carries (`MAX_VIEWED` on the server). */
export const MAX_VIEWED = 24;
/** Older than this, an opening is forgotten. */
export const VIEWED_DAYS = 90;
/** Longer than any product id; the storefront's is a number or a demo handle. */
const MAX_ID = 191;

export type Viewed = { id: string; at: number };

/** The list with `id` put first, once. Pure, so it can be tested. */
export function withViewed(list: readonly Viewed[], id: string, at: number): Viewed[] {
  if (!id || id.length > MAX_ID) return [...list];
  return [{ id, at }, ...list.filter(entry => entry.id !== id)].slice(0, MAX_VIEWED);
}

/** The entries still worth offering: well formed, newest first, inside the window. */
export function freshViewed(list: readonly unknown[], now: number): Viewed[] {
  const floor = now - VIEWED_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const out: Viewed[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { id, at } = entry as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || !id || id.length > MAX_ID || typeof at !== "number" || !Number.isFinite(at)) continue;
    if (at < floor || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, at });
  }
  return out.sort((left, right) => right.at - left.at).slice(0, MAX_VIEWED);
}

export function readViewed(now = Date.now()): Viewed[] {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? "[]");
    return Array.isArray(parsed) ? freshViewed(parsed, now) : [];
  } catch {
    return [];
  }
}

/** The ids alone, newest first — what the shelf asks for and a request for picks carries. */
export function viewedIds(now = Date.now()): string[] {
  return readViewed(now).map(entry => entry.id);
}

export function rememberViewed(id: string, now = Date.now()): Viewed[] {
  const next = withViewed(readViewed(now), id, now);
  writeStored(KEY, JSON.stringify(next));
  return next;
}

/**
 * The list without one product or several — the browsing history's own
 * remove, and its "Delete (n)" for what was chosen, on the owner's word.
 */
export function withoutViewed(list: readonly Viewed[], ids: string | readonly string[]): Viewed[] {
  const gone = new Set(typeof ids === "string" ? [ids] : ids);
  return list.filter(entry => !gone.has(entry.id));
}

export function forgetViewed(ids: string | readonly string[], now = Date.now()): Viewed[] {
  const next = withoutViewed(readViewed(now), ids);
  if (next.length) writeStored(KEY, JSON.stringify(next));
  else removeStored(KEY);
  return next;
}

export function clearViewed(): void {
  removeStored(KEY);
}
