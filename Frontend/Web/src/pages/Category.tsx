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
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { FilterSidebar } from "@/components/browse/FilterSidebar";
import { DealShelves } from "@/components/browse/DealShelves";
import { dealShelves } from "@shared/commerce/deals";
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
  clearFilterGroup,
  filterGroups,
  type BrowseFilters,
  type BrowseSort,
  type FilterGroupKey,
} from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import { categoryMessageKey } from "@/content/homeLayout";
import { departmentMeta, privatePageMeta } from "@shared/seo";
import { findSubcategory, subcategoriesOf, subcategoryName } from "@shared/commerce/subcategories";
import type { MessageKey } from "@shared/i18n/dictionary";
import {
  ArrowUpDown, BadgePercent, Banknote, Check, ChevronDown, LayoutGrid, ListFilter, PackageOpen, SlidersHorizontal, Star, Store, Tag, Truck, X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";
import { NoticeDot } from "@/components/ui/CountBadge";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAssistantMark } from "@/hooks/useAssistantMark";

const SORT_LABELS: Record<BrowseSort, MessageKey> = {
  relevance: "browse.sort.relevance",
  "price-low": "browse.sort.priceLow",
  "price-high": "browse.sort.priceHigh",
  discount: "browse.sort.discount",
  rating: "browse.sort.rating",
  newest: "browse.sort.newest",
};

/* Each filter group's picture on its chip, after the owner's reference: a
   tag for brands, a note for price, a badge for offers. */
const GROUP_ICONS: Record<Exclude<FilterGroupKey, `option:${string}`>, LucideIcon> = {
  offers: BadgePercent,
  brand: Tag,
  price: Banknote,
  category: LayoutGrid,
  rating: Star,
  seller: Store,
  speed: Truck,
};

/** Which sheet a phone has open: every filter, one group of them, or the sort. */
type Sheet = { kind: "filters"; group: FilterGroupKey | null } | { kind: "sort" };

