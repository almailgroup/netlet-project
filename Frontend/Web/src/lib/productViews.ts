/**
 * Counting a product page's opening (`Shared/commerce/productViews.ts` is the
 * rule): which channel this is, where the page was opened from, and whether
 * this device has counted the product already today.
 *
 * **The device keeps the day's list, not NetLet**: the ids counted today, in
 * `browserStore`, emptied when the Kuwaiti day turns, so the server is told
 * only "a view, and the first today" and never who or which device. A
 * browser driven by automation (`navigator.webdriver`) and the demo build
 * count nothing.
 *
 * **Where from** is the address the page was opened from in this visit
 * (`cameFrom`), or — for a press that opens a product over the page under it,
 * the header's search suggestions or NetLet AI's shelf — the hint that press
 * left (`noteViewSource`), good for `SOURCE_HINT_MS`.
 */
import { readStored, writeStored } from "@/lib/browserStore";
import { cameFrom } from "@/lib/inAppBack";
import { DEMO_MODE } from "@/lib/demoMode";
import { kuwaitDay } from "@shared/kuwaitDay";
import { SOURCE_HINT_MS, sourceOfPath, type ViewChannel, type ViewSource } from "@shared/commerce/productViews";

const KEY = "netlet.viewsCounted";
/** More than anybody opens in a day; past it the oldest are forgotten and may count twice. */
const MOST_KEPT = 400;

export type CountedToday = { day: string; ids: string[] };

/** Whether `id` is new today, and the list with it added. Pure, so it can be tested. */
export function countToday(held: unknown, id: string, day: string): { first: boolean; next: CountedToday } {
  const list = held && typeof held === "object" && (held as CountedToday).day === day && Array.isArray((held as CountedToday).ids)
    ? (held as CountedToday).ids.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (list.includes(id)) return { first: false, next: { day, ids: list } };
  return { first: true, next: { day, ids: [...list, id].slice(-MOST_KEPT) } };
}

let hint: { source: ViewSource; at: number } | null = null;

/** The next product page opened came from here (a search suggestion, NetLet AI). */
export function noteViewSource(source: ViewSource): void {
  hint = { source, at: Date.now() };
}

/** Where the page being opened came from, spending the hint. */
export function viewSource(now = Date.now()): ViewSource {
  const held = hint;
  hint = null;
  if (held && now - held.at < SOURCE_HINT_MS) return held.source;
  return sourceOfPath(cameFrom());
}

/** The website on a touch screen is a phone (or a tablet); with a mouse, a computer. */
export function viewChannel(): ViewChannel {
  try {
    return window.matchMedia("(pointer: coarse)").matches ? "web_phone" : "web_computer";
  } catch {
    return "web_computer";
  }
}

/** Whether this browser counts views at all. */
export function countsViews(): boolean {
  if (DEMO_MODE || typeof window === "undefined") return false;
  try {
    return !navigator.webdriver;
  } catch {
    return true;
  }
}

/** The day's list read, `id` marked in it, and whether it was new. */
export function markCounted(id: string, now = new Date()): boolean {
  let held: unknown = null;
  try {
    held = JSON.parse(readStored(KEY) ?? "null");
  } catch {
    held = null;
  }
  const { first, next } = countToday(held, id, kuwaitDay(now));
  if (first) writeStored(KEY, JSON.stringify(next));
  return first;
}
