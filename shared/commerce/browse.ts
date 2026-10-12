/**
 * Browsing a category: what can be filtered, and what filtering does.
 *
 * Kept here, pure and tested, for the same reason as the rest of
 * `shared/commerce` — the page that renders a facet list should not also be
 * the thing that decides what a facet is. It means a filter can be proved
 * correct against a catalog fixture rather than by clicking one.
 *
 * The facets are derived from the catalog rather than declared. A storefront
 * that hard-codes "Ram Size" has a filter that is wrong for shoes; one that
 * reads the product options a merchant actually configured has the right
 * filters for whatever they sell, on the day they add it. Every facet also
 * carries a count, because a filter that leads to an empty page is worse than
 * no filter at all.
 */
import { isExpressEligible, productRating } from "./productDetail.js";
import type { Product } from "./types.js";
import { withPlacement } from "./placement.js";
import { DELIVERY_SPEEDS, type DeliverySpeed } from "./deliverySpeed.js";
import { brandOf } from "./search.js";

/* The search itself lives in `search.ts`; re-exported for the callers that
   have always taken it from here. */
export { matchesSearch, rankBySearch, correctionFor } from "./search.js";

export type BrowseSort = "relevance" | "price-low" | "price-high" | "discount" | "rating" | "newest";

export const BROWSE_SORTS: BrowseSort[] = ["relevance", "price-low", "price-high", "discount", "rating", "newest"];

export type BrowseFilters = {
  /** Merchant product type, or "all". */
  category: string;
  /** The maker, from the product's own Brand row. */
  brands: string[];
  /** The store selling it. "Brand" used to mean this, which is not what a shopper ticking "Samsung" means. */
  sellers: string[];
  /** How soon it ships, by the seller's own band. */
  speeds: DeliverySpeed[];
  /** Selected values per product option, e.g. { Colour: ["Charcoal"] }. */
  options: Record<string, string[]>;
  minPrice: number | null;
  maxPrice: number | null;
  /** Minimum star rating, e.g. 4 for "4 and up". */
  minRating: number | null;
  inStock: boolean;
  onOffer: boolean;
  express: boolean;
  sort: BrowseSort;
};

export const EMPTY_FILTERS: BrowseFilters = {
  category: "all",
  brands: [],
  sellers: [],
  speeds: [],
  options: {},
  minPrice: null,
  maxPrice: null,
  minRating: null,
  inStock: false,
  onOffer: false,
  express: false,
  sort: "relevance",
};

/* --------------------------------------------------------------- slugs --- */

/**
 * A category name as it appears in a URL.
 *
 * Product types are merchant-written — "Home & Kitchen", "Health & Nutrition" —
 * and percent-encoding them produces a link nobody can read or trust. The slug
 * is lossy on purpose; `categoryFromSlug` resolves it back against the catalog
 * rather than trying to invert it.
 */
export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "all";
}

/** The product type a slug refers to, or "all" when nothing matches. */
export function categoryFromSlug(slug: string, categories: string[]): string {
  if (!slug || slug === "all") return "all";
  return categories.find((category) => categorySlug(category) === slug) ?? "all";
}

/**
 * Every department a slug may name: NetLet's own, whether or not anything is
 * on their shelves yet, and any product type a merchant typed.
 *
 * Resolving against the catalog alone is what sent `/category/home-and-kitchen`
 * to "2 results for All products": a department with nothing in it was not a
 * product type of anything, so the slug matched nothing and fell back to the
 * whole shop. A department exists before its first product does.
 */
export function knownCategories(departmentNames: readonly string[], products: Product[]): string[] {
  const types = products.map((product) => product.productType).filter((type): type is string => Boolean(type));
  return Array.from(new Set([...departmentNames, ...types]));
}

/* --------------------------------------------------------------- search --- */

/**
 * The query-string key a search term travels under. Not a facet: it narrows
 * whatever department the page is showing, and `/search` is that page for the
 * whole catalog.
 */
export const SEARCH_PARAM = "q";