export default function Category() {
  const [, params] = useRoute("/category/:slug");
  const [onSearchPage] = useRoute("/search");
  const [location, navigate] = useLocation();
  const { t, locale } = useTranslation();
  const { heartedIds, toggleSaved } = useCustomer();
  const shelf = useCatalog(DEPARTMENT_SHELF);
  const catalog = shelf.data ?? [];

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  useOverlay(sheet !== null, () => setSheet(null));
  /* Focus goes into a sheet as it opens — after `useOverlay`, which records
     the opener to hand it back to. */
  const sheetClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (sheet) sheetClose.current?.focus(); }, [sheet]);

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
  /* A subcategory is the page rather than a facet, so its facets are its own products'. */
  const inPage = useMemo(
    () => (filters.sub ? inCategory.filter(product => product.subcategory === filters.sub) : inCategory),
    [inCategory, filters.sub],
  );
  /*
   * The Deals page, on the owner's word: the whole shop narrowed to what is on
   * offer — the Deals tab, and the footer's "On offer" — drawn as a shelf per
   * kind of thing (`DealShelves`) under the filter chips. "On offer" is the
   * page rather than a filter on it: it is not counted, not a chip, and
   * Clear all keeps it, and the facets are those of what is on offer, so a
   * brand ticked here has deals to show.
   */
  const dealsPage = !onSearchPage && category === "all" && !searching && filters.onOffer;
  const shownFilters = useMemo(() => (dealsPage ? { ...filters, onOffer: false } : filters), [dealsPage, filters]);
  const facets = useMemo(
    () => facetsFor(searching ? matched : dealsPage ? applyFilters(inPage, { ...EMPTY_FILTERS, onOffer: true }) : inPage),
    [searching, matched, inPage, dealsPage],
  );

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
  /* A department NetLet keeps, by the slug in the address — its subcategories are the chips under the heading. */
  const knownDepartment = DEPARTMENTS.find(entry => entry.slug === slug);
  const activeSub = onSearchPage ? null : findSubcategory(knownDepartment?.slug, filters.sub);
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
  /* The deals with nothing else narrowing them, which can only be empty because nothing is on offer. */
  const dealsView = dealsPage && activeFilterCount(shownFilters) === 0;
  const viewName = category === "all" && !searched
    ? dealsPage ? t("nav.deals")
      : filters.sort === "newest" && activeFilterCount(filters) === 0 ? t("footer.newArrivals")
      : null
    : null;
  const title = searched
    ? category === "all" ? t("browse.searchTitle", { query: searched }) : t("browse.searchInTitle", { query: searched, name: departmentName })
    : viewName ?? (activeSub ? subcategoryName(activeSub, locale === "ar") : departmentName);

  /* A department page is a page to be found; a search or a filtered view is not. */
  usePageMeta(
    !onSearchPage && !searched && !activeFilterCount(filters) && !filters.sub && knownDepartment
      ? departmentMeta(knownDepartment.name, knownDepartment.slug, SITE_URL)
      : privatePageMeta(title),
  );

  const activeCount = activeFilterCount(shownFilters);
  /* How many of this shelf's products each subcategory holds, and the chips worth a press. */
  const subCounts = useMemo(() => {
    const counted = new Map<string, number>();
    for (const product of inCategory) if (product.subcategory) counted.set(product.subcategory, (counted.get(product.subcategory) ?? 0) + 1);
    return counted;
  }, [inCategory]);
  const subChips = knownDepartment && !searching && !onSearchPage
    ? subcategoriesOf(knownDepartment.slug).filter(entry => (subCounts.get(entry.slug) ?? 0) > 0 || entry.slug === filters.sub)
    : [];
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
    setSheet(null);
    const target = nextCategory === "all" ? "all" : categorySlug(nextCategory);
    /* The search term survives a change of department; the facets do not. */
    const query = searchWithTerm({ ...EMPTY_FILTERS, sort: filters.sort }, term);
    navigate(`/category/${target}${query}`);
    setQueryString(query);
  };

  /* Clears the facets and keeps what was searched for: "Clear all" sits beside the filters, not the search box. */
  const clearAll = () => {
    /* The subcategory is the page, not a filter, so it stays. */
    const query = searchWithTerm({ ...EMPTY_FILTERS, sub: filters.sub, onOffer: dealsPage }, term);
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
    ...(shownFilters.onOffer ? [{ key: "offer", label: t("browse.onOffer"), clear: () => setFilters({ onOffer: false }) }] : []),
    ...(filters.express ? [{ key: "express", label: t("browse.expressOnly"), clear: () => setFilters({ express: false }) }] : []),
  ];

  /*
   * On a phone, sort and filter are the owner's reference: a row of chips
   * under the title, one per group that can narrow the page (`filterGroups`),
   * each opening that group alone; and a navy "Sort | Filter" pill floating
   * over the tab bar, with a dot while anything is ticked — always in reach,
   * where a Filters button in the page went up under the header with the
   * first scroll. The assistant folds to its mark beside the pill
   * (`useAssistantMark`), the reference's round button, rather than leaving
   * these pages. A wide screen keeps its sidebar and its sort beside the
   * title — one structure at a time, never both with one hidden.
   */
  const wide = useMediaQuery("(min-width: 1024px)");
  const groups = useMemo(() => filterGroups(facets, shownFilters), [facets, shownFilters]);
  /* On the Deals page a change never takes "On offer" away: it is the page. */
  const setShownFilters = (patch: Partial<BrowseFilters>) => setFilters(dealsPage ? { ...patch, onOffer: true } : patch);
  useAssistantMark(!wide);
  /* The pill leaves the assistant's mark its corner, centred in what is left. */
  const assistantOn = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 }).data?.chat === true;
  const filtersLabel = activeCount ? t("browse.filtersWithCount", { count: activeCount }) : t("browse.filters");
  const chipLabel = (key: FilterGroupKey) => {
    switch (key) {
      case "offers": return t("browse.chipOffers");
      case "brand": return t("browse.brand");
      case "price": return t("browse.price");
      case "category": return t("browse.category");
      case "rating": return t("browse.chipRating");
      case "seller": return t("browse.seller");
      case "speed": return t("browse.deliverySpeed");
      default: return key.slice("option:".length);
    }
  };
  /* A sheet's title is the group's full name where the chip's is short. */
  const groupTitle = (key: FilterGroupKey) =>
    key === "offers" ? t("browse.offers") : key === "rating" ? t("browse.rating") : chipLabel(key);
  const openGroup = sheet?.kind === "filters" ? sheet.group : null;
  const openGroupActive = openGroup ? groups.find(group => group.key === openGroup)?.active ?? 0 : 0;
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

  const sidebar = (only?: FilterGroupKey) => (
    <FilterSidebar
      facets={facets}
      filters={shownFilters}
      currency={currency}
      onChange={setShownFilters}
      onSelectCategory={selectCategory}
      only={only}
    />
  );

  return (
    <>
      <PageBody>
        <Breadcrumbs
          trail={onSearchPage
            ? [{ label: t("browse.searchCrumb") }]
            : dealsPage
              ? [{ label: t("nav.deals") }]
              : activeSub
              ? [{ label: departmentName, href: basePath }, { label: subcategoryName(activeSub, locale === "ar") }]
              : [{ label: departmentName }]}
        />
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

        {/* The department's subcategories, on the owner's word: the ones with
            something on this shelf, and the one the address names — a press
            narrows the page to it and "All" widens it again. */}
        {subChips.length ? (
          <div
            role="group"
            aria-label={t("categories.subcategories")}
            className="-mx-4 -mt-2 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            {[null, ...subChips].map(entry => {
              const pressed = (entry?.slug ?? null) === (filters.sub ?? null);
              const count = entry ? subCounts.get(entry.slug) ?? 0 : inCategory.length;
              return (
                <button
                  key={entry?.slug ?? "all"}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilters({ sub: entry?.slug ?? null })}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold ${
                    pressed ? "border-[#0a285a] bg-[#0a285a] text-white hover:bg-[#0d3372]" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
                  }`}
                >
                  {entry ? subcategoryName(entry, locale === "ar") : t("categories.allSub")}
                  <span className={pressed ? "text-white/80" : "ink-muted"}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* The filter groups as chips, the owner's reference: each opens its
            own group, and one with something ticked says how many. */}
        {!wide && groups.length ? (
          <div
            role="group"
            aria-label={t("browse.filterBy")}
            className="-mx-4 -mt-1 mb-1 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          >
            {groups.map(group => {
              const Icon = group.key.startsWith("option:") ? SlidersHorizontal : GROUP_ICONS[group.key as keyof typeof GROUP_ICONS];
              const on = group.active > 0;
              return (
                <button
                  key={group.key}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setSheet({ kind: "filters", group: group.key })}
                  className={`filter-chip flex h-11 shrink-0 items-center gap-2 rounded-full border ps-3.5 pe-3 text-[14px] text-[#0a285a] ${
                    on ? "border-[#0a285a] bg-[#eef2f8] font-bold hover:bg-[#0a285a]/[.06]" : "border-[#d5dfeb] bg-white font-semibold hover:bg-[#f0f2f5]"
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span dir="auto" className="whitespace-nowrap">{chipLabel(group.key)}</span>
                  {on ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#0a285a] px-1.5 text-[12px] font-bold text-white">{group.active}</span>
                  ) : null}
                  <ChevronDown className="size-4 shrink-0 ink-muted" aria-hidden />
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-7">
          {/* Sticky so the filters stay reachable through a long grid, and
              independently scrollable so a long facet list cannot trap the page. */}
          <aside className="hidden lg:block">
            <div className="hide-scrollbar sticky top-[92px] max-h-[calc(100vh-112px)] overflow-y-auto rounded-2xl border border-[#e6e9ef] bg-white px-4 py-1">
              {sidebar()}
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
                {dealsPage ? (
                  <DealShelves
                    shelves={dealShelves(results, { deepestFirst: filters.sort === "relevance" })}
                    saved={heartedIds}
                    onSave={product => toastHeart(toggleSaved(product.id), product.title, t)}
                    onQuickView={setQuickProduct}
                  />
                ) : (
                <>
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
                )}
              </>
            ) : (
              <div className="mt-5">
                <EmptyState
                  icon={dealsView ? <BadgePercent className="size-6" /> : <PackageOpen className="size-6" />}
                  title={dealsView ? t("browse.noDeals") : elsewhere ? t("browse.emptyHere", { name: departmentName }) : activeCount ? t("browse.empty") : searched ? t("browse.emptySearch") : t("browse.emptyCategory")}
                  note={dealsView ? t("browse.noDealsNote") : activeCount ? t("browse.emptyNote") : searched ? t("browse.emptySearchNote") : t("browse.emptyCategoryNote")}
                >
                  {/* Nothing on offer is not a filter the shopper set: the way on is everything. */}
                  {dealsView ? (
                    <button type="button" onClick={() => { setSheet(null); navigate("/category/all"); setQueryString(""); }} className={BUTTON_PRIMARY}>
                      {t("browse.browseEverything")}
                    </button>
                  ) : elsewhere ? (
                    <Link href={searchPath(typed)} className={BUTTON_PRIMARY}>
                      {t(elsewhere === 1 ? "browse.searchAllOne" : "browse.searchAllMany", { count: elsewhere })}
                    </Link>
                  ) : activeCount ? (
                    <button type="button" onClick={clearAll} className={BUTTON_PRIMARY}>{t("browse.clearAll")}</button>
                  ) : (
                    /* Everything means everything: the search term goes as well. */
                    <button type="button" onClick={() => { setSheet(null); navigate("/category/all"); setQueryString(""); }} className={BUTTON_PRIMARY}>
                      {t("browse.browseEverything")}
                    </button>
                  )}
                </EmptyState>
              </div>
            )}
          </section>
        </div>
      </PageBody>

      {/* Sort and Filter, one navy pill over the tab bar — the owner's
          reference — riding down with the bar when it slides away. Centred
          in what the assistant's mark leaves of the foot of the screen. */}
      {!wide ? (
        <div
          className={`rides-tab-bar pointer-events-none fixed start-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 flex justify-center ${assistantOn ? "end-[5.25rem]" : "end-4"}`}
        >
          <div className="pointer-events-auto flex h-[52px] items-center rounded-full bg-[#0a285a] text-white shadow-[0_10px_30px_rgba(10,40,90,.28)]">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${t("browse.sortBy")}: ${t(SORT_LABELS[filters.sort])}`}
              onClick={() => setSheet({ kind: "sort" })}
              className="flex h-full items-center gap-2 rounded-s-full ps-5 pe-4 text-[15px] font-bold hover:bg-white/[.12]"
            >
              {t("browse.sort")}
              <ArrowUpDown className="size-4" aria-hidden />
            </button>
            <span aria-hidden className="h-6 w-px bg-white/30" />
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={filtersLabel}
              onClick={() => setSheet({ kind: "filters", group: null })}
              className="relative flex h-full items-center gap-2 rounded-e-full ps-4 pe-5 text-[15px] font-bold hover:bg-white/[.12]"
            >
              {t("browse.filter")}
              <ListFilter className="size-4" aria-hidden />
              {activeCount ? <NoticeDot className="absolute end-3.5 top-2.5" /> : null}
            </button>
          </div>
        </div>
      ) : null}

      {sheet?.kind === "sort" ? (
        <div className="sheet-scrim fixed inset-0 z-[70] bg-[#061b3b]/35 lg:hidden" onClick={() => setSheet(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sort-sheet-title"
            className="sheet-rise absolute inset-x-0 bottom-0 rounded-t-[1.5rem] bg-background pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e6e9ef] px-5 py-4">
              <h2 id="sort-sheet-title" className="text-[16px] font-extrabold text-[#0a285a]">{t("browse.sortBy")}</h2>
              <button ref={sheetClose} type="button" onClick={() => setSheet(null)} aria-label={t("common.close")} className="grid size-11 place-items-center rounded-full hover:bg-[#f0f2f5]">
                <X className="size-5 text-[#0a285a]" aria-hidden />
              </button>
            </div>
            <div role="radiogroup" aria-labelledby="sort-sheet-title" className="px-3 py-2">
              {BROWSE_SORTS.map(sort => {
                const chosen = filters.sort === sort;
                return (
                  <button
                    key={sort}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => { setFilters({ sort }); setSheet(null); }}
                    className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-3 text-start text-[15px] text-[#0a285a] hover:bg-[#f0f2f5] ${chosen ? "font-bold" : "font-medium"}`}
                  >
                    {t(SORT_LABELS[sort])}
                    {chosen ? <Check className="size-5 shrink-0 text-[#0a285a]" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {sheet?.kind === "filters" ? (
        <div className="sheet-scrim fixed inset-0 z-[70] bg-[#061b3b]/35 lg:hidden" onClick={() => setSheet(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-sheet-title"
            className={`sheet-rise absolute inset-x-0 bottom-0 flex flex-col rounded-t-[1.5rem] bg-background ${openGroup ? "max-h-[75vh]" : "max-h-[86vh]"}`}
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#e6e9ef] px-5 py-3">
              <h2 id="filter-sheet-title" dir="auto" className="min-w-0 truncate text-[16px] font-extrabold text-[#0a285a]">
                {openGroup ? groupTitle(openGroup) : t("browse.filters")}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                {openGroup ? (
                  openGroupActive ? (
                    <button type="button" onClick={() => setShownFilters(clearFilterGroup(shownFilters, openGroup))} className="min-h-11 px-2 text-[13px] font-extrabold ink-accent underline underline-offset-4">
                      {t("browse.clearGroup")}
                    </button>
                  ) : null
                ) : activeCount ? (
                  <button type="button" onClick={clearAll} className="min-h-11 px-2 text-[13px] font-extrabold ink-accent underline underline-offset-4">
                    {t("browse.clearAll")}
                  </button>
                ) : null}
                <button ref={sheetClose} type="button" onClick={() => setSheet(null)} aria-label={t("browse.closeFilters")} className="grid size-11 place-items-center rounded-full hover:bg-[#f0f2f5]">
                  <X className="size-5 text-[#0a285a]" aria-hidden />
                </button>
              </div>
            </div>
            <div className="hide-scrollbar flex-1 overflow-y-auto px-5">{sidebar(openGroup ?? undefined)}</div>
            <div className="border-t border-[#e6e9ef] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => setSheet(null)}
                className="h-12 w-full rounded-full bg-[#0a285a] text-[15px] font-bold text-white hover:bg-[#0d3372]"
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
