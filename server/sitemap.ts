/**
 * What goes in the sitemap, read from the live catalog.
 *
 * A sitemap listing pages that are not there is worse than no sitemap, so this
 * asks the same function the storefront asks — `publishedCatalog` — rather than
 * listing every product row. A draft, or a published product of a suspended
 * vendor, is not on the shelf and does not belong in the index either.
 *
 * Departments come from `shared/commerce/departments.ts` for the same reason
 * the client reads them from there: two lists that must agree, written once.
 */
import { DEPARTMENTS } from "../shared/commerce/departments.js";
import type { SitemapEntry } from "../shared/sitemap.js";
import { publishedCatalog } from "./inventory.js";
import { listStoreCards, STORE_INDEX_LIMIT } from "./catalog.js";

/**
 * The cap is a ceiling on work per request, not a page size.
 *
 * The sitemap protocol allows 50,000 URLs in one file, which the catalog is
 * nowhere near; this is what stops a crawler's fetch from turning into an
 * unbounded query if it ever gets there. Past it, the answer is a sitemap
 * index rather than a bigger file.
 */
const MAX_PRODUCTS = 5000;

export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [
    { path: "/", priority: 1.0 },
    ...DEPARTMENTS.map(department => ({ path: `/category/${department.slug}`, priority: 0.8 })),
  ];

  // A catalog this cannot reach (no database configured, or it is down) yields
  // the home page and the departments rather than an error: those paths are
  // true regardless, and a 500 here teaches a crawler the URL is broken.
  const products = await publishedCatalog({ limit: MAX_PRODUCTS }).catch(() => []);
  for (const product of products) {
    entries.push({ path: `/products/${product.handle}`, lastModified: product.updatedAt, priority: 0.6 });
  }

  /* A store's page is listed while it has something on sale — the rule the
     Stores row and `/stores` keep — so the index never leads to an empty shelf. */
  const stores = await listStoreCards("en", STORE_INDEX_LIMIT).catch(() => []);
  if (stores.length) entries.push({ path: "/stores", priority: 0.5 });
  for (const store of stores) entries.push({ path: `/stores/${store.slug}`, priority: 0.5 });

  return entries;
}
