/**
 * The home page's shelves that need more than the catalogue's newest two
 * dozen to be true.
 *
 * **Bestsellers is what actually sold.** Units on order lines over the last
 * `BESTSELLER_WINDOW_DAYS`, ranked — never views or hearts, which say what was
 * looked at. A line cancelled or returned did not sell; a cancelled order did
 * not either; and a line priced at zero is an exchange's replacement, the same
 * item counted a second time. The products are drawn through
 * `publishedCatalog`, so a draft or a suspended store's bestseller is absent
 * the way it is from every other shelf.
 *
 * **Trending is what shoppers reached for this week**, on the owner's word
 * ("products that are gaining popularity and attracting increased customer
 * interest"): over the last `TRENDING_WINDOW_DAYS`, every unit sold (the
 * bestsellers' own rule), every bag it was put in, every heart and every
 * wishlist it was added to, weighed as `TREND_WEIGHT` says — a sale above a
 * bag above a heart above a wish, the taste profile's order — and ranked.
 * Seven days rather than ninety, because that is what tells it apart from
 * Bestsellers: a product that sold steadily all season is a bestseller, and
 * one everybody picked up this week is trending. A product from before the
 * window with no interest this week scores nothing and is not on it.
 *
 * **Both answer `HOME_SHELF_LIMIT` products, not a shelf's twelve**, because
 * the home page narrows each by department (a row of tabs, the owner's
 * reference) and a shelf of twelve cut five ways is a tab of two.
 *
 * **Shop by brand is the Brand rows sellers wrote**, counted over the live
 * catalogue — the same `brandOf` the Brand filter groups on, so a brand tile
 * lands on a page that has exactly that many products.
 */
import { and, asc, desc, gt, gte, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { cartItems, orderItems, orders, productVariants, savedProducts, wishlistItems } from "../../database/schema.js";
import { getDb } from "./db.js";
import { listProducts, listProductsByIds } from "./catalog.js";
import type { LocalePick } from "../../../Shared/commerce/fromInventory.js";
import { brandOf } from "../../../Shared/commerce/search.js";
import type { Product } from "../../../Shared/commerce/types.js";

export const BESTSELLER_WINDOW_DAYS = 90;
export const TRENDING_WINDOW_DAYS = 7;
/** How many each shelf answers with: enough for a department's tab to be a shelf. */
export const HOME_SHELF_LIMIT = 60;
/** What each kind of interest is worth on the trending shelf, a sale first. */
export const TREND_WEIGHT = { sold: 3, bagged: 2, saved: 2, wished: 1 } as const;

const days = (count: number) => count * 24 * 60 * 60 * 1000;

export async function listBestsellers(locale: LocalePick = "en", now = new Date()): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(now.getTime() - days(BESTSELLER_WINDOW_DAYS));
  const units = sql<number>`sum(${orderItems.quantity})::int`;
  const rows = await db
    .select({ productId: orderItems.productId, units })
    .from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(and(
      gte(orders.placedAt, since),
      ne(orders.status, "cancelled"),
      isNotNull(orderItems.productId),
      notInArray(orderItems.fulfilment, ["cancelled", "returned"]),
      gt(orderItems.lineTotal, "0"),
    ))
    .groupBy(orderItems.productId)
    /* Ends on the id: two products selling the same number tie. */
    .orderBy(desc(units), asc(orderItems.productId))
    /* Room for some to have left the shelf since they sold. */
    .limit(HOME_SHELF_LIMIT * 2);
  const products = await listProductsByIds(rows.map(row => row.productId!), locale);
  return products.slice(0, HOME_SHELF_LIMIT);
}

/**
 * This week's interest per product, as `TREND_WEIGHT` weighs it, highest
 * first. Four grouped reads merged here rather than one union, because the
 * hearts and the wishlists name a product by the storefront's string id and
 * the orders and the bags by the row — one shape in JavaScript is simpler
 * than one in SQL, and a bag or a heart for something that is not a row (a
 * demo handle) is simply not counted.
 */
async function trendingScores(now: Date): Promise<Map<number, number>> {
  const db = await getDb();
  if (!db) return new Map();
  const since = new Date(now.getTime() - days(TRENDING_WINDOW_DAYS));
  const scores = new Map<number, number>();
  const add = (id: number | string | null, weight: number) => {
    if (id === null) return;
    const key = typeof id === "number" ? id : /^\d+$/.test(id) ? Number(id) : NaN;
    if (!Number.isSafeInteger(key)) return;
    scores.set(key, (scores.get(key) ?? 0) + weight);
  };

  const units = sql<number>`sum(${orderItems.quantity})::int`;
  const sold = await db
    .select({ productId: orderItems.productId, units })
    .from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(and(
      gte(orders.placedAt, since),
      ne(orders.status, "cancelled"),
      isNotNull(orderItems.productId),
      notInArray(orderItems.fulfilment, ["cancelled", "returned"]),
      gt(orderItems.lineTotal, "0"),
    ))
    .groupBy(orderItems.productId);
  for (const row of sold) add(row.productId, row.units * TREND_WEIGHT.sold);

  const lines = sql<number>`count(*)::int`;
  const bagged = await db
    .select({ productId: productVariants.productId, lines })
    .from(cartItems)
    .innerJoin(productVariants, sql`${productVariants.id} = ${cartItems.variantId}`)
    .where(gte(cartItems.createdAt, since))
    .groupBy(productVariants.productId);
  for (const row of bagged) add(row.productId, row.lines * TREND_WEIGHT.bagged);

  const saved = await db
    .select({ productId: savedProducts.productId, lines })
    .from(savedProducts)
    .where(gte(savedProducts.createdAt, since))
    .groupBy(savedProducts.productId);
  for (const row of saved) add(row.productId, row.lines * TREND_WEIGHT.saved);

  const wished = await db
    .select({ productId: wishlistItems.productId, lines })
    .from(wishlistItems)
    .where(gte(wishlistItems.createdAt, since))
    .groupBy(wishlistItems.productId);
  for (const row of wished) add(row.productId, row.lines * TREND_WEIGHT.wished);

  return scores;
}

export async function listTrending(locale: LocalePick = "en", now = new Date()): Promise<Product[]> {
  const scores = await trendingScores(now);
  const ranked = [...scores.entries()]
    /* Ends on the id: two products reached for equally often tie. */
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, HOME_SHELF_LIMIT * 2)
    .map(([id]) => id);
  const products = await listProductsByIds(ranked, locale);
  return products.slice(0, HOME_SHELF_LIMIT);
}

export type BrandCount = { name: string; count: number };

export async function listBrands(): Promise<BrandCount[]> {
  const catalogue = await listProducts({ first: 100 });
  const counts = new Map<string, number>();
  for (const product of catalogue) {
    const brand = brandOf(product);
    if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
