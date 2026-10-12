/**
 * The HTML a crawler or a chat app receives for a page, with that page's head.
 *
 * Product and department pages only: they are what gets shared and indexed,
 * and each answer costs a catalogue read. Everything else keeps the shell's
 * default tags, which describe the shop. A read that fails — no database, a
 * product taken down — sends the shell unchanged rather than an error, since
 * the page itself still loads and says what happened.
 */
import { DEPARTMENTS } from "../shared/commerce/departments.js";
import { breadcrumbJsonLd, departmentMeta, productJsonLd, productMeta } from "../shared/seo.js";
import { headTags, withHead } from "../shared/seoHead.js";
import { describeError } from "./_core/describeError.js";
import { getProductByHandle } from "./catalog.js";

const PRODUCT = /^\/products\/([^/?#]+)\/?$/;
const DEPARTMENT = /^\/category\/([^/?#]+)\/?$/;

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
  return PRODUCT.test(path) || DEPARTMENT.test(path);
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
  } catch (error) {
    console.error(`[page head] ${path}: ${describeError(error)}`);
  }
  return template;
}
