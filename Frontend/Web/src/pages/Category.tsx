/**
 * Category listing: the page a department link actually leads to.
 *
 * Before this, clicking a category scrolled the home page to a rail showing
 * four of its products. That is a teaser, not a department — there was no way
 * to see everything in one, no way to narrow it, and no link to send anyone.
 *
 * Filters live in the query string rather than in state alone, so a narrowed
 * list is a thing you can bookmark, share and go back to. The sidebar's facets
 * are derived from the products on the page, so they describe this catalog
 * rather than an assumed one.
 *
 * It is also the search results page. `/search?q=lamp` is the whole catalog
 * narrowed by a term, and a department page takes the same `q`, so pressing
 * Enter in the header lands on the layout every department already has —
 * filters, sort, the empty state — rather than on a model's answer.
 */
import { toastHeart } from "@/lib/heartToast";
import { useCatalog } from "@/hooks/useCatalog";
import { DEPARTMENT_SHELF, SEARCH_LIMIT } from "@/lib/routeData";
import { useFloatingBar } from "@/hooks/useFloatingBar";
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { FilterSidebar } from "@/components/browse/FilterSidebar";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { BUTTON_PRIMARY, Breadcrumbs, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import {
  activeFilterCount,
  browse,
  categoryFromSlug,
  categorySlug,
  knownCategories,
  applyFilters,
  sortProducts,
  searchPath,
  searchTermFrom,
  searchWithTerm,
  EMPTY_FILTERS,
  facetsFor,
  filtersFromSearch,
  productsInCategory,
  BROWSE_SORTS,
  type BrowseFilters,
  type BrowseSort,
} from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { categoryMessageKey } from "@/content/homeLayout";
import { departmentMeta, privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowUpDown, PackageOpen, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";
import { CountBadge } from "@/components/ui/CountBadge";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const SORT_LABELS: Record<BrowseSort, MessageKey> = {
  relevance: "browse.sort.relevance",
  "price-low": "browse.sort.priceLow",
  "price-high": "browse.sort.priceHigh",
  discount: "browse.sort.discount",
  rating: "browse.sort.rating",
  newest: "browse.sort.newest",
};

export default function Category() {
  const [, params] = useRoute("/category/:slug");
  const [onSearchPage] = useRoute("/search");
  const [location, navigate] = useLocation();
  const { t, locale } = useTranslation();
  const { heartedIds, toggleSaved } = useCustomer();
  const shelf = useCatalog(DEPARTMENT_SHELF);
  const catalog = shelf.data ?? [];

  const [sheetOpen, setSheetOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  useOverlay(sheetOpen, () => setSheetOpen(false));

  const slug = onSearchPage ? "all" : params?.slug ?? "all";
  const basePath = onSearchPage ? "/search" : `/category/${slug}`;

  // wouter's `location` is the path only, so the query string is read from the
  // browser. Keyed off `location` as well so a navigation that only changes the
  // query still re-reads it.
  const [queryString, setQueryString] = useState(() => window.location.search);
  useEffect(() => { setQueryString(window.location.search); }, [location]);
  /* What the URL searched for; the header field starts from it and Enter writes it back. */
  const term = searchTermFrom(queryString);

  const categories = useMemo(
    () => knownCategories(DEPARTMENTS.map(department => department.name), catalog),
    [catalog],
  );
  const category = categoryFromSlug(slug, categories);
  /* The department row marks where the shopper is; a search spans them all, so it marks none. */
  usePageChrome({ activeDepartment: onSearchPage ? null : category === "all" ? ALL_DEPARTMENTS.query : category });

  const filters: BrowseFilters = useMemo(
    () => filtersFromSearch(queryString, category),
    [queryString, category],
  );

  /*
   * A search is answered by the server, over the whole catalogue
   * (`Backend/src/services/productSearch.ts`). It used to run here, over the hundred newest
   * products this page had fetched, so the hundred-and-first could not be
   * found by any search. The page searches what the address says — the term
   * Enter wrote — not every keystroke in the header field, so a results page
   * is the same page for anybody holding the link.
   */
  const typed = term.trim();
  const searching = typed.length > 0;
  const answer = trpc.search.products.useQuery(
    { q: typed, department: category === "all" ? null : category, locale, limit: SEARCH_LIMIT },
    { enabled: searching, placeholderData: previous => previous, staleTime: 30_000 },
  );
  const matched = useMemo(() => (searching ? answer.data?.products ?? [] : []), [searching, answer.data]);
  const isLoading = searching ? answer.isLoading : shelf.isLoading;
  const error = searching ? answer.error : shelf.error;
  const refetch = searching ? answer.refetch : shelf.refetch;

  // Facets describe what is in the department, before the sidebar narrows it —
  // otherwise ticking "Sony" would remove every other brand from the list you
  // used to tick it. On a search, what is in it is what the search found.
  const inCategory = useMemo(() => productsInCategory(catalog, category), [catalog, category]);
  const facets = useMemo(() => facetsFor(searching ? matched : inCategory), [searching, matched, inCategory]);

  /*
   * The server has already ranked the matches, corrected a misspelling when the
   * words as typed found nothing (said above the grid rather than silently
   * swapped), and counted what the whole shop has when a department had
   * nothing — "no phone" on the Beauty page is not "NetLet sells no phones".
   * The sidebar narrows what it found; a chosen order wins over the ranking.
   */
  const results = useMemo(() => {
    if (!searching) return browse(catalog, filters);
    const narrowed = applyFilters(matched, filters);
    return filters.sort === "relevance" ? narrowed : sortProducts(narrowed, filters.sort);
  }, [searching, catalog, matched, filters]);
  const correctedTo = searching ? answer.data?.correctedTo ?? null : null;
  const elsewhere = searching && category !== "all" && !results.length ? answer.data?.elsewhere ?? 0 : 0;
  /* More matched than one page holds: the best of them are here, and the page says how many there were. */
  const moreThanShown = searching && answer.data && answer.data.total > matched.length ? answer.data.total : 0;

  // Translated where NetLet knows the department, shown as the merchant typed
  // it otherwise — a product type is their words, not ours.
  const translatedName = category === "all" ? null : categoryMessageKey(category);
  const departmentName = category === "all"
    ? t("browse.allProducts")
    : translatedName ? t(translatedName) : category;
  /* A search reads as what was searched for, in the department it was searched in. */
  const searched = typed;
  /* The footer's "New arrivals" and "On offer" land here with a sort or a
     filter, and the heading read "All products" for both — the list was
     right and the page said it was something else. Named when the view is
     exactly that and nothing more. */
  const viewName = category === "all" && !searched
    ? filters.onOffer && activeFilterCount(filters) === 1 ? t("footer.onOffer")
      : filters.sort === "newest" && activeFilterCount(filters) === 0 ? t("footer.newArrivals")
      : null
    : null;
  const title = searched
    ? category === "all" ? t("browse.searchTitle", { query: searched }) : t("browse.searchInTitle", { query: searched, name: departmentName })
    : viewName ?? departmentName;

  /* A department page is a page to be found; a search or a filtered view is not. */
  const knownDepartment = DEPARTMENTS.find(entry => entry.slug === slug);
  usePageMeta(
    !onSearchPage && !searched && !activeFilterCount(filters) && knownDepartment
      ? departmentMeta(knownDepartment.name, knownDepartment.slug, SITE_URL)
      : privatePageMeta(title),
  );

  const activeCount = activeFilterCount(filters);
  const currency = catalog[0]?.priceRange.min.currencyCode ?? "KWD";

  /** Writes the filters into the URL, which is the only place they live. */
  const setFilters = (patch: Partial<BrowseFilters>) => {
    const next = { ...filters, ...patch };
    const query = searchWithTerm(next, term);
    navigate(`${basePath}${query}`, { replace: true });
    setQueryString(query);
  };

  const selectCategory = (nextCategory: string) => {
    // Switching department drops the old one's filters: a brand that existed in
    // Electronics rarely exists in Grocery, and carrying it over lands the
    // shopper on an empty page they did not ask for.
    setSheetOpen(false);
    const target = nextCategory === "all" ? "all" : categorySlug(nextCategory);
    /* The search term survives a change of department; the facets do not. */
    const query = searchWithTerm({ ...EMPTY_FILTERS, sort: filters.sort }, term);
    navigate(`/category/${target}${query}`);
    setQueryString(query);
  };

  /* Clears the facets and keeps what was searched for: "Clear all" sits beside the filters, not the search box. */
  const clearAll = () => {
    const query = searchWithTerm(EMPTY_FILTERS, term);
    navigate(`${basePath}${query}`, { replace: true });
    setQueryString(query);
  };




  /** The removable chips above the grid, one per selected value. */
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...filters.brands.map(brand => ({
      key: `brand-${brand}`,
      label: brand,
      clear: () => setFilters({ brands: filters.brands.filter(entry => entry !== brand) }),
    })),
    ...filters.sellers.map(seller => ({
      key: `seller-${seller}`,
      label: t("browse.soldBy", { name: seller }),
      clear: () => setFilters({ sellers: filters.sellers.filter(entry => entry !== seller) }),
    })),
    ...filters.speeds.map(speed => ({
      key: `speed-${speed}`,
      label: t(`speed.${speed}` as MessageKey),
      clear: () => setFilters({ speeds: filters.speeds.filter(entry => entry !== speed) }),
    })),
    ...Object.entries(filters.options).flatMap(([name, values]) => values.map(value => ({
      key: `opt-${name}-${value}`,
      label: `${name}: ${value}`,
      clear: () => setFilters({ options: { ...filters.options, [name]: values.filter(entry => entry !== value) } }),
    }))),
    ...(filters.minPrice !== null || filters.maxPrice !== null ? [{
      key: "price",
      label: filters.minPrice !== null && filters.maxPrice !== null
        ? `${filters.minPrice} – ${filters.maxPrice}`
        : filters.minPrice !== null
          ? t("browse.priceFrom", { min: filters.minPrice })
          : t("browse.priceUpTo", { max: filters.maxPrice ?? 0 }),
      clear: () => setFilters({ minPrice: null, maxPrice: null }),
    }] : []),
    ...(filters.minRating !== null ? [{
      key: "rating",
      label: t("browse.ratingAndUp", { stars: filters.minRating }),
      clear: () => setFilters({ minRating: null }),
    }] : []),
    ...(filters.inStock ? [{ key: "stock", label: t("browse.inStock"), clear: () => setFilters({ inStock: false }) }] : []),
    ...(filters.onOffer ? [{ key: "offer", label: t("browse.onOffer"), clear: () => setFilters({ onOffer: false }) }] : []),
    ...(filters.express ? [{ key: "express", label: t("browse.expressOnly"), clear: () => setFilters({ express: false }) }] : []),
  ];

  /*
   * On a phone, Filters and Sort are one row under the title, a thumb's
   * width each. The filters used to be only a navy pill floating over the
   * grid, which covered the first row's Buy now the moment the page opened;
   * the row is where somebody arriving looks for them. Once it has scrolled
   * up under the header, a round button in the corner above the tab bar
   * stands in for it — at the edge, where it covers the end of one card's
   * button rather than the middle of two. One structure at a time: the wide
   * screen's sort sits beside the title instead, never both with one hidden.
   */
  const wide = useMediaQuery("(min-width: 1024px)");
  const [filtersRef, filtersPassed] = useBeyondScreen("top", 64);
  /* The corner is the filters' while they float there; the assistant's button steps aside. */
  useFloatingBar(!wide && filtersPassed);
  const filtersLabel = activeCount ? t("browse.filtersWithCount", { count: activeCount }) : t("browse.filters");
  const sortSelect = (className: string) => (
    <Select
      aria-label={t("browse.sortBy")}
      value={filters.sort}
      onChange={event => setFilters({ sort: event.target.value as BrowseSort })}
      className={className}
    >
      {BROWSE_SORTS.map(sort => <option key={sort} value={sort}>{t(SORT_LABELS[sort])}</option>)}
    </Select>
  );

  const sidebar = (
    <FilterSidebar
      facets={facets}
      filters={filters}
      currency={currency}
      onChange={setFilters}
      onSelectCategory={selectCategory}
    />
  );

  return (
    <>
      <PageBody>
        <Breadcrumbs trail={[{ label: onSearchPage ? t("browse.searchCrumb") : departmentName }]} />
        {/* The count under the name rather than as the heading: "No results for Beauty"
            read as a search that failed, for a department that simply has nothing yet. */}
        <PageHeading
          title={title}
          note={
            <span aria-live="polite">
              {isLoading || error ? "\u00a0" : results.length === 0
                ? t("browse.countNone")
                : results.length === 1
                  ? t("browse.countOne")
                  : moreThanShown
                    ? t("browse.countBestOf", { count: results.length, total: moreThanShown })
                    : t("browse.countMany", { count: results.length })}
            </span>
          }
          actions={wide ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#d5dfeb] bg-white transition-colors hover:bg-[#f0f2f5] px-3 py-2 text-[13px] font-bold text-[#536b8c] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f2683a]">
              <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
              {t("browse.sortBy")}
              {sortSelect("bg-transparent font-extrabold text-[#0a285a] outline-none")}
            </label>
          ) : undefined}
        />

        {!wide ? (
          <div className="-mt-2 mb-5 grid grid-cols-2 gap-2">
            <button ref={filtersRef} type="button" onClick={() => setSheetOpen(true)} className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-[#d5dfeb] bg-white px-3 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{filtersLabel}</span>
            </button>
            <label className="flex h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-xl border border-[#d5dfeb] bg-white ps-3 text-[#536b8c] hover:bg-[#f0f2f5] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f2683a]">
              <ArrowUpDown className="size-4 shrink-0" aria-hidden />
              {sortSelect("h-full min-w-0 flex-1 bg-transparent pe-3 text-[14px] font-bold text-[#0a285a] outline-none hover:bg-transparent")}
            </label>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-7">
          {/* Sticky so the filters stay reachable through a long grid, and
              independently scrollable so a long facet list cannot trap the page. */}
          <aside className="hidden lg:block">
            <div className="hide-scrollbar sticky top-[92px] max-h-[calc(100vh-112px)] overflow-y-auto rounded-2xl border border-[#e6e9ef] bg-white px-4 py-1">
              {sidebar}
            </div>
          </aside>

          <section aria-label={t("browse.resultsRegion")} className="min-w-0">
            {chips.length ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {chips.map(chip => (
                  <button
                    key={chip.key}
                    onClick={chip.clear}
                    aria-label={t("browse.remove", { name: chip.label })}
                    className="pressable inline-flex items-center gap-1.5 rounded-full border border-[#d5dfeb] bg-white px-3 py-1.5 text-[12px] font-bold text-[#0a285a] hover:border-[#f2683a] hover:bg-[#f0f2f5]"
                  >
                    <span dir="auto">{chip.label}</span>
                    <X className="size-3 ink-muted" aria-hidden />
                  </button>
                ))}
                <button onClick={clearAll} className="text-[12px] font-extrabold ink-accent underline underline-offset-4">
                  {t("browse.clearAll")}
                </button>
              </div>
            ) : null}

            {/* Paid placements for this department (3.3.15): a strip of their
                own above the grid, so the grid stays the order the shopper chose. */}
            {slug !== "all" && !searched ? (
              <SponsoredShelf
                slot="department"
                departmentSlug={slug}
                layout="strip"
                saved={heartedIds}
                onSave={product => toastHeart(toggleSaved(product.id), product.title, t)}
                onQuickView={setQuickProduct}
              />
            ) : null}

            {isLoading ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="h-[380px] animate-pulse rounded-2xl border border-[#d5dfeb] bg-white/60" />
                ))}
              </div>
            ) : error ? (
              <div className="mt-5">
                <EmptyState icon={<PackageOpen className="size-6" />} title={t("home.catalogSlow")} note={t("home.refreshNote")}>
                  <button type="button" onClick={() => void refetch()} className={BUTTON_PRIMARY}>{t("home.refreshCatalog")}</button>
                </EmptyState>
              </div>
            ) : results.length ? (
              <>
                {correctedTo ? (
                  <p className="mt-4 rounded-xl border border-[#e1e7ef] bg-white px-4 py-3 text-[14px] text-[#0a285a]" role="status">
                    {t("browse.showingFor", { term: correctedTo })}{" "}
                    <span className="ink-muted">{t("browse.noneFor", { term: typed })}</span>
                  </p>
                ) : null}
                {/* The cards are h3s, and the page heading is the result count,
                    so without this the outline skips a level. Hidden because
                    the region is already visibly obvious; it is the screen
                    reader's outline that needs the rung. */}
                <h2 className="sr-only">{t("browse.resultsRegion")}</h2>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {results.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    compact
                    saved={heartedIds.includes(product.id)}
                    onSave={() => toastHeart(toggleSaved(product.id), product.title, t)}
                    onQuickView={() => setQuickProduct(product)}
                  />
                ))}
                </div>
              </>
            ) : (
              <div className="mt-5">
                <EmptyState
                  icon={<PackageOpen className="size-6" />}
                  title={elsewhere ? t("browse.emptyHere", { name: departmentName }) : activeCount ? t("browse.empty") : searched ? t("browse.emptySearch") : t("browse.emptyCategory")}
                  note={activeCount ? t("browse.emptyNote") : searched ? t("browse.emptySearchNote") : t("browse.emptyCategoryNote")}
                >
                  {elsewhere ? (
                    <Link href={searchPath(typed)} className={BUTTON_PRIMARY}>
                      {t(elsewhere === 1 ? "browse.searchAllOne" : "browse.searchAllMany", { count: elsewhere })}
                    </Link>
                  ) : activeCount ? (
                    <button type="button" onClick={clearAll} className={BUTTON_PRIMARY}>{t("browse.clearAll")}</button>
                  ) : (
                    /* Everything means everything: the search term goes as well. */
                    <button type="button" onClick={() => { setSheetOpen(false); navigate("/category/all"); setQueryString(""); }} className={BUTTON_PRIMARY}>
                      {t("browse.browseEverything")}
                    </button>
                  )}
                </EmptyState>
              </div>
            )}
          </section>
        </div>
      </PageBody>

      {/* The phone's filters once the row under the title has gone up under
          the header: round, at the end, just above the tab bar (which floats
          at max(0.75rem, safe area) and is 64px tall). */}
      {!wide ? (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label={filtersLabel}
          aria-hidden={!filtersPassed}
          inert={!filtersPassed}
          className={`glass glass-navy rides-tab-bar fixed end-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 grid size-13 place-items-center rounded-full shadow-[0_10px_30px_rgba(10,40,90,.25)] ${filtersPassed ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          <CountBadge value={activeCount} className="absolute -end-1 -top-1" />
        </button>
      ) : null}

      {sheetOpen ? (
        <div className="fixed inset-0 z-[70] bg-[#061b3b]/35 lg:hidden" onClick={() => setSheetOpen(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t("browse.filters")}
            className="absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-[1.5rem] bg-background"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e6e9ef] px-5 py-4">
              <h2 className="text-sm font-extrabold">{t("browse.filters")}</h2>
              <div className="flex items-center gap-3">
                {activeCount ? (
                  <button onClick={clearAll} className="text-[12px] font-extrabold ink-accent underline underline-offset-4">
                    {t("browse.clearAll")}
                  </button>
                ) : null}
                <button onClick={() => setSheetOpen(false)} aria-label={t("browse.closeFilters")} className="glass pressable grid size-8 place-items-center rounded-full">
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="hide-scrollbar flex-1 overflow-y-auto px-5">{sidebar}</div>
            <div className="border-t border-[#e6e9ef] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                onClick={() => setSheetOpen(false)}
                className="glass glass-accent pressable h-12 w-full rounded-full text-xs font-extrabold"
              >
                {t("browse.showResults", { count: results.length })}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    </>
  );
}
