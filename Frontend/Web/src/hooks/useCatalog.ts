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
import { MAX_PRODUCTS_BY_ID, type Product } from "@shared/commerce/types";
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
const SHELVES = new Set(["commerce.products.list", "commerce.products.byIds", "commerce.bestsellers", "search.products"]);

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

/**
 * Products named by id, in the order named — a wishlist, a gift list, Saved.
 *
 * They looked their ids up in the newest hundred products (Saved in the newest
 * sixty), so a list holding anything older showed a bare number for its name
 * and a giver could not buy it. This asks for exactly those ids. While it does,
 * whatever the shelves in this tab already hold is drawn as a placeholder, so
 * a list somebody reached from the shop draws at once; `isPlaceholderData`
 * says when the answer is not the server's yet, which is when "no longer
 * available" must not be counted.
 */
export function useProductsByIds(ids: string[], options: { enabled?: boolean } = {}) {
  const { locale } = useTranslation();
  const client = useQueryClient();
  const wanted = [...new Set(ids)].slice(0, MAX_PRODUCTS_BY_ID);
  const query = trpc.commerce.products.byIds.useQuery({ ids: wanted, locale }, {
    staleTime: FRESH_MS,
    enabled: (options.enabled ?? true) && wanted.length > 0,
    placeholderData: previous => {
      const held = new Map(shelvedProducts(client, locale).map(product => [product.id, product]));
      for (const product of previous ?? []) held.set(product.id, product);
      return wanted.flatMap(id => held.get(id) ?? []);
    },
  });
  const products = wanted.length === 0 ? [] : query.data ?? [];
  return {
    query,
    products,
    byId: new Map(products.map(product => [product.id, product])),
    /** Every id has the server's answer, so one with no product really is gone. */
    settled: wanted.length === 0 || (query.isSuccess && !query.isPlaceholderData),
    /** How many of the ids the shop no longer shows — counted only once settled. */
    missing: query.isSuccess && !query.isPlaceholderData ? wanted.length - products.length : 0,
    /** Nothing the shelves held could stand in for every id, so the page has to wait. */
    waiting: wanted.length > 0 && !query.isError && (query.isPending || (query.isPlaceholderData && products.length < wanted.length)),
  };
}
