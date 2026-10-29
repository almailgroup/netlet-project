/**
 * The home page: the front door (`HomeHero`), the departments as cards, the
 * paid placements, Deals as a navy band led by the deepest one, Bestsellers
 * ranked, the shopper's own picks, the brands, the stores, the new arrivals as
 * a grid, and the footer. Every shelf after the departments is drawn only when
 * it has something true to show.
 */
import { toastHeart } from "@/lib/heartToast";
import { useCatalog } from "@/hooks/useCatalog";
import { HEADER_SHELF } from "@/lib/routeData";
import { homeRailDefinitions, shelvesFor } from "@/content/homeLayout";
import { useFeature } from "@/hooks/useFeature";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import type { Product } from "@shared/commerce/types";
import { Fragment, lazy, Suspense, useDeferredValue, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { DepartmentCards } from "@/components/home/DepartmentCards";
import { HomeBanners } from "@/components/home/HomeBanners";
import { HomeHero } from "@/components/home/HomeHero";
import { StoreShelf } from "@/components/home/StoreShelf";
import { GuideShelf } from "@/components/home/GuideShelf";
import { Later } from "@/components/layout/Later";
import { BrandShelf } from "@/components/home/BrandShelf";
import { RecommendedRail } from "@/components/product/RecommendedRail";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { useSideScroll } from "@/hooks/useSideScroll";
import { Link, useLocation } from "wouter";

/* Fetched on the first preview, not with the page: most visits open none. */
const QuickView = lazy(() => import("@/components/product/QuickView").then(module => ({ default: module.QuickView })));
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { homeMeta } from "@shared/seo";
import { logoImage } from "@/lib/brandAssets";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

function CatalogSkeleton() {
  return <div className="hide-scrollbar mt-4 flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((item) => <div key={item} className="min-w-[164px] animate-pulse rounded-2xl border border-[#e6e9ef] bg-white p-3 sm:min-w-[195px] lg:min-w-0 lg:flex-1"><div className="aspect-square rounded-xl bg-[#eef1f5]" /><div className="mt-4 h-4 w-2/3 rounded bg-[#eef1f5]" /><div className="mt-2 h-3 w-1/3 rounded bg-[#eef1f5]" /></div>)}</div>;
}

type RailProps = {
  id: string;
  title: MessageKey;
  products: Product[];
  catalogLoading: boolean;
  catalogError: boolean;
  saved: string[];
  onSave: (id: string, title: string) => void;
  onQuickView: (product: Product) => void;
  /** Absent where the shelf is the whole list — Bestsellers has no page of its own. */
  onViewAll?: () => void;
  /**
   * Each card beside its place — 1, 2, 3 — in large outlined figures. Only for
   * a shelf whose order *is* a ranking: Bestsellers, by units sold.
   */
  ranked?: boolean;
};

/**
 * A shelf's title and its way to everything else. A plain heading and a "View
 * all" link: the shelves used to carry a display-face headline, a sentence of
 * description under it and an uppercase pill, which is three ways of saying
 * the title.
 */
function ShelfHeading({ id, title, onViewAll, children }: { id: string; title: string; onViewAll?: () => void; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        {onViewAll ? (
          <button onClick={onViewAll} className="pressable -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold ink-accent hover:underline">
            {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One shelf of products, scrolled sideways. The arrows scroll it a screenful at
 * a time and appear only when there is something off-screen to reach.
 */
function ProductRail({ id, title, products, catalogLoading, catalogError, saved, onSave, onQuickView, onViewAll, ranked = false }: RailProps) {
  const { t } = useTranslation();
  const railProducts = products.slice(0, 12);
  const railTitle = t(title);
  const scroll = useSideScroll<HTMLDivElement>([railProducts.length, catalogLoading]);

  return (
    <section id={id} className="py-6 sm:py-8" aria-labelledby={`${id}-title`}>
      <div className="container">
        <ShelfHeading id={id} title={railTitle} onViewAll={onViewAll}>
          <ScrollArrows scroll={scroll} previousLabel={t("home.previousProducts", { title: railTitle })} nextLabel={t("home.nextProducts", { title: railTitle })} />
        </ShelfHeading>
        {catalogLoading ? <CatalogSkeleton /> : catalogError ? (
          <div className="mt-4 rounded-2xl border border-[#f2b69e] bg-white px-6 py-10 text-center text-[#0a285a]"><p className="text-sm font-bold">{t("home.catalogSlow")}</p></div>
        ) : (
          <div ref={scroll.trackRef} className="hide-scrollbar mt-4 flex snap-x gap-3 overflow-x-auto scroll-smooth pb-1">
            {railProducts.map((product, index) => (
              /* Four to a row from lg up, whatever the container's width, so a shelf fills its row. */
              <div key={`${id}-${product.id}`} className={`shrink-0 snap-start ${ranked ? "flex w-[200px] items-end sm:w-[235px]" : "w-[164px] sm:w-[195px]"} lg:w-[calc((100%-2.25rem)/4)]`}>
                {/* Drawn, not said: the list's own order is the ranking for a
                    screen reader, and "1" read before every card is noise. */}
                {ranked ? <span aria-hidden className="rank-figure" data-digits={String(index + 1).length}>{index + 1}</span> : null}
                <div className="relative min-w-0 flex-1">
                  <ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The new arrivals, as a grid to browse rather than a second strip to scroll.
 * Two to a row on a phone, up to five on a wide screen.
 */
function ProductGrid({ id, title, products, catalogLoading, catalogError, saved, onSave, onQuickView, onViewAll }: RailProps) {
  const { t } = useTranslation();
  if (catalogLoading || catalogError) return null;
  return (
    <section id={id} className="py-6 sm:py-8" aria-labelledby={`${id}-title`}>
      <div className="container">
        <ShelfHeading id={id} title={t(title)} onViewAll={onViewAll} />
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {products.slice(0, 15).map(product => (
            <li key={`${id}-${product.id}`} className="min-w-0">
              <ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Deals, as a navy band across the page rather than one more white shelf.
 *
 * The deepest saving leads, two columns wide (`ProductCard`'s `feature`), and
 * three more sit beside it — the shelf `shelvesFor` already decided, deepest
 * first, so the band is drawn exactly when the home page's Deals shelf would
 * be, from four products up, and a saving is only ever one the store's
 * discount permit allows (`fromInventory` drops the rest on the read). No
 * "ends on" date: a permit's period is when a saving *may* be advertised, not
 * when this one stops, and saying it would be the shop promising for a seller.
 */
function DealsBand({ products, saved, onSave, onQuickView }: Pick<RailProps, "products" | "saved" | "onSave" | "onQuickView">) {
  const { t } = useTranslation();
  const [lead, ...rest] = products;
  if (!lead) return null;
  const card = (product: Product, feature = false) => (
    <ProductCard compact={!feature} feature={feature} product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
  );
  return (
    <section id="deals" aria-labelledby="deals-title" className="mt-6 bg-[#0a285a] py-8 sm:mt-10 sm:py-11">
      <div className="container">
        <div className="flex items-center justify-between gap-4">
          <h2 id="deals-title" className="text-xl font-extrabold tracking-[-.01em] text-white sm:text-2xl">{t("rail.deals.title")}</h2>
          <Link href="/category/all?offer=1&sort=discount" className="pressable -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold ink-accent-on-dark hover:underline">
            {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        {/* The lead is the whole row on a phone and a tablet, two of five
            columns on a wide screen. A phone shows two beside nothing, not
            three with one left alone on a row. */}
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <li className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">{card(lead, true)}</li>
          {rest.slice(0, 3).map((product, index) => (
            <li key={product.id} className={`min-w-0 ${index === 2 ? "hidden sm:block" : ""}`}>{card(product)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* One empty list, so "nothing yet" is the same value from render to render. */
const NO_PRODUCTS: Product[] = [];

export default function Home() {
  // One dialog for the whole page: three rails and the deals surface all open
  // the same overlay, the way the drawer is mounted once in `App`.
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [, navigate] = useLocation();
  usePageMeta(homeMeta(SITE_URL));
  const { t, locale } = useTranslation();
  const { heartedIds: saved, toggleSaved: togglePersistentSaved } = useCustomer();
  const { data: catalogNow = NO_PRODUCTS, isLoading: catalogFetching, error: catalogError } = useCatalog(HEADER_SHELF);
  /* The shelves are rebuilt from a deferred copy, so thirty cards arriving at
     once are drawn in pieces rather than in one stretch a tap cannot get
     through; until then the shelves show what they showed. */
  const catalog = useDeferredValue(catalogNow);
  /* Still loading while the deferred copy catches up, so a shelf keeps its
     outline for that moment rather than vanishing and coming back. */
  const catalogLoading = catalogFetching || catalog !== catalogNow;
  const bestsellers = trpc.commerce.bestsellers.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });

  /* The header search goes to the results page on Enter; the shelves are the shop's, not the search's. */
  const shelves = useMemo(() => shelvesFor(catalog, bestsellers.data ?? []), [catalog, bestsellers.data]);
  const articlesOn = useFeature("articles");
  const appBannerOn = useFeature("appBanner");

  const toggleSaved = (id: string, title: string) => toastHeart(togglePersistentSaved(id), title, t);

  const renderRail = (rail: (typeof homeRailDefinitions)[number], index: number) => {
      const products = shelves[rail.id];
      const viewAll = rail.select === "offers" ? () => navigate("/category/all?offer=1&sort=discount")
        : rail.select === "newest" ? () => navigate("/category/all?sort=newest")
        : undefined;
      const shared = { id: rail.id, title: rail.title, products, catalogLoading, catalogError: Boolean(catalogError), saved, onSave: toggleSaved, onQuickView: setQuickProduct, onViewAll: viewAll, ranked: rail.id === "bestsellers" };
      /* What is about this shopper, and the brands, sit between what sold
         and what is new — drawn only when each has something true to show. */
      const before = rail.id === "newest" ? (
        <>
          <RecommendedRail quiet saved={saved} onSave={toggleSaved} onQuickView={setQuickProduct} />
          <BrandShelf />
          <StoreShelf />
        </>
      ) : null;
      if ((catalogLoading || catalogError) && index > 0) return <Fragment key={rail.id}>{before}</Fragment>;
      if (!catalogLoading && !catalogError && products.length === 0) return <Fragment key={rail.id}>{before}</Fragment>;
      /* A shelf scrolls sideways; the new arrivals are a grid, so the page
         ends on products laid out to browse rather than on a second strip. */
      return (
        <Fragment key={rail.id}>
          {before}
          {rail.id === "deals" && !catalogLoading && !catalogError
            ? <DealsBand {...shared} />
            : rail.layout === "grid" ? <ProductGrid {...shared} /> : <ProductRail {...shared} />}
        </Fragment>
      );
  };

  /* The header, the footer and the tab bar are the shop's frame
     (`StorefrontShell`), drawn once for every page — Home included, which
     kept a header of its own for a long time and drifted from the rest. */
  return <>

    {/* The front door: the pictures and one line. It carries the page's h1,
        the shop's name first for a screen reader. */}
    <HomeHero />

    {/* The departments, a row to scroll sideways. */}
    <DepartmentCards />

    {/* The rest is below the first screen: drawn the frame after the first
        paint, in pieces a tap can get between (`Later`). The Deals band was
        drawn with the first paint, and with remembered shelves that put a
        dozen product cards in front of it on every returning visit. */}
    <Later>
      {/* Paid banners (3.3.15), approved by NetLet; absent when none runs today. */}
      <HomeBanners />

      {/* Paid placements (3.3.15), on a shelf of their own and labelled. */}
      <SponsoredShelf
        slot="home"
        layout="rail"
        saved={saved}
        onSave={product => toggleSaved(product.id, product.title)}
        onQuickView={setQuickProduct}
      />

      {/* Deals, drawn from four discounted products up, then every other live
          product as New arrivals (`shelvesFor`). While the catalog loads the
          first draws its skeleton, so the page does not jump. */}
      {homeRailDefinitions.map((rail, index) => renderRail(rail, index))}
      {articlesOn ? <GuideShelf /> : null}
    </Later>

    {/* Switched off until there is an app to download (2.3). */}
    {appBannerOn ? <section className="container pb-10"><div className="relative overflow-hidden rounded-[1.5rem] bg-[#fffdf9] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -bottom-16 end-5 size-56 rounded-t-[3rem] bg-[#0a285a]" /><div className="absolute bottom-0 end-12 h-[215px] w-[116px] rounded-t-[1.5rem] border-[7px] border-[#0a285a] bg-white shadow-[0_18px_35px_rgba(10,40,90,.18)]"><img src={logoImage} alt="NetLet" loading="lazy" decoding="async" className="absolute left-1/2 top-[45%] w-16 -translate-x-1/2" /></div><div className="relative z-10 max-w-[55%]"><p className="text-[12px] font-semibold text-[#a44a2b]">{t("home.application")}</p><h2 className="font-extrabold mt-3 text-2xl text-[#0a285a]">{t("home.appTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.appNote")}</p><button onClick={() => toast(t("home.appSoon"))} className="glass glass-navy pressable mt-6 rounded-full px-4 py-3 text-[12px] font-semibold">{t("home.appUpdates")}</button></div></div></section> : null}

    {quickProduct ? <Suspense fallback={null}><QuickView product={quickProduct} onClose={() => setQuickProduct(null)} /></Suspense> : null}
  </>;
}
