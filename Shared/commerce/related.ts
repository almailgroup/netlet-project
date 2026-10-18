import type { Product } from "./types.js";

function normalized(values: Array<string | null | undefined>) {
  return new Set(values.filter((value): value is string => Boolean(value)).map(value => value.trim().toLowerCase()).filter(Boolean));
}

/**
 * Keep recommendations transparent and catalog-led: products sharing a type,
 * tag, or vendor score first, with title order retaining a stable fallback.
 */
export function relatedProducts(product: Product, catalog: Product[], limit = 4): Product[] {
  const type = product.productType?.trim().toLowerCase() ?? "";
  const vendor = product.vendor?.trim().toLowerCase() ?? "";
  const tags = normalized(product.tags);

  return catalog
    .filter(candidate => candidate.id !== product.id && candidate.handle !== product.handle)
    .map(candidate => {
      const candidateTags = normalized(candidate.tags);
      const sharedTags = Array.from(tags).filter(tag => candidateTags.has(tag)).length;
      const sharedType = type && candidate.productType?.trim().toLowerCase() === type ? 3 : 0;
      const sharedVendor = vendor && candidate.vendor?.trim().toLowerCase() === vendor ? 1 : 0;
      /* Related means the same department or something in common the seller
         tagged; the same seller only breaks a tie. Counted on its own, the
         seller put a store's food processor on its phone's page, and anything
         scoring nothing was still drawn to fill four places. */
      const relevant = sharedType > 0 || sharedTags > 0;
      return { candidate, score: relevant ? sharedType + sharedTags * 2 + sharedVendor : 0 };
    })
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
