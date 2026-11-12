/**
 * The stores that sell in a department, or in one of its subcategories — the
 * Categories page's stores under a department's subcategories, and the row of
 * stores over a subcategory's products, on the owner's word ("remove the shop
 * by stores, instead add the stores to the sub category").
 *
 * A search's stores come with the search (`searchCatalogue`'s `stores`); this
 * is the same answer for a shelf with no words. The shelf is
 * `publishedCatalog`'s rule — a published product of an approved store — in
 * the department by its own category or a tag, `productsInCategory`'s rule;
 * a subcategory is `subcategoryFor`, the call the Categories page's counts and
 * the department page's `?sub=` both make, so a store named here sells what
 * that page shows. The order is `rankStores`: the store selling the most first.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import { categories, products, vendors } from "../../database/schema.js";
import type { LocalePick } from "../../../Shared/commerce/fromInventory.js";
import { rankStores } from "../../../Shared/commerce/storesSelling.js";
import { subcategoryFor } from "../../../Shared/commerce/subcategories.js";
import { sellingStoreCards, type SellingStore } from "./catalog.js";
import { getDb } from "./db.js";

/** How many products the read looks through at most — a ceiling far above this shop's shelf. */
const SHELF_CEILING = 20_000;

export async function storesSelling(request: { department: string; sub?: string | null; locale?: LocalePick }): Promise<SellingStore[]> {
  const db = await getDb();
  const department = request.department.trim();
  if (!db || !department) return [];
  const sub = request.sub?.trim() || null;
  const rows = await db
    .select({
      vendorId: products.vendorId,
      title: products.title,
      titleAr: products.titleAr,
      tags: products.tags,
      attributes: products.attributes,
      category: categories.name,
    })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(
      eq(products.status, "published"),
      eq(vendors.status, "approved"),
      or(eq(categories.name, department), sql`${department} = any(${products.tags})`),
    ))
    /* Ends on the id, so a tie between two stores goes the same way on every read. */
    .orderBy(asc(products.vendorId), asc(products.id))
    .limit(SHELF_CEILING);
  const inPage = sub
    ? rows.filter(row => subcategoryFor({
        department: row.category,
        titles: [row.title, row.titleAr],
        tags: row.tags ?? [],
        type: (row.attributes ?? []).find(attribute => attribute.namespace === "spec" && attribute.key === "type")?.value ?? null,
      }) === sub)
    : rows;
  return sellingStoreCards(rankStores(inPage), request.locale ?? "en");
}
