/**
 * What a department on the Categories page offers besides its subcategories —
 * how many of its products are on offer, how many carry stars, which brands
 * it sells, and the same for each subcategory — read off the products the
 * department page itself shows (the same shelf, `DEPARTMENT_SHELF`), so a
 * "Deals · 3" on the Categories page is the three that page then draws.
 *
 * Pure, because it decides which ways into a department are offered: a way
 * in that leads to an empty page is the dead-control rule, so "Deals" is
 * offered only with a deal, "Top rated" only when there is an order to put
 * products in, and a brand only when a product carries it. The app's
 * `CategoryGuide` is the same rule on the same cases.
 */
import { isOnOffer, productsInCategory } from "./browse.js";
import { productStars } from "./productDetail.js";
import { brandOf } from "./search.js";
import type { Product } from "./types.js";

/** The most brands a department's panel names; its page's Brand filter has the rest. */
export const TOP_BRANDS = 8;

/** "Top rated" is offered from this many rated products: with fewer, sorting by stars changes nothing. */
export const MIN_RATED = 2;

/** "New arrivals" is offered from this many products, the same reason. */
export const MIN_FOR_NEWEST = 2;

export type BrandFact = { name: string; count: number };

export type DepartmentFacts = {
  /** Its products on the shelf read. */
  products: number;
  /** Of them, on an offer the store may advertise now (`isOnOffer`). */
  deals: number;
  /** Of them, with stars to sort by (`productStars`). */
  rated: number;
  /** Its brands, the most products first, ties by name, at most `TOP_BRANDS`. */
  brands: BrandFact[];
  /** Deals per subcategory, by the subcategory's slug; one with none is absent. */
  subDeals: Record<string, number>;
};

/** A department's facts, by its name as products carry it (`productType`). */
export function departmentFacts(shelf: Product[], department: string): DepartmentFacts {
  const products = productsInCategory(shelf, department);
  const brands = new Map<string, number>();
  const subDeals: Record<string, number> = {};
  let deals = 0;
  let rated = 0;
  for (const product of products) {
    const offer = isOnOffer(product);
    if (offer) {
      deals += 1;
      if (product.subcategory) subDeals[product.subcategory] = (subDeals[product.subcategory] ?? 0) + 1;
    }
    if (productStars(product)) rated += 1;
    const brand = brandOf(product);
    if (brand) brands.set(brand, (brands.get(brand) ?? 0) + 1);
  }
  return {
    products: products.length,
    deals,
    rated,
    brands: Array.from(brands, ([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, TOP_BRANDS),
    subDeals,
  };
}

/** The ways into a department its panel offers, in the order drawn. */
export type DepartmentWay = "deals" | "newest" | "rating";

export function departmentWays(facts: DepartmentFacts): DepartmentWay[] {
  const ways: DepartmentWay[] = [];
  if (facts.deals > 0) ways.push("deals");
  if (facts.products >= MIN_FOR_NEWEST) ways.push("newest");
  if (facts.rated >= MIN_RATED) ways.push("rating");
  return ways;
}
