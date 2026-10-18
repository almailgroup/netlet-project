/**
 * One store's public page, `/stores/<slug>`.
 *
 * A marketplace's sellers had no page of their own: "Sold by" was a line of
 * text, and the closest thing to a store was the department page ticked to
 * one seller. This is the store as a shopper would ask about it — who it is,
 * what it says about itself, how it delivers, how its customers rated it — and
 * its whole live shelf.
 *
 * **Everything on it is either the store's own words or measured.** The
 * description, the name and the logo are what the store gave NetLet; the
 * rating counts only from five visible reviews (the High Rating floor), the
 * badges are `storefrontBadges`' and the delivery terms are the ones checkout
 * charges by (`Shared/commerce/delivery.ts`). Nothing private about the store
 * reaches the page: `getStorePage` never selects its contact details, licence
 * numbers, IBAN or commission.
 *
 * The products are narrowed and ordered here, in the address (`?dept=`, `?q=`,
 * `?sort=`), the department page's rule — a narrowed store is something
 * somebody sends — and searched by `rankBySearch`, the rule every other search
 * on the shop answers by. The reviews are the newest, whatever their stars: a
 * store page that picked its best ones would be an advert.
 */
import { MapPin, PackageOpen, Search, SlidersHorizontal, Store as StoreIcon, Truck, Wallet, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { toast } from "sonner";
import { BUTTON_PRIMARY, Breadcrumbs, CARD, EmptyState, PageBody, TITLE } from "@/components/layout/Page";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { StoreBadges, StoreMark, StoreRating } from "@/components/store/StoreCard";
import { Select } from "@/components/ui/Select";
import { useCustomer } from "@/contexts/CustomerContext";
import { categoryMessageKey } from "@/content/homeLayout";
import { SHOP_TIME_ZONE, useDateFormat } from "@/hooks/useDateFormat";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { BROWSE_SORTS, categorySlug, sortProducts, type BrowseSort } from "@shared/commerce/browse";
import { rankBySearch } from "@shared/commerce/search";
import type { Product } from "@shared/commerce/types";
import { kuwaitDeliveryZones } from "@shared/customer";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta, storeMeta } from "@shared/seo";

const SORT_LABELS: Record<BrowseSort, MessageKey> = {
  relevance: "browse.sort.relevance",
  "price-low": "browse.sort.priceLow",
  "price-high": "browse.sort.priceHigh",
  discount: "browse.sort.discount",
  rating: "browse.sort.rating",
  newest: "browse.sort.newest",
};

/** A store with this many products or fewer is read at a glance; past it, it gets a search of its own. */
const SEARCH_FROM = 12;

