/**
 * Home page structure.
 *
 * The rows carry message keys rather than English sentences: the copy itself
 * lives in `Shared/i18n/dictionary`, so the page reads the same in both
 * languages and a missing Arabic string is a type error rather than an English
 * heading appearing on the Arabic storefront.
 */
import type { MessageKey } from "@shared/i18n/dictionary";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { browse, EMPTY_FILTERS, productsInCategory } from "@shared/commerce/browse";
import { savingPercentOf } from "@shared/commerce/placement";
import { occasionsOn, productsForOccasion, type Occasion } from "@shared/commerce/occasions";
import { curatedProducts, type PublicOccasion } from "@shared/commerce/occasionDesk";
import type { Product } from "@shared/commerce/types";

/**
 * The departments, as the home page draws them.
 *
 * Derived rather than written out: this was a second copy of the list in
 * `Shared/commerce/departments.ts`, carrying its own tints and message keys,
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
 * The home page's computed shelves, in page order, each with its own reason
 * to exist — on the owner's word, who asked for the page as a list: Mega
 * deals, the deals picked for the shopper, the deals for everybody, Picked
 * for you, the seasons and occasions, Trending, Bestsellers, Previously
 * viewed. The two personal rails and Previously viewed are not here: they
 * are about one shopper (`RecommendedRail`, `RecentlyViewedRail`) and keep
 * their own rule, never recommending back what the shopper already has.
 *
 * There were five shelves once — Deals, Popular right now, Bestsellers, Most
 * popular and Newest — and on a catalog of a dozen products they were the
 * same dozen in a different order, five times down one page. A shelf earns
 * its place by what selects it: **Mega deals** is the deepest savings, from
 * `MEGA_DEAL_PERCENT` off (a compare-at price the permit allows, which
 * `fromInventory` has already checked); **Deals** is every other saving,
 * deepest first; **Trending** is what shoppers reached for this week, from
 * the server (`commerce.trending`: bought, bagged, hearted and wished for,
 * weighed); **Bestsellers** is what sold, by units over ninety days
 * (`commerce.bestsellers`) — a different list from the newest rather than the
 * same one reordered; **New arrivals** is what was added most recently. Each
 * leaves out what a shelf above already shows.
 */
export const homeRailDefinitions = [
  { id: "mega", title: "rail.mega.title", select: "offers", layout: "band" },
  { id: "deals", title: "rail.deals.title", select: "offers", layout: "rail" },
  { id: "trending", title: "rail.trending.title", select: "trending", layout: "rail" },
  { id: "bestsellers", title: "rail.bestsellers.title", select: "bestsellers", layout: "rail" },
  { id: "newest", title: "rail.newest.title", select: "newest", layout: "grid" },
] as const satisfies readonly { id: string; title: MessageKey; select: "offers" | "trending" | "bestsellers" | "newest"; layout: "band" | "rail" | "grid" }[];

export type HomeShelfId = (typeof homeRailDefinitions)[number]["id"];

/**
 * Fewer than this and a strip — Deals, Bestsellers — is not drawn: two cards
 * in a row built to scroll sideways read as a broken shelf.
 *
 * It is the strips' floor only. It used to hold New arrivals to it too, and a
 * shop with three products live opened on its departments and nothing else —
 * no product anywhere on the home page of a shop that had them. New arrivals
 * is a grid, the last shelf on the page, and a grid of two is a small shop
 * telling the truth.
 */
export const MIN_SHELF_PRODUCTS = 4;
/** The most one strip carries; "View all" is the rest. */
export const MAX_SHELF_PRODUCTS = 12;
/**
 * The most a shelf with department tabs holds. A shelf is cut by department
 * on the page (`departmentTabs`), and twelve cut five ways is a tab of two,
 * so a tabbed shelf keeps two dozen and its "All" tab draws the first twelve.
 */
export const MAX_TABBED_PRODUCTS = 24;
/**
 * A saving this deep is a mega deal. Thirty per cent, because that is where
 * a shopper stops reading a strikethrough as a nudge and starts reading it as
 * a reason to buy today; below it the saving is still advertised, on the
 * Deals shelf.
 */
export const MEGA_DEAL_PERCENT = 30;
/** A department is a tab only with this many on the shelf: one product is not a department's view. */
export const MIN_TAB_PRODUCTS = 2;
/** The most occasions drawn on one day: the end of the year has three, and the page is not a calendar. */
export const MAX_OCCASIONS = 2;

/**
 * NetLet's own occasions running today, as the server answers them
 * (`occasions.live`): each with the products chosen for it, and the calendar
 * occasions the calendar must not draw by itself — taken over, or switched
 * off.
 */
export type CuratedShelves = { occasions: (PublicOccasion & { products: Product[] })[]; replaced: string[] };

/**
 * An occasion whose shopping is on, with what it shows. Either the calendar's
 * (`occasion`), from the products the stores tagged for it, or one NetLet
 * curated (`curated`), with its own names and picture.
 */
export type OccasionShelf = { slug: string; occasion: Occasion | null; curated: PublicOccasion | null; products: Product[] };
export type HomeShelves = Record<HomeShelfId, Product[]> & { occasions: OccasionShelf[] };

