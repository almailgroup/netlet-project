/**
 * The home page: the departments as cards, a Deals shelf, the new arrivals as
 * a grid, what shopping with NetLet involves, and the footer.
 */
import { editorialUpdates, homeRailDefinitions, shelvesFor } from "@/content/homeLayout";
import { useFeature } from "@/hooks/useFeature";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import type { Product } from "@shared/commerce/types";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  RotateCcw,
  Truck,
  Wallet,
} from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { DepartmentCards } from "@/components/home/DepartmentCards";
import { Link, useLocation } from "wouter";

/* Fetched on the first preview, not with the page: most visits open none. */
const QuickView = lazy(() => import("@/components/product/QuickView").then(module => ({ default: module.QuickView })));
import { StoreHeader } from "@/components/layout/StoreHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
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
  onViewAll: () => void;
};

/**
 * A shelf's title and its way to everything else. A plain heading and a "View
 * all" link: the shelves used to carry a display-face headline, a sentence of
 * description under it and an uppercase pill, which is three ways of saying
 * the title.
 */
function ShelfHeading({ id, title, onViewAll, children }: { id: string; title: string; onViewAll: () => void; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 id={`${id}-title`} className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        <button onClick={onViewAll} className="pressable inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm font-bold ink-accent hover:underline">
          {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * One shelf of products, scrolled sideways. The arrows scroll it a screenful at
 * a time and appear only when there is something off-screen to reach.
 */
function ProductRail({ id, title, products, catalogLoading, catalogError, saved, onSave, onQuickView, onViewAll }: RailProps) {
  const { t } = useTranslation();
  const railProducts = products.slice(0, 12);
  const railTitle = t(title);
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    /* scrollLeft runs negative in a right-to-left page, so measure the distance from each end. */
    const measure = () => {
      const travelled = Math.abs(track.scrollLeft);
      const room = track.scrollWidth - track.clientWidth;
      setEdges({ back: travelled > 4, forward: room - travelled > 4 });
    };
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => { track.removeEventListener("scroll", measure); observer.disconnect(); };
  }, [railProducts.length, catalogLoading]);

  const scrollBy = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const rtl = getComputedStyle(track).direction === "rtl";
    track.scrollBy({ left: (rtl ? -direction : direction) * Math.round(track.clientWidth * 0.9), behavior: "smooth" });
  };

  const arrowClass = "glass pressable grid size-9 place-items-center rounded-full text-[#0a285a] disabled:opacity-35";

  return (
    <section id={id} className="py-6 sm:py-8" aria-labelledby={`${id}-title`}>
      <div className="container">
        <ShelfHeading id={id} title={railTitle} onViewAll={onViewAll}>
          {edges.back || edges.forward ? (
            <div className="hidden items-center gap-2 sm:flex">
              <button type="button" onClick={() => scrollBy(-1)} disabled={!edges.back} aria-label={t("home.previousProducts", { title: railTitle })} title={t("home.previousProducts", { title: railTitle })} className={arrowClass}>
                <ChevronLeft className="size-4 rtl:-scale-x-100" />
              </button>
              <button type="button" onClick={() => scrollBy(1)} disabled={!edges.forward} aria-label={t("home.nextProducts", { title: railTitle })} title={t("home.nextProducts", { title: railTitle })} className={arrowClass}>
                <ChevronRight className="size-4 rtl:-scale-x-100" />
              </button>
            </div>
          ) : null}
        </ShelfHeading>
        {catalogLoading ? <CatalogSkeleton /> : catalogError ? (
          <div className="mt-4 rounded-2xl border border-[#f2b69e] bg-white px-6 py-10 text-center text-[#0a285a]"><p className="text-sm font-bold">{t("home.catalogSlow")}</p></div>
        ) : (
          <div ref={trackRef} className="hide-scrollbar mt-4 flex snap-x gap-3 overflow-x-auto scroll-smooth pb-1">
            {railProducts.map((product) => (
              /* Four to a row from lg up, whatever the container's width, so a shelf fills its row. */
              <div key={`${id}-${product.id}`} className="w-[164px] shrink-0 snap-start sm:w-[195px] lg:w-[calc((100%-2.25rem)/4)]">
                <ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onQuickView={() => onQuickView(product)} />
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
 * What a shopper wants to know before the first order, in four lines that are
 * all true today: where NetLet delivers, how paying works, the return window,
 * and where to ask. It replaces a card with a ring, a pin on a yellow tile and
 * a slogan ("NetLet, nearer to you.") whose one button the header now carries.
 */
function DeliveryStrip() {
  const { t } = useTranslation();
  const item = "flex items-center gap-3 rounded-2xl bg-white p-4";
  const icon = "grid size-10 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]";
  return (
    <section className="container py-6 sm:py-8" aria-label={t("home.howItWorks")}>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <li className={item}><span className={icon}><Truck className="size-5" aria-hidden /></span><span className="text-sm font-bold text-[#0a285a]">{t("checkout.builtForKuwait")}</span></li>
        <li className={item}><span className={icon}><Wallet className="size-5" aria-hidden /></span><span className="text-sm font-bold text-[#0a285a]">{t("home.payOnDelivery")}</span></li>
        <li className={item}><span className={icon}><RotateCcw className="size-5" aria-hidden /></span><span className="text-sm font-bold text-[#0a285a]">{t("home.returnsWithin", { days: RETURN_WINDOW_DAYS })}</span></li>
        <li>
          <Link href="/account#help" className={`${item} h-full hover:bg-[#f7f9fc]`}>
            <span className={icon}><LifeBuoy className="size-5" aria-hidden /></span>
            <span className="text-sm font-bold text-[#0a285a]">{t("support.section")}</span>
            <ChevronRight className="ms-auto size-4 text-[#536b8c] rtl:-scale-x-100" aria-hidden />
          </Link>
        </li>
      </ul>
    </section>
  );
}

export default function Home() {
  // One dialog for the whole page: three rails and the deals surface all open
  // the same overlay, the way the drawer is mounted once in `App`.
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [, navigate] = useLocation();
  usePageMeta(homeMeta(SITE_URL));
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { savedIds: saved, toggleSaved: togglePersistentSaved } = useCustomer();
  const { data: catalog = [], isLoading: catalogLoading, error: catalogError } = trpc.commerce.products.list.useQuery({ first: 24 });

  /* The header search goes to the results page on Enter; the shelves are the shop's, not the search's. */
  const shelves = useMemo(() => shelvesFor(catalog), [catalog]);
  const articlesOn = useFeature("articles");
  const appBannerOn = useFeature("appBanner");

  const toggleSaved = (id: string, title: string) => { const isSaved = saved.includes(id); togglePersistentSaved(id); toast(t(isSaved ? "saved.removed" : "saved.savedForLater", { name: title })); };
  const openProduct = (product: Product) => navigate(`/products/${encodeURIComponent(product.handle)}`);

  return <main id="top" className="flex min-h-screen flex-col bg-background text-[#0a285a]">
    {/* The one header every shopping page wears (`StoreHeader`). Home kept
        its own for a long time — taller, labelled, with the departments and
        the area — and the two drifted apart while every other page went
        without the area and the departments entirely. */}
    <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openProduct} />


    {/* The page's name for a screen reader's outline. The banner that used
        to carry the h1 was a slogan; the shop's name is what the page is. */}
    <h1 className="sr-only">{t("home.heading")}</h1>

    {/* The departments, as big cards, where a slogan used to be. */}
    <DepartmentCards />

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
    {homeRailDefinitions.map((rail, index) => {
      const products = shelves[rail.id];
      if (!catalogLoading && !catalogError && products.length === 0) return null;
      if ((catalogLoading || catalogError) && index > 0) return null;
      const viewAll = () => navigate(rail.select === "offers" ? "/category/all?offer=1&sort=discount" : "/category/all?sort=newest");
      const shared = { id: rail.id, title: rail.title, products, catalogLoading, catalogError: Boolean(catalogError), saved, onSave: toggleSaved, onQuickView: setQuickProduct, onViewAll: viewAll };
      /* A shelf scrolls sideways; the new arrivals are a grid, so the page
         ends on products laid out to browse rather than on a second strip. */
      return rail.layout === "grid" ? <ProductGrid key={rail.id} {...shared} /> : <ProductRail key={rail.id} {...shared} />;
    })}

    {articlesOn ? (
      <section className="border-y border-[#d5dfeb] bg-white/45 py-10 sm:py-14"><div className="container"><div className="flex items-end justify-between gap-5"><div><p className="text-[12px] font-semibold text-[#a44a2b]">{t("home.notesFrom")}</p><h2 className="font-extrabold mt-1 text-2xl text-[#0a285a] sm:text-4xl">{t("home.usefulReading")}</h2></div><button onClick={() => toast(t("home.editorialSoon"))} className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("home.viewAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div><div className="mt-6 grid gap-3 md:grid-cols-3">{editorialUpdates.map((entry) => <article key={entry.title} className="rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] p-6"><p className="text-[12px] font-semibold ink-accent">{t(entry.date)}</p><h3 className="type-heading mt-4 text-lg tracking-[-.025em] text-[#0a285a]">{t(entry.title)}</h3><p className="type-body mt-3 text-sm leading-6 text-[#536b8c]">{t(entry.summary)}</p><button onClick={() => toast(t("home.guideSoon"))} className="mt-5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0a285a]">{t("home.readMore")} <ArrowRight className="size-3.5 ink-accent rtl:-scale-x-100" /></button></article>)}</div></div></section>
    ) : null}

    <DeliveryStrip />

    {/* Switched off until there is an app to download (2.3). */}
    {appBannerOn ? <section className="container pb-10"><div className="relative overflow-hidden rounded-[1.5rem] bg-[#fffdf9] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -bottom-16 end-5 size-56 rounded-t-[3rem] bg-[#0a285a]" /><div className="absolute bottom-0 end-12 h-[215px] w-[116px] rounded-t-[1.5rem] border-[7px] border-[#0a285a] bg-white shadow-[0_18px_35px_rgba(10,40,90,.18)]"><img src={logoImage} alt="NetLet" loading="lazy" decoding="async" className="absolute left-1/2 top-[45%] w-16 -translate-x-1/2" /></div><div className="relative z-10 max-w-[55%]"><p className="text-[12px] font-semibold text-[#a44a2b]">{t("home.application")}</p><h2 className="font-extrabold mt-3 text-2xl text-[#0a285a]">{t("home.appTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.appNote")}</p><button onClick={() => toast(t("home.appSoon"))} className="glass glass-navy pressable mt-6 rounded-full px-4 py-3 text-[12px] font-semibold">{t("home.appUpdates")}</button></div></div></section> : null}

    <SiteFooter />

    <MobileTabBar />
    {quickProduct ? <Suspense fallback={null}><QuickView product={quickProduct} onClose={() => setQuickProduct(null)} /></Suspense> : null}
  </main>;
}