/** Where a search for this term lands: the ordinary results page, not a model. */
export function searchPath(term: string): string {
  const trimmed = term.trim();
  return trimmed ? `/search?${SEARCH_PARAM}=${encodeURIComponent(trimmed)}` : "/search";
}

/** The term in a query string, trimmed, or "". */
export function searchTermFrom(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return (params.get(SEARCH_PARAM) ?? "").trim().slice(0, 200);
}

/** The query string for these filters with a search term kept beside them. */
export function searchWithTerm(filters: BrowseFilters, term: string): string {
  const query = searchFromFilters(filters);
  const trimmed = term.trim();
  if (!trimmed) return query;
  const param = `${SEARCH_PARAM}=${encodeURIComponent(trimmed)}`;
  return query ? `${query}&${param}` : `?${param}`;
}

/* -------------------------------------------------------------- helpers --- */

function priceOf(product: Product): number {
  return Number(product.priceRange.min.amount);
}

function isAvailable(product: Product): boolean {
  return product.variants.some((variant) => variant.availableForSale);
}

function isOnOffer(product: Product): boolean {
  return product.variants.some((variant) => variant.compareAtPrice !== null);
}

/** How deep the best discount on a product goes, as a fraction. */
function discountOf(product: Product): number {
  let best = 0;
  for (const variant of product.variants) {
    const was = Number(variant.compareAtPrice?.amount ?? 0);
    const now = Number(variant.price.amount);
    if (was > now && was > 0) best = Math.max(best, (was - now) / was);
  }
  return best;
}

function ratingOf(product: Product): number {
  const rating = productRating(product.attributes);
  if (!rating) return 0;
  // Normalised to five, so a store publishing out of ten still sorts sanely.
  return (rating.value / rating.scaleMax) * 5;
}

/** Every option value a product offers, as "Option:Value" pairs. */
function optionPairs(product: Product): [string, string][] {
  return product.options.flatMap((option) =>
    option.values.map((value) => [option.name, value] as [string, string]),
  );
}

/* --------------------------------------------------------------- facets --- */

/**
 * Whether a facet's values can change what is shown: two or more, or one that
 * not every product carries — "Samsung (2)" on a page of five narrows to two.
 */
export function facetNarrows(values: FacetValue[], total: number): boolean {
  return values.length > 1 || (values.length === 1 && values[0].count < total);
}

export type FacetValue = { value: string; count: number };
export type OptionFacet = { name: string; values: FacetValue[] };

export type Facets = {
  /** How many products the facets were counted over, so a page can tell whether one value narrows anything. */
  total: number;
  categories: FacetValue[];
  brands: FacetValue[];
  sellers: FacetValue[];
  speeds: FacetValue[];
  options: OptionFacet[];
  /** Absent when nothing is priced, so the page can hide the control. */
  priceBounds: { min: number; max: number } | null;
  ratings: FacetValue[];
  inStock: number;
  onOffer: number;
  express: number;
};