/**
 * What each shelf shows, in page order, given the catalog. A strip below its
 * floor comes back empty, and what it did not show is free for the next —
 * so every product the shop has live is on the home page somewhere, and a
 * small shop is one honest grid rather than an empty page.
 */
export function shelvesFor(catalog: Product[], bestsellers: Product[] = [], trending: Product[] = [], now = new Date(), curated?: CuratedShelves): HomeShelves {
  const shown = new Set<string>();
  const pick = (candidates: Product[], floor: number, most = MAX_SHELF_PRODUCTS) => {
    const fresh = candidates.filter(product => !shown.has(product.id));
    if (fresh.length < floor) return [];
    const chosen = fresh.slice(0, most);
    for (const product of chosen) shown.add(product.id);
    return chosen;
  };
  const offers = browse(catalog, { ...EMPTY_FILTERS, onOffer: true, sort: "discount" });
  const mega = pick(offers.filter(product => savingPercentOf(product) >= MEGA_DEAL_PERCENT), MIN_SHELF_PRODUCTS);
  const deals = pick(offers, MIN_SHELF_PRODUCTS, MAX_TABBED_PRODUCTS);
  /* The seasons and the occasions whose shopping is on today, each from the
     products the stores tagged for it — after the deals, since a saving is
     the stronger reason to show a product, and before Trending. */
  const occasions: OccasionShelf[] = [];
  /* NetLet's own lead (`Shared/commerce/occasionDesk.ts`). What it chose is
     shown whole, in its order — a curator who picked six sees six, whatever a
     shelf above holds — and what the stores tagged follows, less what a shelf
     above shows. Still from four, the strips' floor. */
  for (const { products: picked, ...occasion } of curated?.occasions ?? []) {
    if (occasions.length >= MAX_OCCASIONS) break;
    const chosen = new Set(picked.map(product => product.id));
    const fresh = curatedProducts(occasion, picked, catalog).filter(product => chosen.has(product.id) || !shown.has(product.id));
    if (fresh.length < MIN_SHELF_PRODUCTS) continue;
    const products = fresh.slice(0, MAX_SHELF_PRODUCTS);
    for (const product of products) shown.add(product.id);
    occasions.push({ slug: occasion.slug, occasion: null, curated: occasion, products });
  }
  /* Then the calendar's, but for one NetLet took over or switched off. */
  const replaced = new Set([...(curated?.replaced ?? []), ...occasions.map(shelf => shelf.slug)]);
  for (const occasion of occasionsOn(now)) {
    if (occasions.length >= MAX_OCCASIONS) break;
    if (replaced.has(occasion.slug)) continue;
    const products = pick(productsForOccasion(catalog, occasion), MIN_SHELF_PRODUCTS);
    if (products.length) occasions.push({ slug: occasion.slug, occasion, curated: null, products });
  }
  const hot = pick(trending, MIN_SHELF_PRODUCTS, MAX_TABBED_PRODUCTS);
  const best = pick(bestsellers, MIN_SHELF_PRODUCTS, MAX_TABBED_PRODUCTS);
  const newest = pick(browse(catalog, { ...EMPTY_FILTERS, sort: "newest" }), 1, MAX_TABBED_PRODUCTS);
  return { mega, deals, occasions, trending: hot, bestsellers: best, newest };
}

/**
 * Whether the home page draws a deals shelf at all — Mega deals or Deals —
 * which is the rule every link to the Deals page keeps, so a link never leads
 * to the half-empty shelf the home page refuses to draw.
 */
export function dealsDrawn(shelves: Pick<Record<HomeShelfId, Product[]>, "mega" | "deals">): boolean {
  return shelves.mega.length > 0 || shelves.deals.length > 0;
}

export type DepartmentTab = { slug: string; label: MessageKey; products: Product[] };

/**
 * A shelf cut by department, for the row of tabs over it — Noon's
 * bestsellers, on the owner's word ("category tabs at the top … allowing
 * customers to switch between categories without leaving the section").
 *
 * A department is a tab with `MIN_TAB_PRODUCTS` of the shelf in it, in the
 * departments' own order, and each tab keeps the shelf's order — so a
 * bestseller is still ranked inside its department. No row is offered when
 * it could change nothing: one department holding the whole shelf is the
 * "All" tab said twice, and a control that changes nothing is worse than no
 * control.
 */
export function departmentTabs(products: Product[]): DepartmentTab[] {
  const tabs = DEPARTMENTS
    .map(department => ({ slug: department.slug, label: department.label, products: productsInCategory(products, department.name) }))
    .filter(tab => tab.products.length >= MIN_TAB_PRODUCTS);
  if (tabs.length === 1 && tabs[0].products.length === products.length) return [];
  return tabs;
}

/**
 * Footer links carry the category query they select, so "Electronics" in the
 * footer lands on the same filtered view as "Electronics" in the header rail
 * instead of raising a "coming soon" toast.
 */

/**
 * The message key for a merchant's department name, when NetLet has one.
 *
 * Product types are merchant-written, so most have no translation and are shown
 * as typed. NetLet's own departments do have one, and showing "Electronics" on
 * the Arabic storefront when "الإلكترونيات" exists would be a gap the shopper
 * reads as an unfinished translation.
 */
export function categoryMessageKey(category: string): MessageKey | null {
  return categoryRail.find((entry) => entry.query === category)?.key ?? null;
}
