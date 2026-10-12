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

export function useCatalog(first: number, options: { enabled?: boolean; staleTime?: number } = {}) {
  const { locale } = useTranslation();
  const query = trpc.commerce.products.list.useQuery({ first, locale }, options);
  return query;
}

export function useProductByHandle(handle: string) {
  const { locale } = useTranslation();
  const query = trpc.commerce.products.byHandle.useQuery({ handle, locale }, { enabled: Boolean(handle) });
  return query;
}
