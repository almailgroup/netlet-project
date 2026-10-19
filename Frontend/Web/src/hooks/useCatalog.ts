/**
 * The storefront's catalogue reads, in the page's language.
 *
 * Every page asked `commerce.products.list` and `.byHandle` without a locale,
 * so a product with an Arabic title and description written by its seller was
 * shown in English on the Arabic page — the review's "product names stay in
 * English". The server has always taken the locale; nothing sent it. These two
 * hooks are the one way the shop reads its catalogue, so a page cannot forget.
 *
 * The department (`productType`) comes back as its canonical name either way:
 * it is the key pages filter and link on, and its label is the dictionary's.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Product } from "@shared/commerce/types";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LocaleCode } from "@shared/i18n/dictionary";

/*
 * The inputs these reads send, built in one place so the read a page makes and
 * the one `routeData` starts before the page's code arrives are one question —
 * a prefetch asking `{ locale, first }` where the page asks `{ first, locale }`
 * would still be the same key, but one asking for 24 where the page wants 100
 * would be a wasted request.
 */
export const catalogInput = (first: number, locale: LocaleCode) => ({ first, locale });
export const productInput = (handle: string, locale: LocaleCode) => ({ handle, locale });

/*
 * Half a minute before a read is asked again on its own: an answer that
 * landed while the page's code was still coming is the page's answer, and with
 * no grace the page asked again the moment it drew.
 */
const FRESH_MS = 30_000;

export function useCatalog(first: number, options: { enabled?: boolean; staleTime?: number } = {}) {
  const { locale } = useTranslation();
  const query = trpc.commerce.products.list.useQuery(catalogInput(first, locale), { staleTime: FRESH_MS, ...options });
  return query;
}

/*
 * Reads that answer with whole storefront products — the same `shape` on the
 * server as `byHandle`'s, so a product found in one of them is the product.
 */
const SHELVES = new Set(["commerce.products.list", "commerce.bestsellers", "search.products"]);

/**
 * The product as a shelf already holds it, and when that shelf was read.
 *
 * A card is a whole product: the list the home page, a department or a search
 * drew it from carries everything the product page draws. So opening one
 * starts from that copy and asks the server again behind it, rather than
 * drawing a grey outline for the length of a request whose answer is already
 * in the browser. The read stays the authority — it replaces the copy the
 * moment it lands, and a copy older than the cache allows is asked for again
 * at once.
 */
export function shelvedProduct(client: QueryClient, handle: string, locale: string): { product: Product; at: number } | null {
  for (const query of client.getQueryCache().getAll()) {
    const [path, key] = query.queryKey as [unknown, { input?: { locale?: string } } | undefined];
    if (!Array.isArray(path) || !SHELVES.has(path.join("."))) continue;
    if ((key?.input?.locale ?? "en") !== locale) continue;
    const data = query.state.data as Product[] | { products?: Product[] } | undefined;
    const list = Array.isArray(data) ? data : data?.products;
    const product = list?.find(entry => entry?.handle === handle);
    if (product) return { product, at: query.state.dataUpdatedAt };
  }
  return null;
}

/**
 * Every product the shelves already hold in this language, once each — what
 * the search box suggests from while the server's answer is on its way.
 */
export function shelvedProducts(client: QueryClient, locale: string): Product[] {
  const seen = new Map<string, Product>();
  for (const query of client.getQueryCache().getAll()) {
    const [path, key] = query.queryKey as [unknown, { input?: { locale?: string } } | undefined];
    if (!Array.isArray(path) || !SHELVES.has(path.join("."))) continue;
    if ((key?.input?.locale ?? "en") !== locale) continue;
    const data = query.state.data as Product[] | { products?: Product[] } | undefined;
    for (const product of (Array.isArray(data) ? data : data?.products) ?? []) {
      if (product?.id && !seen.has(product.id)) seen.set(product.id, product);
    }
  }
  return [...seen.values()];
}

export function useProductByHandle(handle: string) {
  const { locale } = useTranslation();
  const client = useQueryClient();
  const query = trpc.commerce.products.byHandle.useQuery(productInput(handle, locale), {
    enabled: Boolean(handle),
    staleTime: FRESH_MS,
    initialData: () => (handle ? shelvedProduct(client, handle, locale)?.product : undefined),
    initialDataUpdatedAt: () => (handle ? shelvedProduct(client, handle, locale)?.at : undefined),
  });
  return query;
}
