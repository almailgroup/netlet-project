/**
 * The shop's public shelves, remembered on this device so a returning shopper
 * opens on products rather than on grey outlines.
 *
 * Every page used to start empty: the catalogue, the departments' counts, the
 * product being opened — all asked for again after the page's code had
 * arrived, so a phone spent most of a second on placeholders on every visit,
 * the hundredth as much as the first. These reads are the same for everybody
 * (none of them depends on who is signed in), so what this device was shown
 * last is drawn at once and asked for again behind it; the server's answer
 * replaces it the moment it lands. Nothing about the shopper is kept: no
 * bag, order, account or search they typed.
 *
 * **A remembered shelf lasts the Kuwaiti day it was read on, and no longer.**
 * A shelf carries struck-through prices, and a store's discount permit ends at
 * the end of a Kuwaiti day — so a saving remembered from the day a permit
 * lapsed could otherwise be drawn, for a moment, on a day it may not be
 * advertised. Everything older than today is dropped on reading.
 *
 * Stored through `browserStore`, so blocked site data means nothing is
 * remembered and the shop behaves as it always did.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import superjson from "superjson";
import { readStored, removeStored, writeStored } from "@/lib/browserStore";
import { kuwaitDay } from "@shared/kuwaitDay";

const STORE_KEY = "netlet:shelves:v1";

/** The public reads worth remembering: what a shopping page draws first. */
const REMEMBERED = new Set([
  "commerce.products.list",
  "commerce.products.byHandle",
  "commerce.departmentCounts",
  "commerce.bestsellers",
  "commerce.brands",
  "commerce.stores",
  "commerce.store",
  "features.states",
  "guides.published",
  "support.channels",
]);

/* At most this many products opened one by one are kept, the newest first. */
const MAX_PRODUCTS = 24;
/* And at most this much text in all, well inside what any browser allows. */
const MAX_CHARS = 1_500_000;

type Entry = { key: QueryKey; data: string; at: number; day: string };

function pathOf(key: QueryKey): string | null {
  const [path] = key as [unknown];
  return Array.isArray(path) ? path.join(".") : null;
}

function readAll(): Entry[] {
  const raw = readStored(STORE_KEY);
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw) as Entry[];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Put today's remembered shelves into the cache before the first page draws.
 * Each keeps the time it was read, so a page asks again behind it exactly as
 * it would for anything its own staleness rule calls old.
 */
export function restoreShelves(client: QueryClient, now = new Date()): void {
  const today = kuwaitDay(now);
  for (const entry of readAll()) {
    if (entry.day !== today) continue;
    const path = pathOf(entry.key);
    if (!path || !REMEMBERED.has(path)) continue;
    try {
      client.setQueryData(entry.key, superjson.parse(entry.data), { updatedAt: entry.at });
    } catch {
      /* A shape this build no longer reads is simply not drawn. */
    }
  }
}

/**
 * Remember each of those reads when it succeeds — after the page is idle, and
 * at most once a second, so remembering never costs a frame.
 */
export function rememberShelves(client: QueryClient): () => void {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    const today = kuwaitDay(new Date());
    const entries: Entry[] = [];
    for (const query of client.getQueryCache().getAll()) {
      const path = pathOf(query.queryKey);
      if (!path || !REMEMBERED.has(path) || query.state.status !== "success" || query.state.data === undefined) continue;
      entries.push({ key: query.queryKey, data: superjson.stringify(query.state.data), at: query.state.dataUpdatedAt, day: today });
    }
    /* The newest first, the single products capped, then the whole to its ceiling. */
    entries.sort((left, right) => right.at - left.at);
    let products = 0;
    let chars = 0;
    const kept = entries.filter(entry => {
      if (pathOf(entry.key) === "commerce.products.byHandle" && ++products > MAX_PRODUCTS) return false;
      chars += entry.data.length;
      return chars <= MAX_CHARS;
    });
    if (kept.length) writeStored(STORE_KEY, JSON.stringify(kept));
    else removeStored(STORE_KEY);
  };
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const path = pathOf(event.query.queryKey);
    if (!path || !REMEMBERED.has(path) || timer !== undefined) return;
    timer = window.setTimeout(() => {
      const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(save, { timeout: 3000 });
      else save();
    }, 1000);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
