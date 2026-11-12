/**
 * The home page: the front door (`HomeHero`), the departments as cards, the
 * paid placements, and then the shelves in the order the owner asked for —
 * Mega deals as a navy band led by the deepest saving, the deals picked for
 * the shopper, the deals for everybody, Picked for you, Trending, Bestsellers
 * ranked, what this device looked at before, the new arrivals as a grid, the
 * newest guides — and the footer. Every shelf after the departments is drawn
 * only when it has something true to show; most carry a row of department
 * tabs (`TabbedShelf`), and the seasons and occasions whose shopping is on
 * today sit after Picked for you, from the products the stores tagged for
 * them (`OccasionBand`). The brands and the stores are at the top of
 * `/categories` now, on the owner's word.
 */
import { toastHeart } from "@/lib/heartToast";
import { useCatalog } from "@/hooks/useCatalog";
import { HEADER_SHELF } from "@/lib/routeData";
import { homeRailDefinitions, shelvesFor, type HomeShelfId } from "@/content/homeLayout";
import { useFeature } from "@/hooks/useFeature";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import type { Product } from "@shared/commerce/types";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";
import { DepartmentCards } from "@/components/home/DepartmentCards";
import { HomeBanners } from "@/components/home/HomeBanners";
import { HomeHero } from "@/components/home/HomeHero";
import { GuideShelf } from "@/components/home/GuideShelf";
import { DEALS_PATH, DealsBand, OccasionBand, TabbedShelf } from "@/components/home/ProductShelf";
import { RecentlyViewedRail } from "@/components/home/RecentlyViewedRail";
import { Later } from "@/components/layout/Later";
import { RecommendedRail } from "@/components/product/RecommendedRail";
import { useLocation } from "wouter";

/* Fetched on the first preview, not with the page: most visits open none. */
const QuickView = lazy(() => import("@/components/product/QuickView").then(module => ({ default: module.QuickView })));
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { homeMeta } from "@shared/seo";
import { logoImage } from "@/lib/brandAssets";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";

/* One empty list, so "nothing yet" is the same value from render to render. */
const NO_PRODUCTS: Product[] = [];

export default function Home() {
  // One dialog for the whole page: every shelf and the deals band open the
  // same overlay, the way the drawer is mounted once in `App`.
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
  const failed = Boolean(catalogError);
  const ready = !catalogLoading && !failed;
  /* The two shelves the server counts: what sold over ninety days, and what
     was reached for this week. */
  const bestsellers = trpc.commerce.bestsellers.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });
  const trending = trpc.commerce.trending.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });

  /* The header search goes to the results page on Enter; the shelves are the shop's, not the search's. */
  /* NetLet's own occasions running today (`occasions.live`), and the calendar's it took over or switched off. */
  const occasions = trpc.occasions.live.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });
  const shelves = useMemo(
    () => shelvesFor(catalog, bestsellers.data ?? [], trending.data ?? [], new Date(), occasions.data),
    [catalog, bestsellers.data, trending.data, occasions.data],
  );
  const articlesOn = useFeature("articles");
  const appBannerOn = useFeature("appBanner");

  const toggleSaved = (id: string, title: string) => toastHeart(togglePersistentSaved(id), title, t);
  const cards = { saved, onSave: toggleSaved, onQuickView: setQuickProduct };

  /* One of the computed shelves, as `homeRailDefinitions` describes it, or
     nothing while it has nothing true to show. */
  const shelf = (id: HomeShelfId) => {
    const rail = homeRailDefinitions.find(entry => entry.id === id);
    const products = shelves[id];
    if (!rail || !ready || products.length === 0) return null;
    const onViewAll = rail.select === "offers" ? () => navigate(DEALS_PATH)
      : rail.select === "newest" ? () => navigate("/category/all?sort=newest")
      : undefined;
    if (rail.layout === "band") return <DealsBand id={id} title={rail.title} products={products} {...cards} />;
    return <TabbedShelf id={id} title={rail.title} products={products} layout={rail.layout} ranked={id === "bestsellers"} onViewAll={onViewAll} {...cards} />;
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

      {/* While the catalog loads, one shelf's outline stands where the deals
          will be, so the page does not jump; failed, it is the one line. */}
      {!ready ? <TabbedShelf id="deals" title="rail.deals.title" products={NO_PRODUCTS} layout="rail" tabs={false} loading={catalogLoading} failed={failed} {...cards} /> : null}

      {/* The shelves, in the owner's order (`shelvesFor`): each computed one
          leaves out what a shelf above shows, and the two personal rails and
          Previously viewed keep their own rule. */}
      {shelf("mega")}
      <RecommendedRail deals quiet {...cards} />
      {shelf("deals")}
      <RecommendedRail quiet {...cards} />
      {/* The seasons and the occasions whose shopping is on today: NetLet's
          own first, then the calendar's from the products the stores tagged.
          Not before NetLet's answer is in: the calendar's Halloween drawn for
          a moment over one NetLet switched off would be a band that flashes. */}
      {ready && !occasions.isLoading ? shelves.occasions.map(entry => <OccasionBand key={entry.slug} shelf={entry} {...cards} />) : null}
      {shelf("trending")}
      {shelf("bestsellers")}
      <RecentlyViewedRail {...cards} />
      {shelf("newest")}
      {articlesOn ? <GuideShelf /> : null}
    </Later>

    {/* Switched off until there is an app to download (2.3). */}
    {appBannerOn ? <section className="container pb-10"><div className="relative overflow-hidden rounded-[1.5rem] bg-[#fffdf9] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -bottom-16 end-5 size-56 rounded-t-[3rem] bg-[#0a285a]" /><div className="absolute bottom-0 end-12 h-[215px] w-[116px] rounded-t-[1.5rem] border-[7px] border-[#0a285a] bg-white shadow-[0_18px_35px_rgba(10,40,90,.18)]"><img src={logoImage} alt="NetLet" loading="lazy" decoding="async" className="absolute left-1/2 top-[45%] w-16 -translate-x-1/2" /></div><div className="relative z-10 max-w-[55%]"><p className="text-[12px] font-semibold text-[#a44a2b]">{t("home.application")}</p><h2 className="font-extrabold mt-3 text-2xl text-[#0a285a]">{t("home.appTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.appNote")}</p><button onClick={() => toast(t("home.appSoon"))} className="glass glass-navy pressable mt-6 rounded-full px-4 py-3 text-[12px] font-semibold">{t("home.appUpdates")}</button></div></div></section> : null}

    {quickProduct ? <Suspense fallback={null}><QuickView product={quickProduct} onClose={() => setQuickProduct(null)} /></Suspense> : null}
  </>;
}
