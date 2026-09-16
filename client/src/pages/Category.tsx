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
 */
import { FilterSidebar } from "@/components/browse/FilterSidebar";
import { ProductCard } from "@/components/ProductCard";
import { QuickView } from "@/components/QuickView";
import { StoreHeader } from "@/components/StoreHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/lib/usePageMeta";
import { useTranslation } from "@/lib/useTranslation";
import { useOverlay } from "@/lib/useOverlay";
import {
  activeFilterCount,
  browse,
  categoryFromSlug,
  categorySlug,
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
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { savedIds, toggleSaved } = useCustomer();
  const { addItem, loading: cartLoading } = useCart();
  const { data: catalog = [], isLoading, error, refetch } = trpc.commerce.products.list.useQuery({ first: 100 });

  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  useOverlay(sheetOpen, () => setSheetOpen(false));

  const slug = params?.slug ?? "all";

  // wouter's `location` is the path only, so the query string is read from the
  // browser. Keyed off `location` as well so a navigation that only changes the
  // query still re-reads it.
  const [queryString, setQueryString] = useState(() => window.location.search);
  useEffect(() => { setQueryString(window.location.search); }, [location]);

  const categories = useMemo(
    () => Array.from(new Set(catalog.map(product => product.productType).filter((type): type is string => Boolean(type)))),
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
    const term = search.trim().toLowerCase();
    if (!term) return matched;
    return matched.filter(product =>
      [product.title, product.description, product.productType, product.vendor, ...product.tags]
        .join(" ").toLowerCase().includes(term));
  }, [catalog, filters, search]);

  // Translated where NetLet knows the department, shown as the merchant typed
  // it otherwise — a product type is their words, not ours.
  const translatedName = category === "all" ? null : categoryMessageKey(category);
  const title = category === "all"
    ? t("browse.allProducts")
    : translatedName ? t(translatedName) : category;

  usePageMeta(privatePageMeta(title));

  const activeCount = activeFilterCount(filters);
  const currency = catalog[0]?.priceRange.min.currencyCode ?? "KWD";

  /** Writes the filters into the URL, which is the only place they live. */
  const setFilters = (patch: Partial<BrowseFilters>) => {
    const next = { ...filters, ...patch };
    navigate(`/category/${slug}${searchFromFilters(next)}`, { replace: true });
    setQueryString(searchFromFilters(next));
  };

  const selectCategory = (nextCategory: string) => {
    // Switching department drops the old one's filters: a brand that existed in
    // Electronics rarely exists in Grocery, and carrying it over lands the
    // shopper on an empty page they did not ask for.
    setSheetOpen(false);
    const target = nextCategory === "all" ? "all" : categorySlug(nextCategory);
    navigate(`/category/${target}${searchFromFilters({ ...EMPTY_FILTERS, sort: filters.sort })}`);
    setQueryString(searchFromFilters({ ...EMPTY_FILTERS, sort: filters.sort }));
  };

  const clearAll = () => {
    navigate(`/category/${slug}`, { replace: true });
    setQueryString("");
  };

  const openProduct = (product: Product) =>
    window.location.assign(appPath(`/products/${encodeURIComponent(product.handle)}`));

  const addToCart = async (product: Product, quantity = 1) => {
    const variant = product.variants[0];
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    try {
      await addItem(variant.id, quantity);
      // The confirmation counts when the count is not one: "added to your cart"
      // after picking three is a receipt that does not match the request.
      toast.success(quantity > 1
        ? t("cart.addedQuantity", { count: String(quantity), name: product.title })
        : t("cart.added", { name: product.title }));
    } catch {
      toast.error(t("cart.addFailed"));
    }
  };

  const buyNow = async (product: Product, quantity = 1) => {
    const variant = product.variants[0];
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    try {
      await addItem(variant.id, quantity);
      window.location.assign(appPath("/checkout"));
    } catch {
      toast.error(t("cart.buyFailed"));
    }
  };

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
    <main className="min-h-screen bg-background pb-40 text-[#0a285a] lg:pb-10">
      <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openProduct} />

      <div className="container pt-4 sm:pt-6">
        <nav className="flex items-center gap-1.5 text-[12px] ink-muted" aria-label={t("nav.breadcrumb")}>
          <Link href="/" className="py-1.5 hover:text-[#0a285a]">{t("nav.home")}</Link>
          <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          <span className="text-[#404553]">{title}</span>
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
              <h1 className="text-[15px] font-extrabold text-[#0a285a]" aria-live="polite">
                {isLoading || error ? " " : results.length === 0
                  ? t("browse.resultsNone", { name: title })
                  : results.length === 1
                    ? t("browse.resultOne", { name: title })
                    : t("browse.results", { count: results.length, name: title })}
              </h1>

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
                    onDetails={() => openProduct(product)}
                    onQuickView={() => setQuickProduct(product)}
                    onAdd={(quantity) => void addToCart(product, quantity)}
                    onBuyNow={(quantity) => void buyNow(product, quantity)}
                    isAdding={cartLoading}
                  />
                ))}
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-7 ink-muted" aria-hidden />
                <h2 className="mt-3 text-lg font-extrabold text-[#0a285a]">
                  {activeCount || search ? t("browse.empty") : t("browse.emptyCategory")}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#536b8c]">
                  {activeCount || search ? t("browse.emptyNote") : t("browse.emptyCategoryNote")}
                </p>
                {activeCount ? (
                  <button onClick={clearAll} className="glass glass-navy pressable mt-5 rounded-full px-5 py-3 text-xs font-extrabold">
                    {t("browse.clearAll")}
                  </button>
                ) : (
                  <button onClick={() => selectCategory("all")} className="glass glass-navy pressable mt-5 rounded-full px-5 py-3 text-xs font-extrabold">
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
        <div className="fixed inset-0 z-[70] bg-[#061b3b]/35 backdrop-blur-[2px] lg:hidden" onClick={() => setSheetOpen(false)}>
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
    </main>
  );
}