function tally(values: string[]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

/**
 * What can be filtered, given these products.
 *
 * Counts are over the products passed in, so a page that has already narrowed
 * by category shows how many of *those* are Sony rather than how many exist in
 * the whole catalog — which is what a shopper reads the number as.
 *
 * A facet with only one value is dropped: offering "Brand: Sony (12)" on a page
 * where every product is a Sony is a control that cannot change anything.
 */
export function facetsFor(products: Product[]): Facets {
  const optionValues = new Map<string, string[]>();
  for (const product of products) {
    for (const [name, value] of optionPairs(product)) {
      // A product with nothing to choose has no option dimensions at all, so
      // there is no placeholder name to skip here — see optionsFromVariants.
      if (!name) continue;
      optionValues.set(name, [...(optionValues.get(name) ?? []), value]);
    }
  }

  const prices = products.map(priceOf).filter((price) => Number.isFinite(price));

  return {
    total: products.length,
    categories: tally(products.map((p) => p.productType).filter((t): t is string => Boolean(t))),
    brands: tally(products.map(brandOf).filter((b): b is string => Boolean(b))),
    sellers: tally(products.map((p) => p.vendor).filter((v): v is string => Boolean(v))),
    /* In the bands' own order, fastest first, rather than by count. */
    speeds: tally(products.map((p) => p.deliverySpeed).filter((v): v is DeliverySpeed => Boolean(v)))
      .sort((left, right) => DELIVERY_SPEEDS.indexOf(left.value as DeliverySpeed) - DELIVERY_SPEEDS.indexOf(right.value as DeliverySpeed)),
    options: Array.from(optionValues.entries())
      .map(([name, values]) => ({ name, values: tally(values) }))
      .filter((facet) => facet.values.length > 1)
      .sort((left, right) => left.name.localeCompare(right.name)),
    priceBounds: prices.length ? { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) } : null,
    // Cumulative — "4 and up" includes the fives — and dropped when the
    // threshold matches everything on the page. A row that cannot remove a
    // single product is a control that looks like it does something.
    ratings: [4, 3, 2, 1]
      .map((threshold) => ({ value: String(threshold), count: products.filter((p) => ratingOf(p) >= threshold).length }))
      .filter((entry) => entry.count > 0 && entry.count < products.length),
    inStock: products.filter(isAvailable).length,
    onOffer: products.filter(isOnOffer).length,
    express: products.filter(isExpressEligible).length,
  };
}

/* ---------------------------------------------------------------- apply --- */

/** Products in `category`, before any of the sidebar's filters are applied. */
export function productsInCategory(products: Product[], category: string): Product[] {
  if (category === "all") return products;
  return products.filter(
    (product) => product.productType === category || product.tags.includes(category),
  );
}

/**
 * The sidebar's filters, applied.
 *
 * Values within one facet are OR-ed and separate facets are AND-ed, which is
 * what a shopper means by ticking "Sony" and "Philips" under Brand while also
 * ticking "In stock": either brand, but in stock.
 */
export function applyFilters(products: Product[], filters: BrowseFilters): Product[] {
  return products.filter((product) => {
    if (filters.brands.length) {
      const brand = brandOf(product);
      if (!(brand && filters.brands.includes(brand))) return false;
    }
    if (filters.sellers.length && !(product.vendor && filters.sellers.includes(product.vendor))) return false;
    if (filters.speeds.length && !(product.deliverySpeed && filters.speeds.includes(product.deliverySpeed))) return false;

    for (const [name, wanted] of Object.entries(filters.options)) {
      if (!wanted.length) continue;
      const has = optionPairs(product).some(([optionName, value]) => optionName === name && wanted.includes(value));
      if (!has) return false;
    }

    const price = priceOf(product);
    if (filters.minPrice !== null && price < filters.minPrice) return false;
    if (filters.maxPrice !== null && price > filters.maxPrice) return false;

    if (filters.minRating !== null && ratingOf(product) < filters.minRating) return false;
    if (filters.inStock && !isAvailable(product)) return false;
    if (filters.onOffer && !isOnOffer(product)) return false;
    if (filters.express && !isExpressEligible(product)) return false;

    return true;
  });
}

/**
 * Sorted for display.
 *
 * "Relevance" keeps catalog order — the merchant's own arrangement — rather
 * than inventing a score from data we do not have. Every other order falls back
 * to price so the result is stable rather than dependent on array order.
 *
 * **Discount placement applies to relevance and to nothing else** (3.4.20).
 * A seller who is actually discounting comes first among equals on the default
 * view; the moment a shopper picks an order of their own, their choice wins
 * outright. A "price low to high" that quietly puts discounters first is not
 * price low to high, and a shop where promotion beats what somebody asked for
 * is an advert.
 */
