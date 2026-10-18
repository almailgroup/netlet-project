/**
 * Two of the home page's shelves, which need more than the catalogue's newest
 * two dozen to be true.
 *
 * **Bestsellers is what actually sold.** Units on order lines over the last
 * `BESTSELLER_WINDOW_DAYS`, ranked — never views or hearts, which say what was
 * looked at. A line cancelled or returned did not sell; a cancelled order did
 * not either; and a line priced at zero is an exchange's replacement, the same
 * item counted a second time. The products are drawn through
 * `publishedCatalog`, so a draft or a suspended store's bestseller is absent
 * the way it is from every other shelf.
 *
 * **Shop by brand is the Brand rows sellers wrote**, counted over the live
 * catalogue — the same `brandOf` the Brand filter groups on, so a brand tile
 * lands on a page that has exactly that many products.
 */
import { and, asc, desc, gt, gte, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { orderItems, orders } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { listProducts, listProductsByIds } from "./catalog.js";
import type { LocalePick } from "../Shared/commerce/fromInventory.js";
import { brandOf } from "../Shared/commerce/search.js";
import type { Product } from "../Shared/commerce/types.js";

export const BESTSELLER_WINDOW_DAYS = 90;
const BESTSELLER_LIMIT = 12;

export async function listBestsellers(locale: LocalePick = "en", now = new Date()): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(now.getTime() - BESTSELLER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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
    .limit(BESTSELLER_LIMIT * 2);
  const products = await listProductsByIds(rows.map(row => row.productId!), locale);
  return products.slice(0, BESTSELLER_LIMIT);
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
