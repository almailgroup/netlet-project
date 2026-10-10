/**
 * Home page structure.
 *
 * The rows carry message keys rather than English sentences: the copy itself
 * lives in `shared/i18n/dictionary`, so the page reads the same in both
 * languages and a missing Arabic string is a type error rather than an English
 * heading appearing on the Arabic storefront.
 */
import type { MessageKey } from "@shared/i18n/dictionary";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { browse, EMPTY_FILTERS } from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";

/**
 * The departments, as the home page draws them.
 *
 * Derived rather than written out: this was a second copy of the list in
 * `shared/commerce/departments.ts`, carrying its own tints and message keys,
 * which is exactly the drift that file exists to prevent — a department added
 * in one place and missing from the other. "All" leads, because it is the
 * absence of a filter rather than a department and so is not in the list
 * itself.
 */
export const categoryRail: readonly { key: MessageKey; query: string; color: string }[] = [
  { key: ALL_DEPARTMENTS.label, query: ALL_DEPARTMENTS.query, color: ALL_DEPARTMENTS.tint },
  ...DEPARTMENTS.map(department => ({
    key: department.label,
    query: department.name,
    color: department.tint,
  })),
];

/**
 * The home page's shelves: two, and each with its own reason to exist.
 *
 * There were five — Deals, Popular right now, Bestsellers, Most popular and
 * Newest — and on a catalog of a dozen products they were the same dozen in a
 * different order, five times down one page. A shelf earns its place by what
 * selects it: **Deals** is what is actually discounted (a compare-at price the
 * permit allows, which `fromInventory` has already checked), deepest saving
 * first; **Newest** is what was added most recently, leaving out anything the
 * Deals shelf above already shows.
 */
export const homeRailDefinitions = [
  { id: "deals", title: "rail.deals.title", description: "rail.deals.description", treatment: "light", select: "offers" },
  { id: "newest", title: "rail.newest.title", description: "rail.newest.description", treatment: "navy", select: "newest" },
] as const satisfies readonly { id: string; title: MessageKey; description: MessageKey; treatment: string; select: "offers" | "newest" }[];

/** Fewer than this and a shelf is not drawn: one or two products under a heading read as a broken page. */
export const MIN_SHELF_PRODUCTS = 4;
/** The most one shelf carries; "View all" is the rest. */
export const MAX_SHELF_PRODUCTS = 12;

/**
 * What each shelf shows, in page order, given the catalog. A shelf below the
 * floor comes back empty, and what an empty shelf did not show is free for the
 * next one — so a small shop is one full shelf rather than two half ones.
 */
export function shelvesFor(catalog: Product[]): Record<(typeof homeRailDefinitions)[number]["id"], Product[]> {
  const shown = new Set<string>();
  const pick = (candidates: Product[]) => {
    const fresh = candidates.filter(product => !shown.has(product.id));
    if (fresh.length < MIN_SHELF_PRODUCTS) return [];
    const chosen = fresh.slice(0, MAX_SHELF_PRODUCTS);
    for (const product of chosen) shown.add(product.id);
    return chosen;
  };
  const deals = pick(browse(catalog, { ...EMPTY_FILTERS, onOffer: true, sort: "discount" }));
  const newest = pick(browse(catalog, { ...EMPTY_FILTERS, sort: "newest" }));
  return { deals, newest };
}

export const editorialUpdates = [
  { date: "editorial.delivery.date", title: "editorial.delivery.title", summary: "editorial.delivery.summary" },
  { date: "editorial.edit.date", title: "editorial.edit.title", summary: "editorial.edit.summary" },
  { date: "editorial.guide.date", title: "editorial.guide.title", summary: "editorial.guide.summary" },
] as const satisfies readonly { date: MessageKey; title: MessageKey; summary: MessageKey }[];

/**
 * Footer links carry the category query they select, so "Electronics" in the
 * footer lands on the same filtered view as "Electronics" in the header rail
 * instead of raising a "coming soon" toast.
 */

/**
 * The message key for a merchant's department name, when NetLet has one.
 *
 * Product types are merchant-written, so most have no translation and are shown
 * as typed. The six named departments do have one, and showing "Electronics" on
 * the Arabic storefront when "الإلكترونيات" exists would be a gap the shopper
 * reads as an unfinished translation.
 */
export function categoryMessageKey(category: string): MessageKey | null {
  return categoryRail.find((entry) => entry.query === category)?.key ?? null;
}
