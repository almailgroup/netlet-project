/**
 * NetLet storefront: Kuwait-focused discovery with a live product catalog,
 * persistent bag, native checkout mockup, and responsive marketplace rails.
 */
import { useBuyNow } from "@/hooks/useBuyNow";
import { Thumb } from "@/components/product/Thumb";
import { categoryRail, editorialUpdates, homeRailDefinitions, shelvesFor } from "@/content/homeLayout";
import { useFeature } from "@/hooks/useFeature";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import type { Product } from "@shared/commerce/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Store,
  Trash2,
  Truck,
  Wallet,
  Zap,
} from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { DeliveryZoneDialog } from "@/components/layout/DeliveryZoneDialog";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { QuickView } from "@/components/product/QuickView";
import { SponsoredShelf } from "@/components/product/SponsoredShelf";
import { useLocation } from "wouter";
import { appPath } from "@/lib/basePath";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { homeMeta } from "@shared/seo";
import { heroImage, logoImage } from "@/lib/brandAssets";
import { toast } from "sonner";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";







function CatalogSkeleton({ dark = false }: { dark?: boolean }) {
  return <div className="hide-scrollbar mt-5 flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((item) => <div key={item} className={`min-w-[172px] animate-pulse rounded-2xl border p-3 sm:min-w-[195px] lg:min-w-0 lg:flex-1 ${dark ? "border-[#49658d] bg-white/10" : "border-[#d5dfeb] bg-white"}`}><div className={`aspect-[1.02] rounded-xl ${dark ? "bg-white/10" : "bg-[#e7edf5]"}`} /><div className={`mt-4 h-4 w-2/3 rounded ${dark ? "bg-white/10" : "bg-[#dce5e9]"}`} /><div className={`mt-2 h-3 w-1/3 rounded ${dark ? "bg-white/10" : "bg-[#e7edf5]"}`} /></div>)}</div>;
}

/**
 * How long each image holds, and how long it takes to cross into the next.
 *
 * The two are coupled: at a 450ms fade a 900ms hold would leave the card
 * mid-transition half the time, which reads as a blur rather than as a product
 * turning. The hold is the settled time plus the fade.
 */

type RailProps = {
  id: string;
  title: MessageKey;
  description: MessageKey;
  dark?: boolean;
  products: Product[];
  catalogLoading: boolean;
  catalogError: boolean;
  saved: string[];
  onSave: (id: string, title: string) => void;
  onDetails: (product: Product) => void;
  onQuickView: (product: Product) => void;
  onAdd: (product: Product, quantity: number) => void;
  onBuyNow: (product: Product, quantity: number) => void;
  isAdding: boolean;
  onViewAll: () => void;
};

/**
 * One shelf of products, scrolled sideways.
 *
 * Its arrows used to be white icons on the light `.glass` disc — blank circles
 * on the navy shelves — and pressing them only raised "more controls will
 * arrive", the dead-control rule twice over. They scroll the shelf now, a
 * screenful at a time, and appear only when there is something off-screen to
 * reach; on a navy shelf they wear the on-dark tint so the chevron is visible.
 */
function ProductRail({ id, title, description, dark = false, products, catalogLoading, catalogError, saved, onSave, onDetails, onQuickView, onAdd, onBuyNow, isAdding, onViewAll }: RailProps) {
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

  const arrowClass = `pressable grid size-10 place-items-center rounded-full disabled:opacity-35 ${dark ? "glass glass-on-dark" : "glass border border-[#d5dfeb] text-[#0a285a]"}`;

  return (
    <section id={id} className={dark ? "bg-[#0a285a] py-9 sm:py-12" : "py-9 sm:py-12"} aria-labelledby={`${id}-title`}>
      <div className="container">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id={`${id}-title`} className={`display-face text-3xl sm:text-4xl ${dark ? "text-white" : "text-[#0a285a]"}`}>{railTitle}</h2>
            <p className={`mt-1 text-xs ${dark ? "text-[#b9cce5]" : "text-[#536b8c]"}`}>{t(description)}</p>
          </div>
          <div className="flex items-center gap-2">
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
            <button onClick={onViewAll} className={`pressable rounded-full px-3.5 py-2 text-[10px] font-extrabold tracking-[.08em] uppercase ${dark ? "bg-white/10 text-white hover:bg-white/20" : "border border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#e7edf5]"}`}>{t("home.viewAll")}</button>
          </div>
        </div>
        {catalogLoading ? <CatalogSkeleton dark={dark} /> : catalogError ? (
          <div className={`mt-5 rounded-2xl border px-6 py-10 text-center ${dark ? "border-[#49658d] bg-white/5 text-white" : "border-[#f2b69e] bg-white text-[#0a285a]"}`}><p className="text-sm font-bold">{t("home.catalogSlow")}</p></div>
        ) : railProducts.length ? (
          <div ref={trackRef} className="hide-scrollbar mt-5 flex snap-x gap-3 overflow-x-auto scroll-smooth pb-1">
            {railProducts.map((product) => (
              /* Four to a row from lg up, whatever the container's width, so a shelf fills its row. */
              <div key={`${id}-${product.id}`} className="w-[172px] shrink-0 snap-start sm:w-[195px] lg:w-[calc((100%-2.25rem)/4)]">
                <ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onDetails={() => onDetails(product)} onQuickView={() => onQuickView(product)} onAdd={(quantity) => void onAdd(product, quantity)} onBuyNow={(quantity) => void onBuyNow(product, quantity)} isAdding={isAdding} />
              </div>
            ))}
          </div>
        ) : (
          <div className={`mt-5 rounded-2xl border border-dashed px-6 py-10 text-center ${dark ? "border-[#49658d] bg-white/5 text-[#d9e7f7]" : "border-[#b8c9dc] bg-white/55 text-[#536b8c]"}`}><Search className="mx-auto size-5" /><p className="mt-2 text-sm font-bold">{t("home.noMatches")}</p><button onClick={onViewAll} className={`mt-3 text-xs font-extrabold underline underline-offset-4 ${dark ? "ink-accent-on-dark" : "ink-accent"}`}>{t("home.showCatalog")}</button></div>
        )}
      </div>
    </section>
  );
}

/**
 * Category rail: the departments, as pictures, directly under the hero.
 *
 * This replaces a panel of availability radios and a sort dropdown. Those are
 * refinements — they answer "narrow what I am already looking at" — and putting
 * them in the first screen asked a shopper who had just arrived to operate a
 * filter before they had seen a single product. A marketplace opens with
 * departments, and departments are easier to recognise than to read.
 *
 * The artwork is the catalog's own: each tile borrows the first image of the
 * first product in that department, so the rail illustrates itself and keeps
 * illustrating itself as the merchant's catalog changes. A department with no
 * products yet falls back to its brand colour rather than to a broken tile.
 *
 * Departments come from `categoryRail` — which carries the Arabic labels — plus
 * any product type in the live catalog that is not one of them, so a merchant
 * adding a department is not hidden by a hard-coded list.
 */
function CategoryRail({ categories, onSelect }: {
  categories: { query: string; label: string; color: string; image?: string }[];
  onSelect: (category: string) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // Arrows only when there is something off-screen to reach. Watched rather
  // than measured once: the rail fills in as the catalog arrives, and it
  // reflows on rotate.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setOverflowing(track.scrollWidth - track.clientWidth > 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [categories.length]);

  // Roughly one screenful, so a click advances the rail rather than nudging it.
  const scrollBy = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  const arrow = "pressable absolute top-[calc(1.5rem+58px)] z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-[#e2e5eb] bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:border-[#aac0da] lg:grid";

  return (
    <section id="departments" className="container relative pt-5 sm:pt-6" aria-label={t("home.shopByCategory")}>
      {overflowing ? (
        <>
          {/* Placed against the container edge rather than the track, so the
              arrows sit over the fade instead of stealing a tile's width. */}
          <button onClick={() => scrollBy(-1)} aria-label={t("home.scrollBack")} className={`${arrow} start-1`}>
            <ChevronLeft className="size-5 rtl:-scale-x-100" />
          </button>
          <button onClick={() => scrollBy(1)} aria-label={t("home.scrollForward")} className={`${arrow} end-1`}>
            <ChevronRight className="size-5 rtl:-scale-x-100" />
          </button>
        </>
      ) : null}

      <div ref={trackRef} className={`hide-scrollbar flex gap-3 overflow-x-auto scroll-smooth pb-1 sm:gap-5 lg:px-8 ${overflowing ? "" : "justify-center"}`}>
        {categories.map((category) => (
          <button
            key={category.query}
            onClick={() => onSelect(category.query)}
            className="group flex w-[84px] shrink-0 flex-col items-center gap-2 sm:w-[116px]"
          >
            <span
              className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl border border-[#e6e9ef] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-[#aac0da] group-hover:shadow-[0_10px_22px_rgba(10,40,90,.12)]"
              /* The department's own colour is the ground whether or not the
                 picture arrives, so a dead image URL costs the tile its
                 artwork and not its identity. */
              style={{ backgroundColor: category.color }}
            >
              {/* Before this every department with no product yet fell back to
                  the same package glyph, so the tiles a new catalog actually
                  shows were identical but for their tint. The department's own
                  icon is what makes an empty shelf still recognisable. */}
              <Thumb
                src={category.image}
                alt=""
                className="size-full object-contain p-2.5"
                icon={<DepartmentIcon query={category.query} className="size-7 text-[#0a285a]/70" />}
                fallbackClassName="bg-transparent"
              />
            </span>
            <span className="line-clamp-2 text-center text-[11px] font-bold leading-[1.25] text-[#0a285a] group-hover:text-[#a44a2b] sm:text-xs">
              {category.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}


export default function Home() {
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  // One dialog for the whole page: three rails and the deals surface all open
  // the same overlay, the way the drawer is mounted once in `App`.
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [, navigate] = useLocation();
  usePageMeta(homeMeta(SITE_URL));
  const { isArabic, t } = useTranslation();
  const [search, setSearch] = useState("");
  const { addItem, loading: cartLoading } = useCart();
  const { savedIds: saved, toggleSaved: togglePersistentSaved, deliveryZone } = useCustomer();
  const { data: catalog = [], isLoading: catalogLoading, error: catalogError, refetch } = trpc.commerce.products.list.useQuery({ first: 24 });

  /* The header search goes to the results page on Enter; the shelves are the shop's, not the search's. */
  const shelves = useMemo(() => shelvesFor(catalog), [catalog]);
  const articlesOn = useFeature("articles");
  const appBannerOn = useFeature("appBanner");
  const liveCategories = useMemo(() => Array.from(new Set(catalog.map((product) => product.productType).filter((productType): productType is string => Boolean(productType)))).sort((left, right) => left.localeCompare(right)), [catalog]);

  /**
   * The tiles under the hero: the six named departments first, in their
   * defined order, then any product type the merchant has added that is not
   * one of them — so a new department appears in the rail rather than being
   * hidden behind a hard-coded list.
   *
   * Each tile borrows the first image of the first product in its department.
   * "All departments" takes the catalog's first image, since it stands for the
   * whole of it. A department with nothing in it yet keeps its brand colour.
   */
  const departmentTiles = useMemo(() => {
    const firstImage = (query: string) =>
      (query === "All"
        ? catalog[0]
        : catalog.find((product) => product.productType === query || product.tags.includes(query))
      )?.images[0]?.url;

    const named = categoryRail.map((category) => ({
      query: category.query as string,
      label: t(category.key),
      color: category.color,
      image: firstImage(category.query),
    }));

    const knownQueries = new Set<string>(categoryRail.map((category) => category.query));
    const extra = liveCategories
      .filter((productType) => !knownQueries.has(productType))
      .map((productType) => ({
        query: productType,
        // Merchant-entered, so it is shown as typed rather than translated.
        label: productType,
        color: "#e7edf5",
        image: firstImage(productType),
      }));

    return [...named, ...extra];
  }, [catalog, liveCategories, t]);
  // Departments lead to the listing page rather than scrolling this one. A
  // rail of four products was a teaser; the shopper asking for "Electronics"
  // wants the department, with everything in it and a way to narrow it.
  const selectCategory = (category: string) => navigate(`/category/${categorySlug(category)}`);
  const showAll = () => navigate("/category/all");
  const toggleSaved = (id: string, title: string) => { const isSaved = saved.includes(id); togglePersistentSaved(id); toast(t(isSaved ? "saved.removed" : "saved.savedForLater", { name: title })); };
  const addProduct = async (product: Product, quantity = 1) => { const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0]; if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable")); try { await addItem(variant.id, quantity); toast.success(quantity > 1 ? t("cart.addedQuantity", { count: String(quantity), name: product.title }) : t("cart.added", { name: product.title })); } catch { toast.error(t("cart.addFailed")); } };
  // Buy now is add-to-cart plus the checkout step, not a separate path (3.2.9).
  const buyProduct = useBuyNow();
  const openProduct = (product: Product) => window.location.assign(appPath(`/products/${encodeURIComponent(product.handle)}`));

  return <main id="top" className="min-h-screen bg-background text-[#0a285a]">
    {/* The one header every shopping page wears (`StoreHeader`). Home kept
        its own for a long time — taller, labelled, with the departments and
        the area — and the two drifted apart while every other page went
        without the area and the departments entirely. */}
    <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openProduct} />


    {/* Hero, at roughly half its previous height so the first row of products
        is on screen when the page opens. The panel carries the colour now that
        the page ground is a near-white neutral: a deep navy field lifted toward
        an electric blue, a brand-orange bloom on the warm side and a cool one
        opposite so the warmth reads as deliberate rather than as a cast. */}
    <section id="main" className="container pt-5 sm:pt-6"><div className="relative isolate min-h-[200px] overflow-hidden rounded-[1.5rem] bg-[#06162f] lg:min-h-[248px]"><div className="absolute inset-0 bg-[linear-gradient(105deg,#06162f_0%,#0a285a_44%,#14428f_78%,#1c58b8_100%)]" /><div className="absolute -end-16 -top-32 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(242,104,58,.52)_0%,rgba(242,104,58,0)_65%)]" /><div className="absolute -bottom-40 start-[36%] size-[380px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,.34)_0%,rgba(56,189,248,0)_68%)]" /><img src={heroImage} alt="" aria-hidden loading="eager" fetchPriority="high" decoding="async" className="pointer-events-none absolute inset-y-0 end-0 hidden h-full w-[46%] object-cover opacity-30 [mask-image:linear-gradient(to_right,transparent,#000_58%)] rtl:[mask-image:linear-gradient(to_left,transparent,#000_58%)] lg:block" /><div className="absolute inset-0 bg-[linear-gradient(90deg,#06162f_0%,rgba(6,22,47,.62)_44%,rgba(6,22,47,0)_74%)] rtl:bg-[linear-gradient(270deg,#06162f_0%,rgba(6,22,47,.62)_44%,rgba(6,22,47,0)_74%)]" /><div className="relative z-10 flex min-h-[200px] max-w-[640px] flex-col justify-center px-6 py-7 sm:px-10 lg:min-h-[248px] lg:px-12"><div className="reveal-up flex items-center gap-2"><span className="h-px w-6 bg-[#ff8a5c]" /><span className="text-[10px] font-extrabold tracking-[0.17em] text-[#ffb495] uppercase">{t("home.eyebrow")}</span></div><h1 className="reveal-up reveal-delay-1 display-face mt-2.5 text-[2rem] leading-[.98] text-white sm:text-[2.5rem] lg:text-[3rem]">{t("home.heroTitle")} <em className="font-normal text-[#9fc6ff]">{t("home.heroTitleEm")}</em></h1><div className="reveal-up reveal-delay-2 mt-4 flex flex-wrap items-center gap-2.5"><button onClick={showAll} className="glass glass-accent pressable flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold">{t("home.shopCatalog")} <ArrowRight className="size-4 rtl:-scale-x-100" /></button>{/* Only while the Deals shelf is drawn: it hides below four offers, and a
        button scrolling to a shelf that is not there does nothing. */}{shelves.deals.length ? <button onClick={() => document.getElementById("deals")?.scrollIntoView({ behavior: "smooth" })} className="glass glass-on-dark pressable rounded-full px-5 py-3 text-xs font-extrabold">{t("home.exploreDeals")}</button> : null}</div><div className="mt-4 hidden flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-bold text-[#a9c6ec] lg:flex"><span className="flex items-center gap-1.5"><Truck className="size-3.5 text-[#ff9a70]" /> {deliveryZone ? t("delivery.selected", { name: isArabic ? deliveryZone.labelAr : deliveryZone.label }) : t("home.chooseArea")}</span><span className="flex items-center gap-1.5"><Wallet className="size-3.5 text-[#ff9a70]" /> {t("home.payOnDelivery")}</span><span className="flex items-center gap-1.5"><RotateCcw className="size-3.5 text-[#ff9a70]" /> {t("home.returnsWithin", { days: RETURN_WINDOW_DAYS })}</span></div></div><div className="glass glass-on-dark absolute end-4 top-4 rounded-full px-3 py-1.5 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.newSeason")}</div></div></section>

    <CategoryRail categories={departmentTiles} onSelect={selectCategory} />


    {/* Paid placements (3.3.15), on a shelf of their own and labelled. */}
    <SponsoredShelf
      slot="home"
      layout="rail"
      saved={saved}
      onSave={product => toggleSaved(product.id, product.title)}
      onDetails={openProduct}
      onQuickView={setQuickProduct}
      onAdd={(product, quantity) => void addProduct(product, quantity)}
      onBuyNow={(product, quantity) => void buyProduct(product, quantity)}
      isAdding={cartLoading}
    />

    {/* Two shelves, each hidden below four products (`shelvesFor`). While the
        catalog loads the first draws its skeleton, so the page does not jump. */}
    {homeRailDefinitions.map((rail, index) => {
      const products = shelves[rail.id];
      if (!catalogLoading && !catalogError && products.length === 0) return null;
      if ((catalogLoading || catalogError) && index > 0) return null;
      return <ProductRail key={rail.id} id={rail.id} title={rail.title} description={rail.description} dark={rail.treatment === "navy"} products={products} catalogLoading={catalogLoading} catalogError={Boolean(catalogError)} saved={saved} onSave={toggleSaved} onDetails={openProduct} onQuickView={setQuickProduct} onAdd={addProduct} onBuyNow={buyProduct} isAdding={cartLoading} onViewAll={() => navigate(rail.select === "offers" ? "/category/all?offer=1&sort=discount" : "/category/all?sort=newest")} />;
    })}



    {articlesOn ? (
      <section className="border-y border-[#d5dfeb] bg-white/45 py-10 sm:py-14"><div className="container"><div className="flex items-end justify-between gap-5"><div><p className="text-[10px] font-extrabold tracking-[.16em] text-[#a44a2b] uppercase">{t("home.notesFrom")}</p><h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">{t("home.usefulReading")}</h2></div><button onClick={() => toast(t("home.editorialSoon"))} className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("home.viewAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div><div className="mt-6 grid gap-3 md:grid-cols-3">{editorialUpdates.map((entry) => <article key={entry.title} className="rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] p-6"><p className="text-[9px] font-extrabold tracking-[.14em] ink-accent uppercase">{t(entry.date)}</p><h3 className="type-heading mt-4 text-lg tracking-[-.025em] text-[#0a285a]">{t(entry.title)}</h3><p className="type-body mt-3 text-sm leading-6 text-[#536b8c]">{t(entry.summary)}</p><button onClick={() => toast(t("home.guideSoon"))} className="mt-5 inline-flex items-center gap-1 text-[10px] font-extrabold tracking-[.1em] text-[#0a285a] uppercase">{t("home.readMore")} <ArrowRight className="size-3.5 ink-accent rtl:-scale-x-100" /></button></article>)}</div></div></section>
    ) : null}

    <section className={`container grid gap-4 py-10 sm:py-14 ${appBannerOn ? "lg:grid-cols-2" : ""}`}>{appBannerOn ? <div className="relative overflow-hidden rounded-[1.5rem] bg-[#fffdf9] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -bottom-16 end-5 size-56 rounded-t-[3rem] bg-[#0a285a]" /><div className="absolute bottom-0 end-12 h-[215px] w-[116px] rounded-t-[1.5rem] border-[7px] border-[#0a285a] bg-white shadow-[0_18px_35px_rgba(10,40,90,.18)]"><img src={logoImage} alt="NetLet" loading="lazy" decoding="async" className="absolute left-1/2 top-[45%] w-16 -translate-x-1/2" /></div><div className="relative z-10 max-w-[55%]"><p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("home.application")}</p><h2 className="display-face mt-3 text-3xl leading-[.94] text-[#0a285a]">{t("home.appTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.appNote")}</p><button onClick={() => toast(t("home.appSoon"))} className="glass glass-navy pressable mt-6 rounded-full px-4 py-3 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.appUpdates")}</button></div></div> : null}<div className="relative overflow-hidden rounded-[1.5rem] bg-[#e7edf5] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -end-14 -top-14 size-72 rounded-full border-[28px] border-[#d1e3d0]" /><div className="absolute bottom-7 end-9 grid size-16 place-items-center rounded-2xl bg-[#fff0ab] text-[#0a285a] shadow-lg"><MapPin className="size-7" /></div><div className="relative z-10 max-w-[60%]"><p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("delivery.kuwait")}</p><h2 className="display-face mt-3 text-3xl leading-[.94] text-[#0a285a]">{t("home.deliveryTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.deliveryNote")}</p><button onClick={() => setDeliveryOpen(true)} className="glass glass-accent pressable mt-6 inline-flex items-center gap-2 rounded-full px-4 py-3 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.chooseDeliveryArea")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div></div></section>



    <SiteFooter />

    <MobileTabBar />
    <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    <DeliveryZoneDialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />
  </main>;
}
