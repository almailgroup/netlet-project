/**
 * What this device searched for lately.
 *
 * The empty search box used to list the first four products of the catalogue
 * under the heading "Popular searches" — nothing counts what anybody searches,
 * so the heading was a claim with nothing behind it. What the box can say
 * truthfully is what *you* looked for, which is also the thing people reach
 * for most when they come back.
 *
 * Kept on the device through `browserStore` and never sent anywhere: a search
 * history is the kind of thing a shopper should not have to wonder about, and
 * the box offers to clear it.
 */
import { readStored, removeStored, writeStored } from "@/lib/browserStore";

const KEY = "netlet.recentSearches";
export const MAX_RECENT = 6;
/** Longer than any honest search; a pasted paragraph is not one to offer back. */
const MAX_TERM = 80;

/** The list with `term` put first, once, whatever its case. Pure, so it can be tested. */
export function withRecent(list: readonly string[], term: string): string[] {
  const clean = term.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > MAX_TERM) return [...list];
  const key = clean.toLocaleLowerCase();
  return [clean, ...list.filter(entry => entry.toLocaleLowerCase() !== key)].slice(0, MAX_RECENT);
}

export function readRecentSearches(): string[] {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(term: string): string[] {
  const next = withRecent(readRecentSearches(), term);
  writeStored(KEY, JSON.stringify(next));
  return next;
}

export function clearRecentSearches(): void {
  removeStored(KEY);
}
