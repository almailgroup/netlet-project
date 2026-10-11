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
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { FilterSidebar } from "@/components/browse/FilterSidebar";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useCustomer } from "@/contexts/CustomerContext";
import { logoImage } from "@/lib/brandAssets";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import {
  activeFilterCount,
  browse,
  categoryFromSlug,
  categorySlug,
  knownCategories,
  matchesSearch,
  searchTermFrom,
  searchWithTerm,
  EMPTY_FILTERS,
  facetsFor,
  filtersFromSearch,
  productsInCategory,
  searchFromFilters,
  BROWSE_SORTS,
  type BrowseFilters,
  type BrowseSort,
} from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { categoryMessageKey } from "@/content/homeLayout";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, ChevronRight, PackageOpen, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";

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
  const { t } = useTranslation();
  const { savedIds, toggleSaved } = useCustomer();
  const { data: catalog = [], isLoading, error, refetch } = trpc.commerce.products.list.useQuery({ first: 100 });

  const [search, setSearch] = useState("");
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
  useEffect(() => { setSearch(term); }, [term]);

  const categories = useMemo(
    () => knownCategories(DEPARTMENTS.map(department => department.name), catalog),
    [catalog],
  );
  const category = categoryFromSlug(slug, categories);

  const filters: BrowseFilters = useMemo(
    () => filtersFromSearch(queryString, category),
    [queryString, category],
  );

  // Facets describe what is in the department, before the sidebar narrows it —
  // otherwise ticking "Sony" would remove every other brand from the list you
  // used to tick it.
  const inCategory = useMemo(() => productsInCategory(catalog, category), [catalog, category]);
  const facets = useMemo(() => facetsFor(inCategory), [inCategory]);

  const results = useMemo(() => {
    const matched = browse(catalog, filters);
    const words = search.trim();
    return words ? matched.filter(product => matchesSearch(product, words)) : matched;
  }, [catalog, filters, search]);

  // Translated where NetLet knows the department, shown as the merchant typed
  // it otherwise — a product type is their words, not ours.
  const translatedName = category === "all" ? null : categoryMessageKey(category);
  const departmentName = category === "all"
    ? t("browse.allProducts")
    : translatedName ? t(translatedName) : category;
  /* A search reads as what was searched for, in the department it was searched in. */
  const searched = search.trim();
  const title = searched
    ? category === "all" ? t("browse.searchTitle", { query: searched }) : t("browse.searchInTitle", { query: searched, name: departmentName })
    : departmentName;

  usePageMeta(privatePageMeta(title));

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

  const openProduct = (product: Product) =>
    navigate(`/products/${encodeURIComponent(product.handle)}`);



  /** The removable chips above the grid, one per selected value. */
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...filters.brands.map(brand => ({
      key: `brand-${brand}`,
      label: brand,
      clear: () => setFilters({ brands: filters.brands.filter(entry => entry !== brand) }),
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
    <main className="min-h-screen bg-background text-[#0a285a]">
      {/* The department row marks where the shopper is; a search spans them all, so it marks none. */}
      <StoreHeader
        catalog={catalog}
        search={search}
        onSearch={setSearch}
        onSelectProduct={openProduct}
        activeDepartment={onSearchPage ? null : category === "all" ? ALL_DEPARTMENTS.query : category}
      />

      <div className="container pt-4 sm:pt-6">
        <nav className="flex items-center gap-1.5 text-[12px] ink-muted" aria-label={t("nav.breadcrumb")}>
          <Link href="/" className="py-1.5 hover:text-[#0a285a]">{t("nav.home")}</Link>
          <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          <span className="text-[#404553]">{onSearchPage ? t("browse.searchCrumb") : departmentName}</span>
        </nav>

        <div className="mt-4 grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-7">
          {/* Sticky so the filters stay reachable through a long grid, and
              independently scrollable so a long facet list cannot trap the page. */}
          <aside className="hidden lg:block">
            <div className="hide-scrollbar sticky top-[92px] max-h-[calc(100vh-112px)] overflow-y-auto rounded-2xl border border-[#e6e9ef] bg-white px-4 py-1">
              {sidebar}
            </div>
          </aside>

          <section id="main" aria-label={t("browse.resultsRegion")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-[17px] font-extrabold text-[#0a285a]">{title}</h1>
                {/* The count beside the name rather than as the heading: "No results for Beauty"
                    read as a search that failed, for a department that simply has nothing yet. */}
                <p className="mt-0.5 text-[12px] font-bold ink-muted" aria-live="polite">
                  {isLoading || error ? " " : results.length === 0
                    ? t("browse.countNone")
                    : results.length === 1
                      ? t("browse.countOne")
                      : t("browse.countMany", { count: results.length })}
                </p>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-[#d5dfeb] bg-white px-3 py-2 text-[12px] font-bold text-[#536b8c]">
                <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
                {t("browse.sortBy")}
                <select
                  aria-label={t("browse.sortBy")}
                  value={filters.sort}
                  onChange={event => setFilters({ sort: event.target.value as BrowseSort })}
                  className="bg-transparent font-extrabold text-[#0a285a] outline-none"
                >
                  {BROWSE_SORTS.map(sort => <option key={sort} value={sort}>{t(SORT_LABELS[sort])}</option>)}
                </select>
              </label>
            </div>

            {chips.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {chips.map(chip => (
                  <button
                    key={chip.key}
                    onClick={chip.clear}
                    aria-label={t("browse.remove", { name: chip.label })}
                    className="pressable inline-flex items-center gap-1.5 rounded-full border border-[#d5dfeb] bg-white px-3 py-1.5 text-[11px] font-bold text-[#0a285a] hover:border-[#f2683a]"
                  >
                    <span dir="auto">{chip.label}</span>
                    <X className="size-3 ink-muted" aria-hidden />
                  </button>
                ))}
                <button onClick={clearAll} className="text-[11px] font-extrabold ink-accent underline underline-offset-4">
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
                saved={savedIds}
                onSave={product => {
                  const wasSaved = savedIds.includes(product.id);
                  toggleSaved(product.id);
                  toast(t(wasSaved ? "saved.removed" : "saved.savedForLater", { name: product.title }));
                }}
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
              <div className="mt-6 rounded-2xl border border-[#f2b69e] bg-white px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-7 ink-accent" aria-hidden />
                <h2 className="mt-3 text-lg font-extrabold text-[#0a285a]">{t("home.catalogSlow")}</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#536b8c]">{t("home.refreshNote")}</p>
                <button onClick={() => void refetch()} className="glass glass-navy pressable mt-5 rounded-full px-5 py-3 text-xs font-extrabold">
                  {t("home.refreshCatalog")}
                </button>
              </div>
            ) : results.length ? (
              <>
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
                    saved={savedIds.includes(product.id)}
                    onSave={() => {
                      const wasSaved = savedIds.includes(product.id);
                      toggleSaved(product.id);
                      toast(t(wasSaved ? "saved.removed" : "saved.savedForLater", { name: product.title }));
                    }}
                    onQuickView={() => setQuickProduct(product)}
                  />
                ))}
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-7 ink-muted" aria-hidden />
                <h2 className="mt-3 text-lg font-extrabold text-[#0a285a]">
                  {activeCount ? t("browse.empty") : searched ? t("browse.emptySearch") : t("browse.emptyCategory")}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#536b8c]">
                  {activeCount ? t("browse.emptyNote") : searched ? t("browse.emptySearchNote") : t("browse.emptyCategoryNote")}
                </p>
                {activeCount ? (
                  <button onClick={clearAll} className="glass glass-navy pressable mt-5 rounded-full px-5 py-3 text-xs font-extrabold">
                    {t("browse.clearAll")}
                  </button>
                ) : (
                  /* Everything means everything: the search term goes as well. */
                  <button onClick={() => { setSheetOpen(false); navigate("/category/all"); setQueryString(""); }} className="glass glass-navy pressable mt-5 rounded-full px-5 py-3 text-xs font-extrabold">
                    {t("browse.browseEverything")}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* On a phone the sidebar becomes a sheet behind one always-reachable
          button, so the filters do not push the products off the first screen. */}
      <button
        onClick={() => setSheetOpen(true)}
        className="glass glass-navy pressable fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit items-center gap-2 rounded-full px-6 py-3.5 text-xs font-extrabold shadow-[0_10px_30px_rgba(10,40,90,.25)] lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        {activeCount ? t("browse.filtersWithCount", { count: activeCount }) : t("browse.filters")}
      </button>

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
                  <button onClick={clearAll} className="text-[11px] font-extrabold ink-accent underline underline-offset-4">
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
      <MobileTabBar />
      <div aria-hidden className="h-12 lg:h-16" />
      <SiteFooter clearance="tall" />
    </main>
  );
}
