/**
 * The HTML a crawler or a chat app receives for a page, with that page's head.
 *
 * Product, department, store and guide pages, and the indexes of them (stores,
 * categories, guides): they are what gets shared and indexed, and each answer costs a
 * catalogue read at most. Everything else keeps the shell's default tags,
 * which describe the shop. A read that fails — no database, a
 * product taken down — sends the shell unchanged rather than an error, since
 * the page itself still loads and says what happened.
 */
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { breadcrumbJsonLd, categoriesMeta, departmentMeta, guideMeta, guidesMeta, productJsonLd, productMeta, storeMeta, storesMeta } from "../../../Shared/seo.js";
import { headTags, withHead } from "../../../Shared/seoHead.js";
import { describeError } from "../core/describeError.js";
import { getProductByHandle, getStorePage } from "./catalog.js";
import { guideBySlug } from "./guides.js";

const PRODUCT = /^\/products\/([^/?#]+)\/?$/;
const DEPARTMENT = /^\/category\/([^/?#]+)\/?$/;
const STORE = /^\/stores\/([^/?#]+)\/?$/;
const STORES = /^\/stores\/?$/;
const CATEGORIES = /^\/categories\/?$/;
const GUIDE = /^\/guides\/([^/?#]+)\/?$/;
const GUIDES = /^\/guides\/?$/;

/**
 * The page a request is for. On Vercel a page is rewritten onto the function
 * as `/api?__page=/products/…`, because the function is mounted at `/api` and
 * what it is handed as the path is not something to rely on; anywhere else it
 * is the request's own path.
 */
export function pagePathOf(req: { originalUrl: string; query: Record<string, unknown> }): string {
  const named = req.query.__page;
  if (typeof named === "string" && named.startsWith("/")) return named;
  return new URL(req.originalUrl, "http://netlet.invalid").pathname;
}

/** Whether this address is one the server writes a head for. */
export function hasPageHead(path: string): boolean {
  return PRODUCT.test(path) || DEPARTMENT.test(path) || STORE.test(path) || STORES.test(path) || CATEGORIES.test(path) || GUIDE.test(path) || GUIDES.test(path);
}

export async function pageWithHead(template: string, path: string, origin: string): Promise<string> {
  try {
    const product = PRODUCT.exec(path);
    if (product) {
      const found = await getProductByHandle(decodeURIComponent(product[1]), "en");
      if (!found) return template;
      const variant = found.variants.find(entry => entry.availableForSale) ?? found.variants[0];
      const price = variant?.price ?? found.priceRange.min;
      return withHead(template, headTags(productMeta(found, origin), {
        price,
        structuredData: [productJsonLd(found, origin), breadcrumbJsonLd(found, origin)],
      }));
    }
    const department = DEPARTMENT.exec(path);
    if (department) {
      const known = DEPARTMENTS.find(entry => entry.slug === decodeURIComponent(department[1]));
      if (!known) return template;
      return withHead(template, headTags(departmentMeta(known.name, known.slug, origin)));
    }
    const store = STORE.exec(path);
    if (store) {
      const page = await getStorePage(decodeURIComponent(store[1]), "en");
      if (!page) return template;
      return withHead(template, headTags(storeMeta(page.store, origin)));
    }
    if (STORES.test(path)) return withHead(template, headTags(storesMeta(origin)));
    if (CATEGORIES.test(path)) return withHead(template, headTags(categoriesMeta(origin)));
    const guide = GUIDE.exec(path);
    if (guide) {
      const found = await guideBySlug(decodeURIComponent(guide[1]));
      if (!found) return template;
      return withHead(template, headTags(guideMeta(found, origin)));
    }
    if (GUIDES.test(path)) return withHead(template, headTags(guidesMeta(origin)));
  } catch (error) {
    console.error(`[page head] ${path}: ${describeError(error)}`);
  }
  return template;
}