export function sortProducts(products: Product[], sort: BrowseSort): Product[] {
  const sorted = products.slice();
  switch (sort) {
    case "price-low":
      return sorted.sort((a, b) => priceOf(a) - priceOf(b));
    case "price-high":
      return sorted.sort((a, b) => priceOf(b) - priceOf(a));
    case "discount":
      return sorted.sort((a, b) => discountOf(b) - discountOf(a) || priceOf(a) - priceOf(b));
    case "rating":
      return sorted.sort((a, b) => ratingOf(b) - ratingOf(a) || priceOf(a) - priceOf(b));
    case "newest":
      // Newest first, as the catalog is returned oldest-first by the adapter.
      return sorted.reverse();
    default:
      return withPlacement(sorted);
  }
}

/** Category, then filters, then order — the whole pipeline in one call. */
export function browse(products: Product[], filters: BrowseFilters): Product[] {
  return sortProducts(applyFilters(productsInCategory(products, filters.category), filters), filters.sort);
}

/** How many filters are on, for the "clear all" affordance and the badge. */
export function activeFilterCount(filters: BrowseFilters): number {
  return (
    filters.brands.length +
    filters.sellers.length +
    filters.speeds.length +
    Object.values(filters.options).reduce((total, values) => total + values.length, 0) +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    (filters.minRating !== null ? 1 : 0) +
    Number(filters.inStock) +
    Number(filters.onOffer) +
    Number(filters.express)
  );
}

/* ------------------------------------------------------------------ url --- */

/*
 * Filters live in the query string, not in component state alone.
 *
 * A narrowed list is a thing shoppers send each other and come back to. Holding
 * it only in memory means the link is wrong, the back button leaves the page
 * instead of the filter, and a reload silently shows something else.
 *
 * Option selections are namespaced `opt.<name>` so a merchant option called
 * "sort" or "brand" cannot collide with the reserved keys.
 */
const OPTION_PREFIX = "opt.";

function positiveNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function filtersFromSearch(search: string, category = "all"): BrowseFilters {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const list = (key: string) => params.getAll(key).flatMap((value) => value.split(",")).filter(Boolean);

  const options: Record<string, string[]> = {};
  for (const [key, value] of Array.from(params.entries())) {
    if (!key.startsWith(OPTION_PREFIX)) continue;
    const name = key.slice(OPTION_PREFIX.length);
    if (!name) continue;
    options[name] = [...(options[name] ?? []), ...value.split(",").filter(Boolean)];
  }

  const sort = params.get("sort");
  const rating = positiveNumber(params.get("rating"));

  return {
    category,
    brands: list("brand"),
    sellers: list("seller"),
    speeds: list("speed").filter((value): value is DeliverySpeed => (DELIVERY_SPEEDS as readonly string[]).includes(value)),
    options,
    minPrice: positiveNumber(params.get("min")),
    maxPrice: positiveNumber(params.get("max")),
    minRating: rating,
    inStock: params.get("stock") === "1",
    onOffer: params.get("offer") === "1",
    express: params.get("express") === "1",
    sort: BROWSE_SORTS.includes(sort as BrowseSort) ? (sort as BrowseSort) : "relevance",
  };
}

/**
 * The query string for these filters, with defaults left out.
 *
 * An untouched page should have a clean URL: carrying `?sort=relevance&stock=0`
 * around makes every link look filtered when nothing is.
 */
export function searchFromFilters(filters: BrowseFilters): string {
  const params = new URLSearchParams();
  if (filters.brands.length) params.set("brand", filters.brands.join(","));
  if (filters.sellers.length) params.set("seller", filters.sellers.join(","));
  if (filters.speeds.length) params.set("speed", filters.speeds.join(","));
  for (const [name, values] of Object.entries(filters.options)) {
    if (values.length) params.set(`${OPTION_PREFIX}${name}`, values.join(","));
  }
  if (filters.minPrice !== null) params.set("min", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("max", String(filters.maxPrice));
  if (filters.minRating !== null) params.set("rating", String(filters.minRating));
  if (filters.inStock) params.set("stock", "1");
  if (filters.onOffer) params.set("offer", "1");
  if (filters.express) params.set("express", "1");
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}