export default function Store() {
  const [, params] = useRoute("/stores/:slug");
  const slug = params?.slug ? decodeURIComponent(params.slug) : "";
  const { t, locale, isArabic } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const [location, navigate] = useLocation();
  const query = useSearch();
  const { savedIds, toggleSaved } = useCustomer();
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  usePageChrome({ activeDepartment: null });

  const page = trpc.commerce.store.useQuery({ slug, locale }, { enabled: Boolean(slug), staleTime: 60 * 1000 });
  const store = page.data?.store ?? null;
  const shelf = useMemo(() => page.data?.products ?? [], [page.data]);

  usePageMeta(store ? storeMeta(store, SITE_URL) : privatePageMeta(page.isLoading ? t("stores.title") : t("stores.notFound")));

  /* The view lives in the address, so it survives Back and can be sent. */
  const view = useMemo(() => {
    const read = new URLSearchParams(query);
    const sort = read.get("sort");
    return {
      department: read.get("dept") ?? "",
      term: read.get("q") ?? "",
      sort: (BROWSE_SORTS as string[]).includes(sort ?? "") ? sort as BrowseSort : "relevance" as BrowseSort,
    };
  }, [query]);
  const setView = (patch: Partial<typeof view>) => {
    const next = { ...view, ...patch };
    const write = new URLSearchParams();
    if (next.department) write.set("dept", next.department);
    if (next.term.trim()) write.set("q", next.term);
    if (next.sort !== "relevance") write.set("sort", next.sort);
    const search = write.toString();
    navigate(`${location}${search ? `?${search}` : ""}`, { replace: true });
  };

  /* The departments this store sells in, each with how many — the chips over
     the grid. A merchant's own product type is a department of its own here,
     named as they typed it, the department page's rule. */
  const departments = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const product of shelf) {
      if (!product.productType) continue;
      const key = categorySlug(product.productType);
      const entry = counts.get(key) ?? { name: product.productType, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()].map(([key, entry]) => ({ key, ...entry })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [shelf]);
  const departmentLabel = (name: string) => {
    const key = categoryMessageKey(name);
    return key ? t(key) : name;
  };

  const shown = useMemo(() => {
    const inDepartment = view.department ? shelf.filter(product => product.productType && categorySlug(product.productType) === view.department) : shelf;
    const term = view.term.trim();
    if (term) {
      const ranked = rankBySearch(inDepartment, term);
      return view.sort === "relevance" ? ranked : sortProducts(ranked, view.sort);
    }
    return sortProducts(inDepartment, view.sort);
  }, [shelf, view]);

  const onSave = (product: Product) => {
    const wasSaved = savedIds.includes(product.id);
    toggleSaved(product.id);
    toast(t(wasSaved ? "saved.removed" : "saved.savedForLater", { name: product.title }));
  };

  if (page.isLoading) {
    return (
      <PageBody>
        <div aria-hidden className={`${CARD} h-[188px] animate-pulse`} />
        <div aria-hidden className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[340px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white/60" />)}
        </div>
      </PageBody>
    );
  }

  if (page.error || !store) {
    return (
      <PageBody>
        <Breadcrumbs trail={[{ label: t("stores.title"), href: "/stores" }]} />
        <EmptyState
          heading="h1"
          icon={<StoreIcon className="size-6" />}
          title={t(page.error ? "home.catalogSlow" : "stores.notFound")}
          note={t(page.error ? "home.refreshNote" : "stores.notFoundNote")}
        >
          {page.error
            ? <button type="button" onClick={() => void page.refetch()} className={BUTTON_PRIMARY}>{t("home.refreshCatalog")}</button>
            : <Link href="/stores" className={BUTTON_PRIMARY}>{t("stores.seeAll")}</Link>}
        </EmptyState>
      </PageBody>
    );
  }

  const zone = kuwaitDeliveryZones.find(entry => entry.id === store.governorate);
  const since = new Date(store.since).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: SHOP_TIME_ZONE });
  const fee = store.delivery.flat && Number(store.delivery.flat) > 0 ? store.delivery.flat : null;
  const freeOver = store.delivery.freeOver && Number(store.delivery.freeOver) > 0 ? store.delivery.freeOver : null;
  /* What checkout charges (`quoteDelivery`): no fee recorded is free delivery,
     never a number the store did not type. */
  const deliveryLine = !fee
    ? t("stores.deliveryFree")
    : freeOver
      ? t("stores.deliveryFeeFreeOver", { fee: money(fee), threshold: money(freeOver) })
      : t("stores.deliveryFee", { fee: money(fee) });
  const facts: { icon: typeof Truck; label: string }[] = [
    { icon: Truck, label: deliveryLine },
    ...(store.delivery.speed ? [{ icon: Zap, label: t(`speed.${store.delivery.speed}` as MessageKey) }] : []),
    ...(store.delivery.cashOnDelivery ? [{ icon: Wallet, label: t("home.payOnDelivery") }] : []),
  ];
  const narrowed = Boolean(view.department || view.term.trim());

  return (
    <>
      <PageBody>
        <Breadcrumbs trail={[{ label: t("stores.title"), href: "/stores" }, { label: <bdi>{store.name}</bdi> }]} />

        <section aria-labelledby="store-title" className={`${CARD} p-5 sm:p-7`}>
          <div className="flex items-start gap-4 sm:gap-5">
            <StoreMark name={store.name} logoUrl={store.logoUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 id="store-title" dir="auto" className={TITLE}>{store.name}</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] ink-muted">
                <StoreRating rating={store.rating} />
                {store.rating ? <span aria-hidden>·</span> : null}
                <span>{store.products === 1 ? t("home.brandCountOne") : t("home.brandCountMany", { count: store.products })}</span>
                {zone ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{isArabic ? zone.labelAr : zone.label}</span>
                  </>
                ) : null}
                <span aria-hidden>·</span>
                <span>{t("stores.since", { date: since })}</span>
              </p>
              {store.badges.length ? <div className="mt-2.5"><StoreBadges badges={store.badges} /></div> : null}
            </div>
          </div>

          {store.description ? (
            <p dir="auto" className="mt-5 max-w-[75ch] whitespace-pre-line text-[15px] leading-7 text-[#1f2229]">{store.description}</p>
          ) : null}

          <ul className="mt-5 flex flex-wrap gap-2 border-t border-[#eef1f5] pt-5">
            {facts.map(fact => (
              <li key={fact.label} className="inline-flex items-center gap-2 rounded-full bg-[#f3f5f9] px-3.5 py-2 text-[13px] font-semibold text-[#0a285a]">
                <fact.icon className="size-4 shrink-0 ink-accent" aria-hidden />{fact.label}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="store-products" className="mt-8 sm:mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="store-products" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">
              {t("stores.products")}
            </h2>
            {shelf.length > 1 ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#d5dfeb] bg-white px-3 py-2 text-[13px] font-bold text-[#536b8c] transition-colors hover:bg-[#f0f2f5] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f2683a]">
                <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
                {t("browse.sortBy")}
                <Select
                  aria-label={t("browse.sortBy")}
                  value={view.sort}
                  onChange={event => setView({ sort: event.target.value as BrowseSort })}
                  className="bg-transparent font-extrabold text-[#0a285a] outline-none"
                >
                  {BROWSE_SORTS.map(sort => <option key={sort} value={sort}>{t(SORT_LABELS[sort])}</option>)}
                </Select>
              </label>
            ) : null}
          </div>

          {shelf.length > SEARCH_FROM || departments.length > 1 ? (
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
              {shelf.length > SEARCH_FROM ? (
                <form role="search" className="lg:w-[320px] lg:shrink-0" onSubmit={event => event.preventDefault()}>
                  <label className="relative block">
                    <span className="sr-only">{t("stores.searchLabel", { name: store.name })}</span>
                    <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 ink-muted" aria-hidden />
                    <input
                      type="search"
                      value={view.term}
                      onChange={event => setView({ term: event.target.value })}
                      placeholder={t("stores.searchPlaceholder")}
                      className="glass-field h-11 w-full rounded-xl ps-10 pe-3 text-[14px] text-[#0a285a]"
                    />
                  </label>
                </form>
              ) : null}
              {departments.length > 1 ? (
                <div role="group" aria-label={t("stores.departments")} className="hide-scrollbar flex min-w-0 gap-2 overflow-x-auto pb-1">
                  {[{ key: "", name: "", count: shelf.length }, ...departments].map(entry => (
                    <button
                      key={entry.key || "all"}
                      type="button"
                      aria-pressed={view.department === entry.key}
                      onClick={() => setView({ department: entry.key })}
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-bold transition-colors ${view.department === entry.key ? "border-[#0a285a] bg-[#0a285a] text-white hover:bg-[#0d3372]" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"}`}
                    >
                      {entry.key ? departmentLabel(entry.name) : t("stores.allDepartments")}
                      <span className={`ms-1.5 tabular-nums ${view.department === entry.key ? "text-white/75" : "ink-muted"}`}>{entry.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {shelf.length === 0 ? (
            <div className="mt-5">
              <EmptyState icon={<PackageOpen className="size-6" />} title={t("stores.emptyShelf")} note={t("stores.emptyShelfNote")}>
                <Link href="/stores" className={BUTTON_PRIMARY}>{t("stores.seeAll")}</Link>
              </EmptyState>
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-5">
              <EmptyState icon={<Search className="size-6" />} title={t("stores.noMatch")} note={t("stores.noMatchNote")}>
                <button type="button" onClick={() => setView({ department: "", term: "" })} className={BUTTON_PRIMARY}>{t("stores.showEverything")}</button>
              </EmptyState>
            </div>
          ) : (
            <>
              <p className="sr-only" aria-live="polite">{narrowed ? t("browse.countMany", { count: shown.length }) : ""}</p>
              <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {shown.map(product => (
                  <li key={product.id} className="min-w-0">
                    <ProductCard compact product={product} saved={savedIds.includes(product.id)} onSave={() => onSave(product)} onQuickView={() => setQuickProduct(product)} />
                  </li>
                ))}
              </ul>
              {/* The read stops at the newest `STORE_PAGE_PRODUCTS`; the page
                  says so rather than letting a long shelf pass for all of it. */}
              {store.products > shelf.length ? (
                <p className="mt-4 text-[13px] ink-muted">{t("stores.newestOf", { shown: shelf.length, total: store.products })}</p>
              ) : null}
            </>
          )}
        </section>

        {page.data?.reviews.length ? (
          <section aria-labelledby="store-reviews" className="mt-10 sm:mt-12">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="store-reviews" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{t("stores.reviewsTitle")}</h2>
              <StoreRating rating={store.rating} className="text-[14px]" />
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {page.data.reviews.map(review => (
                <li key={review.id} className={`${CARD} p-4`}>
                  <p className="text-[15px] tracking-[2px] text-[#ffb800]" aria-hidden>{"★".repeat(review.rating)}<span className="text-[#d5dfeb]">{"★".repeat(5 - review.rating)}</span></p>
                  <p className="sr-only">{t("product.ratingAria", { value: review.rating, max: 5 })}</p>
                  {review.title ? <h3 dir="auto" className="mt-2 text-[15px] font-bold text-[#0a285a]">{review.title}</h3> : null}
                  {review.body ? <p dir="auto" className="mt-1.5 line-clamp-4 text-[14px] leading-6 text-[#1f2229]">{review.body}</p> : null}
                  <p className="mt-3 text-[12.5px] ink-muted">
                    {review.author || t("review.anonymous")} · <bdi>{review.productTitle}</bdi> · {formatDate(review.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageBody>
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    </>
  );
}
