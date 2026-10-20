/**
 * A page's first data, asked for the moment the shop starts — beside its code,
 * not after it.
 *
 * A product page asked for its product only once the product page's own code
 * had arrived and drawn, so a cold visit waited for two downloads in a row:
 * on a phone the request went out more than a second after the press. The
 * address already says what the page will ask for, so this asks for it while
 * the code is still coming; the page's own query then finds the answer in
 * flight or already there (React Query keeps one request per key), and draws
 * with it. The inputs are the pages' own, built by the same functions, so a
 * prefetch can never ask a question the page does not.
 *
 * The public reads a page opens on, and the session check every page makes
 * anyway — the account page decides between the sign-in form and the account
 * on it, and while the app held its first draw for the page's code it was
 * that check, not the code, that the account page ended up waiting for.
 * Nothing about the shopper beyond what that check already asks.
 */
import type { QueryClient } from "@tanstack/react-query";
import { createTRPCQueryUtils } from "@trpc/react-query";
import type { CreateTRPCClient } from "@trpc/client";
import type { AppRouter } from "../../../../Backend/src/routes";
import { searchTermFrom } from "@shared/commerce/browse";
import { BASE_PATH } from "@/lib/basePath";
import { catalogInput, productInput } from "@/hooks/useCatalog";
import type { LocaleCode } from "@shared/i18n/dictionary";

/** What the header asks for on every shopping page: the shelf it suggests from. */
export const HEADER_SHELF = 24;
/** What a department and a search page read their facets from. */
export const DEPARTMENT_SHELF = 100;
/** How many a search page ranks. */
export const SEARCH_LIMIT = 200;

export function prefetchRouteData(
  client: CreateTRPCClient<AppRouter>,
  queryClient: QueryClient,
  locale: LocaleCode,
  location: { pathname: string; search: string } = window.location,
): void {
  const utils = createTRPCQueryUtils({ client, queryClient });
  const path = location.pathname.startsWith(BASE_PATH) ? location.pathname.slice(BASE_PATH.length) || "/" : location.pathname;
  const ask = (work: Promise<unknown>) => void work.catch(() => undefined);
  ask(utils.auth.me.prefetch());

  /* The shop's frame, on every shopping page. */
  if (!path.startsWith("/admin") && !path.startsWith("/checkout")) {
    ask(utils.commerce.products.list.prefetch(catalogInput(HEADER_SHELF, locale)));
    ask(utils.commerce.departmentCounts.prefetch());
    ask(utils.features.states.prefetch());
    /* Whether the assistants can answer: the corner button on every page and
       the product page's panel under its photo, which otherwise appeared a
       round trip after the page and moved what was under it. */
    ask(utils.ai.available.prefetch());
  }

  const product = /^\/products\/([^/?#]+)\/?$/.exec(path);
  if (product) {
    ask(utils.commerce.products.byHandle.prefetch(productInput(decodeURIComponent(product[1]), locale)));
    return;
  }
  if (/^\/category\/[^/?#]+\/?$/.test(path) || /^\/search\/?$/.test(path)) {
    ask(utils.commerce.products.list.prefetch(catalogInput(DEPARTMENT_SHELF, locale)));
    const term = searchTermFrom(location.search).trim();
    /* A department's own search depends on which department the slug names,
       which needs the catalogue; the results page searches them all. */
    if (term && path.startsWith("/search")) ask(utils.search.products.prefetch({ q: term, department: null, locale, limit: SEARCH_LIMIT }));
    return;
  }
  const store = /^\/stores\/([^/?#]+)\/?$/.exec(path);
  if (store) ask(utils.commerce.store.prefetch({ slug: decodeURIComponent(store[1]), locale }));
  /* The guides list is the help page's too. */
  if (/^\/(guides|help)\/?$/.test(path)) ask(utils.guides.published.prefetch());
  const guide = /^\/guides\/([^/?#]+)\/?$/.exec(path);
  if (guide) ask(utils.guides.bySlug.prefetch({ slug: decodeURIComponent(guide[1]) }));
}
