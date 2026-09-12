/**
 * NetLet storefront: Kuwait-focused discovery with a live product catalog,
 * persistent bag, native checkout mockup, and responsive marketplace rails.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { LiveSearch } from "@/components/LiveSearch";
import { categoryRail, editorialUpdates, footerGroups, homeRailDefinitions, railSupportCardContent } from "@/content/homeLayout";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import AuthDialog from "@/components/AuthDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DEMO_MODE } from "@/lib/demoMode";
import { trpc } from "@/lib/trpc";
import { filterAndSortCatalog } from "@shared/commerce/catalog";
import { categorySlug } from "@shared/commerce/browse";
import type { Product } from "@shared/commerce/types";
import { kuwaitDeliveryZones } from "@shared/customer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  Apple,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Heart,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Play,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Share2,
  Sparkles,
  Store,
  Trash2,
  Truck,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useCompactHeader } from "@/hooks/useCompactHeader";
import { useOverlay } from "@/lib/useOverlay";
import { ProductCard } from "@/components/ProductCard";
import { MobileTabBar } from "@/components/MobileTabBar";
import { useLocation } from "wouter";
import { appPath } from "@/lib/basePath";
import { SITE_URL, usePageMeta } from "@/lib/usePageMeta";
import { homeMeta } from "@shared/seo";
import { collectionImages, footerLogoImage, heroImage, logoImage, qrImage } from "@/lib/brandAssets";
import { toast } from "sonner";
import { useMoney, useTranslation, type Translate } from "@/lib/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

const railSupportImages = [collectionImages[1], collectionImages[0], collectionImages[2]];
const railSupportCards = railSupportCardContent.map((card, index) => ({ ...card, image: railSupportImages[index] }));

function Logo({ t }: { t: Translate }) {
  return <a href="#top" className="flex shrink-0 items-center" aria-label={t("header.home")}><img src={logoImage} alt="NetLet" className="h-11 w-auto max-w-[140px] object-contain" /></a>;
}

function FooterLogo({ t }: { t: Translate }) {
  return <a href="#top" className="flex w-fit items-center" aria-label={t("header.home")}><img src={footerLogoImage} alt="NetLet" className="h-12 w-auto max-w-[165px] object-contain" /></a>;
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <button aria-label={label} title={label} onClick={onClick} className={`glass pressable grid size-10 place-items-center rounded-full ${className}`}>{children}</button>;
}

/**
 * Header control in the marketplace convention: an icon, then a stacked
 * caption/value pair that collapses to the icon alone on narrower viewports.
 */
function HeaderAction({ icon, caption, value, onClick, label, badge, tone = "quiet" }: { icon: React.ReactNode; caption: string; value: string; onClick: () => void; label: string; badge?: number; tone?: "quiet" | "primary" }) {
  return <button onClick={onClick} aria-label={label} title={label} className={`pressable flex h-12 shrink-0 items-center rounded-2xl px-3 ${badge !== undefined ? "gap-3.5" : "gap-2.5"} ${tone === "primary" ? "glass glass-navy" : "glass"}`}>
    <span className="relative grid shrink-0 place-items-center">{icon}{badge !== undefined && <span className="absolute -end-2 -top-2.5 grid min-w-4 place-items-center rounded-full bg-[#f2683a] px-1 text-[9px] font-extrabold text-white">{badge}</span>}</span>
    <span className="hidden max-w-[128px] text-start leading-[1.15] xl:block">
      <span dir="auto" className={`block truncate text-[10px] font-semibold ${tone === "primary" ? "text-white" : "text-[#536b8c]"}`}>{caption}</span>
      <span className="block truncate text-xs font-extrabold">{value}</span>
    </span>
  </button>;
}

/**
 * App-download header action with a QR panel on hover.
 *
 * Opens on focus as well as hover, so the panel is reachable from the keyboard
 * rather than being mouse-only. `invisible` (not `opacity-0` alone) keeps it out
 * of the accessibility tree while closed.
 *
 * The QR is a placeholder: a structurally convincing pattern that decodes to
 * nothing, so it cannot resolve anywhere unintended before the real code is
 * dropped in at client/public/brand/qr-placeholder.svg.
 */
function AppDownloadAction({ t }: { t: Translate }) {
  const pending = (store: string) => toast(t("header.storeSoon", { store }), { description: t("header.appNotPublished") });
  return <div className="group relative">
    <HeaderAction label={t("header.downloadFull")} onClick={() => toast(t("header.scanQrNote"))} icon={<QrCode className="size-[19px] ink-accent" />} caption={t("header.downloadCaption")} value={t("header.downloadValue")} />
    <div className="invisible absolute left-1/2 top-full z-50 w-[430px] -translate-x-1/2 pt-2.5 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
      <div className="glass rounded-3xl p-5 !bg-[rgba(255,253,249,.9)] shadow-[0_20px_50px_rgba(10,40,90,.18)]">
        <div className="flex items-start gap-4">
          <img src={qrImage} alt={t("header.qrAlt")} className="size-[116px] shrink-0 rounded-2xl bg-white p-1.5" />
          <div className="min-w-0">
            <p className="type-heading text-base text-[#0a285a]">{t("header.downloadFull")}</p>
            <p className="type-label mt-1 text-[#536b8c]">{t("header.scanQr")}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => pending(t("header.appStore"))} className="glass glass-navy pressable flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[11px] font-extrabold"><Apple className="size-4" />{t("header.appStore")}</button>
              <button onClick={() => pending(t("header.googlePlay"))} className="glass glass-navy pressable flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[11px] font-extrabold"><Play className="size-4" />{t("header.googlePlay")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}


function DeliveryZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  useOverlay(open, onClose);
  if (!open) return null;
  return <div className="fixed inset-0 z-[75] flex items-end bg-[#061b3b]/35 p-3 backdrop-blur-[2px] sm:items-center sm:justify-center" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="delivery-zone-title" className="w-full max-w-lg rounded-[1.5rem] bg-background p-5 shadow-2xl sm:p-7" onClick={event => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-extrabold tracking-[.14em] text-[#a44a2b] uppercase">{t("delivery.kuwait")}</p><h2 id="delivery-zone-title" className="display-face mt-1 text-3xl text-[#0a285a]">{t("delivery.chooseGovernorate")}</h2><p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("delivery.note")}</p></div><IconButton label={t("delivery.close")} onClick={onClose}><X className="size-5" /></IconButton></div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">{kuwaitDeliveryZones.map(zone => <button key={zone.id} onClick={() => { setDeliveryZoneId(zone.id); onClose(); }} className={`pressable rounded-2xl border p-4 text-start ${deliveryZoneId === zone.id ? "border-[#f2683a] bg-[#fff7e3]" : "border-[#d5dfeb] bg-white hover:border-[#aac0da]"}`}><span className="block text-sm font-extrabold text-[#0a285a]">{isArabic ? zone.labelAr : zone.label}</span><span className="mt-1 block text-[10px] font-semibold ink-muted">{t("delivery.pending")}</span></button>)}</div>
      <p className="mt-5 flex items-start gap-2 rounded-xl bg-[#fff0ab] p-3 text-xs leading-5 text-[#705523]"><Truck className="mt-0.5 size-4 shrink-0" />{t("delivery.setupPending")}</p>
    </section>
  </div>;
}

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

type RailSupportCard = { eyebrow: MessageKey; title: MessageKey; image: string; category: string };

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
  onAdd: (product: Product) => void;
  onBuyNow: (product: Product) => void;
  isAdding: boolean;
  onViewAll: () => void;
  supportCard?: RailSupportCard;
  onSelectSupport: (category: string) => void;
};

function ProductRail({ id, title, description, dark = false, products, catalogLoading, catalogError, saved, onSave, onDetails, onAdd, onBuyNow, isAdding, onViewAll, supportCard, onSelectSupport }: RailProps) {
  const { t } = useTranslation();
  const railProducts = products.slice(0, 4);
  const railTitle = t(title);
  return <section id={id} className={dark ? "bg-[#0a285a] py-9 sm:py-12" : "py-9 sm:py-12"}><div className="container"><div className="flex items-end justify-between gap-4"><div><p className={`text-[10px] font-extrabold tracking-[.16em] uppercase ${dark ? "text-[#ffcc64]" : "text-[#a44a2b]"}`}>{t("home.liveCatalogAria")}</p><h2 className={`display-face mt-1 text-3xl sm:text-4xl ${dark ? "text-white" : "text-[#0a285a]"}`}>{railTitle}</h2><p className={`mt-1 text-xs ${dark ? "text-[#b9cce5]" : "text-[#536b8c]"}`}>{t(description)}</p></div><div className="hidden items-center gap-2 sm:flex"><IconButton label={t("home.previousProducts", { title: railTitle })} onClick={() => toast(t("home.moreControlsSoon"))} className={dark ? "border border-[#49658d] text-white hover:bg-white/10" : "border border-[#d5dfeb]"}><ChevronLeft className="size-4 rtl:-scale-x-100" /></IconButton><IconButton label={t("home.nextProducts", { title: railTitle })} onClick={() => toast(t("home.moreControlsSoon"))} className={dark ? "border border-[#49658d] text-white hover:bg-white/10" : "border border-[#d5dfeb]"}><ChevronRight className="size-4 rtl:-scale-x-100" /></IconButton><button onClick={onViewAll} className={`pressable rounded-full px-3.5 py-2 text-[10px] font-extrabold tracking-[.08em] uppercase ${dark ? "bg-white/10 text-white hover:bg-white/20" : "border border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#e7edf5]"}`}>{t("home.viewAll")}</button></div></div>{catalogLoading ? <CatalogSkeleton dark={dark} /> : catalogError ? <div className={`mt-5 rounded-2xl border px-6 py-10 text-center ${dark ? "border-[#49658d] bg-white/5 text-white" : "border-[#f2b69e] bg-white text-[#0a285a]"}`}><p className="text-sm font-bold">{t("home.catalogSlow")}</p></div> : railProducts.length ? <div className="hide-scrollbar mt-5 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">{railProducts.map((product) => <div key={`${id}-${product.id}`} className="min-w-[172px] sm:min-w-[195px] lg:min-w-0"><ProductCard compact product={product} saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onDetails={() => onDetails(product)} onAdd={() => void onAdd(product)} onBuyNow={() => void onBuyNow(product)} isAdding={isAdding} /></div>)}{supportCard && products.length < 4 ? <button onClick={() => onSelectSupport(supportCard.category)} className="group relative min-h-[248px] min-w-[230px] overflow-hidden rounded-2xl text-start sm:min-w-[260px] lg:min-w-0"><img src={supportCard.image} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-[#061b3b]/85 via-[#061b3b]/16 to-transparent" /><div className="absolute bottom-0 start-0 end-0 p-5 text-white"><p className="text-[9px] font-extrabold tracking-[.14em] text-[#ffe6b2] uppercase">{t(supportCard.eyebrow)}</p><h3 className="display-face mt-2 max-w-[220px] text-3xl leading-[.92]">{t(supportCard.title)}</h3><span className="mt-4 inline-flex items-center gap-1 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.shopCollection")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></span></div></button> : null}</div> : <div className={`mt-5 rounded-2xl border border-dashed px-6 py-10 text-center ${dark ? "border-[#49658d] bg-white/5 text-[#d9e7f7]" : "border-[#b8c9dc] bg-white/55 text-[#536b8c]"}`}><Search className="mx-auto size-5" /><p className="mt-2 text-sm font-bold">{t("home.noMatches")}</p><button onClick={onViewAll} className={`mt-3 text-xs font-extrabold underline underline-offset-4 ${dark ? "ink-accent-on-dark" : "ink-accent"}`}>{t("home.showCatalog")}</button></div>}</div></section>;
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
              style={{ backgroundColor: category.image ? "#ffffff" : category.color }}
            >
              {category.image
                ? <img src={category.image} alt="" aria-hidden loading="lazy" className="size-full object-contain p-2.5" />
                : <PackageCheck className="size-7 text-[#0a285a]/70" aria-hidden />}
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

function DealsSurface({ loading, error, product, saved, onSave, onDetails, onAdd, onBuyNow, isAdding, onRetry, onViewAll }: { loading: boolean; error: boolean; product?: Product; saved: string[]; onSave: (id: string, title: string) => void; onDetails: (product: Product) => void; onAdd: (product: Product) => void; onBuyNow: (product: Product) => void; isAdding: boolean; onRetry: () => void; onViewAll: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  return <section id="deals" className="container py-9 sm:py-12"><div className="mb-5 flex items-end justify-between gap-5"><div><p className="text-[10px] font-extrabold tracking-[.16em] text-[#a44a2b] uppercase">{t("home.freshNow")}</p><h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">{t("home.deals")}</h2><p className="mt-1 text-xs text-[#536b8c]">{t("home.dealsNote")}</p></div><button onClick={onViewAll} className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("home.viewAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div>{loading ? <CatalogSkeleton /> : error ? <div className="rounded-[1.5rem] border border-[#f2b69e] bg-white px-6 py-14 text-center"><PackageCheck className="mx-auto size-7 ink-accent" /><h3 className="mt-3 text-lg font-extrabold text-[#0a285a]">{t("home.dealsSlow")}</h3><p className="mt-2 text-sm text-[#536b8c]">{t("home.refreshNote")}</p><button onClick={onRetry} className="glass glass-navy pressable mt-5 rounded-full px-4 py-3 text-xs font-extrabold">{t("home.refreshCatalog")}</button></div> : !product ? <div className="rounded-[1.5rem] border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center"><Search className="mx-auto size-6 ink-muted" /><h3 className="mt-3 text-lg font-extrabold text-[#0a285a]">{t("home.newDeals")}</h3><p className="mt-2 text-sm text-[#536b8c]">{t("home.newDealsNote")}</p><button onClick={onViewAll} className="mt-4 text-xs font-extrabold ink-accent underline underline-offset-4">{t("home.browseDepartments")}</button></div> : <div className="grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr]"><button onClick={() => onDetails(product)} className="pressable group relative min-h-[270px] overflow-hidden rounded-[1.5rem] bg-[#f2683a] p-6 text-start text-white sm:min-h-[330px]"><div className="absolute end-0 top-0 h-full w-[54%] overflow-hidden"><img src={product.images[0]?.url} alt="" className="size-full object-cover opacity-95 transition-transform duration-500 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-r from-[#f2683a] via-[#f2683a]/25 to-transparent rtl:bg-gradient-to-l" /></div><div className="relative z-10 flex h-full max-w-[250px] flex-col"><span className="w-fit rounded-full bg-[#8c2f22] px-3 py-1 text-[9px] font-extrabold tracking-[.14em] uppercase">{t("home.todaysEdit")}</span><p className="mt-6 text-[11px] font-bold text-white">{product.productType || t("home.netletSelection")}</p><h3 className="display-face mt-2 text-3xl leading-[.92]">{product.title}</h3><p className="mt-3 text-sm text-white">{money(product.priceRange.min)}</p><span className="mt-auto inline-flex items-center gap-2 text-xs font-extrabold">{t("home.shopDeal")} <ArrowRight className="size-4 rtl:-scale-x-100" /></span></div></button><ProductCard product={product} compact saved={saved.includes(product.id)} onSave={() => onSave(product.id, product.title)} onDetails={() => onDetails(product)} onAdd={() => void onAdd(product)} onBuyNow={() => void onBuyNow(product)} isAdding={isAdding} /><div className="relative overflow-hidden rounded-[1.5rem] border border-[#d5dfeb] bg-[#fff0ab] p-6"><div className="absolute -end-8 -top-8 size-32 rounded-full border-[18px] border-[#f2683a]/25" /><div className="relative flex h-full flex-col"><span className="grid size-10 place-items-center rounded-2xl bg-white/80 ink-accent"><Truck className="size-5" /></span><p className="mt-5 text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("delivery.kuwait")}</p><h3 className="display-face mt-2 text-3xl leading-[.92] text-[#0a285a]">{t("home.deliveryCloser")}</h3><p className="mt-3 text-sm leading-6 text-[#536b8c]">{t("home.deliveryCloserNote")}</p><button onClick={onViewAll} className="mt-auto inline-flex items-center gap-2 text-xs font-extrabold text-[#0a285a]">{t("home.browseCatalogAction")} <ArrowRight className="size-4 ink-accent rtl:-scale-x-100" /></button></div></div></div>}</section>;
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { compact: headerCompact, handlers: headerHandlers } = useCompactHeader();
  useOverlay(menuOpen, () => setMenuOpen(false));
  const [, navigate] = useLocation();
  usePageMeta(homeMeta(SITE_URL));
  const { isArabic, t } = useTranslation();
  const openAuth = () => DEMO_MODE
    ? toast(t("header.signInDisabled"), { description: t("header.signInDisabledNote") })
    : setAuthOpen(true);
  const [search, setSearch] = useState("");
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const { itemCount, openCart, addItem, loading: cartLoading } = useCart();
  const { savedIds: saved, toggleSaved: togglePersistentSaved, deliveryZone, toggleLocale } = useCustomer();
  const { data: catalog = [], isLoading: catalogLoading, error: catalogError, refetch } = trpc.commerce.products.list.useQuery({ first: 24 });

  const visibleProducts = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const matchingProducts = catalog.filter((product) =>
      !searchTerm || [product.title, product.description, product.productType, product.vendor, ...product.tags].join(" ").toLowerCase().includes(searchTerm));
    return filterAndSortCatalog(matchingProducts, { availability: "all", sort: "catalog" });
  }, [catalog, search]);
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
  const rotateProducts = (offset: number) => visibleProducts.length ? [...visibleProducts.slice(offset), ...visibleProducts.slice(0, offset)] : [];
  // Departments lead to the listing page rather than scrolling this one. A
  // rail of four products was a teaser; the shopper asking for "Electronics"
  // wants the department, with everything in it and a way to narrow it.
  const selectCategory = (category: string) => navigate(`/category/${categorySlug(category)}`);
  const showAll = () => navigate("/category/all");
  const toggleSaved = (id: string, title: string) => { const isSaved = saved.includes(id); togglePersistentSaved(id); toast(t(isSaved ? "saved.removed" : "saved.savedForLater", { name: title })); };
  const addProduct = async (product: Product) => { const variant = product.variants[0]; if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable")); try { await addItem(variant.id); toast.success(t("cart.added", { name: product.title })); } catch { toast.error(t("cart.addFailed")); } };
  // Buy now is add-to-cart plus the checkout step, not a separate path: the
  // cart is where quantity, delivery and payment are resolved.
  const buyProduct = async (product: Product) => {
    const variant = product.variants[0];
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    try {
      await addItem(variant.id);
      window.location.assign(appPath("/checkout"));
    } catch {
      toast.error(t("cart.buyFailed"));
    }
  };
  // Signing out asks first here too. The header button is the easiest one to
  // hit by accident, being where the cart and the language switch also live.
  const accountAction = () => { if (authLoading) return; if (isAuthenticated) setSignOutOpen(true); else openAuth(); };
  // Footer links go where they say they go: a category filter, an on-page
  // rail, or another route. Only the two links with nothing behind them yet
  // fall through to a notice.
  const followFooterLink = (link: { key: MessageKey; query?: string; href?: string; route?: string }) => {
    if (link.query) return selectCategory(link.query);
    if (link.href) return document.querySelector(link.href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (link.route) return window.location.assign(appPath(link.route));
    toast(t("home.footerSoon", { link: t(link.key) }));
  };
  const firstProduct = visibleProducts[0] ?? catalog[0];
  const openProduct = (product: Product) => window.location.assign(appPath(`/products/${encodeURIComponent(product.handle)}`));

  return <main id="top" className="min-h-screen bg-background text-[#0a285a]">
    <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    <ConfirmDialog
      open={signOutOpen}
      tone="danger"
      icon={<LogOut className="size-5" />}
      title={t("account.signOutTitle")}
      body={t("account.signOutBody")}
      confirmLabel={t("header.signOut")}
      pending={signingOut}
      onClose={() => setSignOutOpen(false)}
      onConfirm={async () => {
        setSigningOut(true);
        try {
          await logout();
          toast.success(t("header.signedOut"));
          setSignOutOpen(false);
        } finally {
          setSigningOut(false);
        }
      }}
    />
    <header {...headerHandlers} data-compact={headerCompact} className="sticky top-0 z-40 border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl">
      {/* Primary bar: logo, a search field that takes all remaining width, then
          the account cluster — the layout marketplaces converge on. */}
      <div className={`container relative flex items-center gap-3 transition-[height] duration-300 ease-out lg:gap-5 ${headerCompact ? "h-[58px] lg:h-[62px]" : "h-[68px] lg:h-[76px]"}`}>
        <div className="absolute start-4 lg:static lg:hidden"><IconButton label={t("header.openMenu")} onClick={() => setMenuOpen(true)}><Menu className="size-6" /></IconButton></div>
        <div className={`mx-auto origin-left transition-transform rtl:origin-right duration-300 ease-out lg:mx-0 ${headerCompact ? "scale-[.82]" : "scale-100"}`}><Logo t={t} /></div>
        <div className="hidden min-w-0 flex-1 lg:block"><LiveSearch catalog={catalog} value={search} onChange={setSearch} onSelectProduct={openProduct} /></div>
        <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <AppDownloadAction t={t} />
          <HeaderAction label={t("header.changeLanguage")} onClick={toggleLocale} icon={<Globe2 className="size-[19px] ink-accent" />} caption={isArabic ? "AR /" : "EN /"} value="KWD" />
          <HeaderAction label={t(isAuthenticated ? "header.signOut" : "header.signIn")} onClick={accountAction} icon={isAuthenticated ? <LogOut className="size-[19px]" /> : <UserRound className="size-[19px]" />} caption={t("header.welcome")} value={isAuthenticated ? (user?.name ? t("header.greeting", { name: user.name }) : t("header.signOut")) : t("header.signIn")} />
          <HeaderAction label={t("header.openCart")} onClick={openCart} tone="primary" badge={itemCount} icon={<ShoppingBag className="size-[19px]" />} caption={t("nav.cart")} value={itemCount === 1 ? t("header.itemOne") : t("header.items", { count: itemCount })} />
        </div>
        <button onClick={openCart} aria-label={t("header.openCart")} className="glass glass-navy pressable absolute end-4 grid size-10 place-items-center rounded-full lg:hidden"><ShoppingBag className="size-[18px]" /><span className="absolute -end-1 -top-1 grid size-4 place-items-center rounded-full bg-[#f2683a] text-[9px] font-extrabold text-white">{itemCount}</span></button>
      </div>
      <div className={`container overflow-hidden transition-all duration-300 ease-out lg:hidden ${headerCompact ? "max-h-0 pb-0 opacity-0" : "max-h-20 pb-3 opacity-100"}`} aria-hidden={headerCompact}><LiveSearch catalog={catalog} value={search} onChange={setSearch} onSelectProduct={openProduct} /></div>
      {/* Secondary bar: departments only, so the row reads as one rail. */}
      <nav className={`container hidden items-center gap-2 overflow-hidden transition-all duration-300 ease-out lg:flex ${headerCompact ? "h-0 -translate-y-1 opacity-0" : "h-12 translate-y-0 opacity-100"}`} aria-hidden={headerCompact} inert={headerCompact} aria-label={t("nav.primary")}>{categoryRail.map((category, index) => <button key={category.query} onClick={() => selectCategory(category.query)} className={`pressable rounded-full px-3 py-2 text-xs font-semibold ${index === 0 ? "flex items-center gap-2 font-bold" : ""} ${index === 0 ? "glass glass-navy" : "glass !text-[#536b8c]"}`}>{index === 0 && <Menu className="size-4" />}{t(category.key)}</button>)}<div className="ms-auto flex shrink-0 items-center gap-1.5">
        <IconButton label={t("header.notifications")} onClick={() => toast(t("header.notificationsSoon"))}><Bell className="size-[19px]" /></IconButton>
        <IconButton label={t("header.savedItems", { count: saved.length })} onClick={() => navigate("/saved")}><span className="relative"><Heart className="size-[19px]" />{saved.length ? <span className="absolute -end-2 -top-1.5 grid size-4 place-items-center rounded-full bg-[#f2683a] text-[9px] font-extrabold text-white">{saved.length}</span> : null}</span></IconButton>
      </div></nav>
    </header>

    {menuOpen && <div className="netlet-menu-scrim fixed inset-0 z-50 bg-[#061b3b]/30 backdrop-blur-sm lg:hidden" onClick={() => setMenuOpen(false)}><aside role="dialog" aria-modal="true" aria-label={t("nav.allDepartments")} className="netlet-menu-panel h-full w-[82%] max-w-sm bg-[#f3f2ed] px-5 py-7 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><Logo t={t} /><IconButton label={t("header.closeMenu")} onClick={() => setMenuOpen(false)}><X /></IconButton></div><div className="mt-10 space-y-1">{categoryRail.map((category) => <button key={category.query} onClick={() => { selectCategory(category.query); setMenuOpen(false); }} className="glass pressable mb-1 block w-full rounded-xl px-4 py-4 text-start text-sm font-bold">{t(category.key)}</button>)}</div><button onClick={accountAction} className="glass glass-navy pressable mt-7 flex w-full items-center justify-center gap-2 rounded-2xl p-4 text-sm font-bold">{isAuthenticated ? <LogOut className="size-4" /> : <UserRound className="size-4" />}{isAuthenticated ? (user?.name ? t("header.signOutName", { name: user.name }) : t("header.signOut")) : t("header.signInToNetlet")}</button></aside></div>}

    {/* Hero, at roughly half its previous height so the first row of products
        is on screen when the page opens. The panel carries the colour now that
        the page ground is a near-white neutral: a deep navy field lifted toward
        an electric blue, a brand-orange bloom on the warm side and a cool one
        opposite so the warmth reads as deliberate rather than as a cast. */}
    <section className="container pt-5 sm:pt-6"><div className="relative isolate min-h-[200px] overflow-hidden rounded-[1.5rem] bg-[#06162f] lg:min-h-[248px]"><div className="absolute inset-0 bg-[linear-gradient(105deg,#06162f_0%,#0a285a_44%,#14428f_78%,#1c58b8_100%)]" /><div className="absolute -end-16 -top-32 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(242,104,58,.52)_0%,rgba(242,104,58,0)_65%)]" /><div className="absolute -bottom-40 start-[36%] size-[380px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,.34)_0%,rgba(56,189,248,0)_68%)]" /><img src={heroImage} alt="" aria-hidden className="pointer-events-none absolute inset-y-0 end-0 hidden h-full w-[46%] object-cover opacity-30 [mask-image:linear-gradient(to_right,transparent,#000_58%)] rtl:[mask-image:linear-gradient(to_left,transparent,#000_58%)] lg:block" /><div className="absolute inset-0 bg-[linear-gradient(90deg,#06162f_0%,rgba(6,22,47,.62)_44%,rgba(6,22,47,0)_74%)] rtl:bg-[linear-gradient(270deg,#06162f_0%,rgba(6,22,47,.62)_44%,rgba(6,22,47,0)_74%)]" /><div className="relative z-10 flex min-h-[200px] max-w-[640px] flex-col justify-center px-6 py-7 sm:px-10 lg:min-h-[248px] lg:px-12"><div className="reveal-up flex items-center gap-2"><span className="h-px w-6 bg-[#ff8a5c]" /><span className="text-[10px] font-extrabold tracking-[0.17em] text-[#ffb495] uppercase">{t("home.eyebrow")}</span></div><h1 className="reveal-up reveal-delay-1 display-face mt-2.5 text-[2rem] leading-[.98] text-white sm:text-[2.5rem] lg:text-[3rem]">{t("home.heroTitle")} <em className="font-normal text-[#9fc6ff]">{t("home.heroTitleEm")}</em></h1><div className="reveal-up reveal-delay-2 mt-4 flex flex-wrap items-center gap-2.5"><button onClick={showAll} className="glass glass-accent pressable flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold">{t("home.shopCatalog")} <ArrowRight className="size-4 rtl:-scale-x-100" /></button><button onClick={() => document.getElementById("deals")?.scrollIntoView({ behavior: "smooth" })} className="glass glass-on-dark pressable rounded-full px-5 py-3 text-xs font-extrabold">{t("home.exploreDeals")}</button></div><div className="mt-4 hidden flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-bold text-[#a9c6ec] lg:flex"><span className="flex items-center gap-1.5"><Truck className="size-3.5 text-[#ff9a70]" /> {deliveryZone ? t("delivery.selected", { name: isArabic ? deliveryZone.labelAr : deliveryZone.label }) : t("home.chooseArea")}</span><span className="flex items-center gap-1.5"><Store className="size-3.5 text-[#ff9a70]" /> {t("home.liveCatalog")}</span><span className="flex items-center gap-1.5"><ShoppingBag className="size-3.5 text-[#ff9a70]" /> {t("home.persistentCart")}</span></div></div><div className="glass glass-on-dark absolute end-4 top-4 rounded-full px-3 py-1.5 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.newSeason")}</div></div></section>

    <CategoryRail categories={departmentTiles} onSelect={selectCategory} />
    <DealsSurface loading={catalogLoading} error={Boolean(catalogError)} product={firstProduct} saved={saved} onSave={toggleSaved} onDetails={openProduct} onAdd={addProduct} onBuyNow={buyProduct} isAdding={cartLoading} onRetry={() => void refetch()} onViewAll={showAll} />

    {homeRailDefinitions.slice(1).map((rail, index) => <ProductRail key={rail.id} id={rail.id} title={rail.title} description={rail.description} dark={rail.treatment === "navy"} products={rotateProducts(index)} catalogLoading={catalogLoading} catalogError={Boolean(catalogError)} saved={saved} onSave={toggleSaved} onDetails={openProduct} onAdd={addProduct} onBuyNow={buyProduct} isAdding={cartLoading} onViewAll={showAll} supportCard={railSupportCards[index]} onSelectSupport={selectCategory} />)}

    <section className="container py-10 sm:py-14"><div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-extrabold tracking-[.16em] text-[#a44a2b] uppercase">{t("home.browseYourPace")}</p><h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">{t("home.categories")}</h2></div><button onClick={showAll} className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("nav.allDepartments")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div><div className="hide-scrollbar flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 lg:grid-cols-6">{categoryRail.map((category, index) => <button key={category.query} onClick={() => selectCategory(category.query)} className={`pressable group min-w-[132px] rounded-2xl border p-3 text-start shadow-[0_5px_15px_rgba(10,40,90,.04)] sm:min-w-0 border-[#d5dfeb] bg-white hover:border-[#aac0da]`}><div className="grid aspect-[1.38] place-items-center rounded-xl" style={{ backgroundColor: category.color }}><span className="grid size-11 place-items-center rounded-2xl bg-white/80 text-[#0a285a] shadow-sm">{index === 0 ? <PackageCheck className="size-5" /> : index === 1 ? <Sparkles className="size-5" /> : index === 2 ? <Store className="size-5" /> : index === 3 ? <Heart className="size-5" /> : index === 4 ? <ArrowDownRight className="size-5" /> : <ShoppingBag className="size-5" />}</span></div><span className="mt-3 block text-xs font-extrabold text-[#0a285a]">{t(category.key)}</span><span className="mt-1 flex items-center text-[10px] font-bold text-[#536b8c]">{t("home.browse")} <ArrowDownRight className="ms-1 size-3 rtl:-scale-x-100" /></span></button>)}</div></section>

    <section className="border-y border-[#d5dfeb] bg-white/45 py-10 sm:py-14"><div className="container"><div className="flex items-end justify-between gap-5"><div><p className="text-[10px] font-extrabold tracking-[.16em] text-[#a44a2b] uppercase">{t("home.notesFrom")}</p><h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">{t("home.usefulReading")}</h2></div><button onClick={() => toast(t("home.editorialSoon"))} className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("home.viewAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div><div className="mt-6 grid gap-3 md:grid-cols-3">{editorialUpdates.map((entry) => <article key={entry.title} className="rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] p-6"><p className="text-[9px] font-extrabold tracking-[.14em] ink-accent uppercase">{t(entry.date)}</p><h3 className="type-heading mt-4 text-lg tracking-[-.025em] text-[#0a285a]">{t(entry.title)}</h3><p className="type-body mt-3 text-sm leading-6 text-[#536b8c]">{t(entry.summary)}</p><button onClick={() => toast(t("home.guideSoon"))} className="mt-5 inline-flex items-center gap-1 text-[10px] font-extrabold tracking-[.1em] text-[#0a285a] uppercase">{t("home.readMore")} <ArrowRight className="size-3.5 ink-accent rtl:-scale-x-100" /></button></article>)}</div></div></section>

    <section className="container grid gap-4 py-10 sm:py-14 lg:grid-cols-2"><div className="relative overflow-hidden rounded-[1.5rem] bg-[#fffdf9] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -bottom-16 end-5 size-56 rounded-t-[3rem] bg-[#0a285a]" /><div className="absolute bottom-0 end-12 h-[215px] w-[116px] rounded-t-[1.5rem] border-[7px] border-[#0a285a] bg-white shadow-[0_18px_35px_rgba(10,40,90,.18)]"><img src={logoImage} alt="NetLet" className="absolute left-1/2 top-[45%] w-16 -translate-x-1/2" /></div><div className="relative z-10 max-w-[55%]"><p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("home.application")}</p><h2 className="display-face mt-3 text-3xl leading-[.94] text-[#0a285a]">{t("home.appTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.appNote")}</p><button onClick={() => toast(t("home.appSoon"))} className="glass glass-navy pressable mt-6 rounded-full px-4 py-3 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.appUpdates")}</button></div></div><div className="relative overflow-hidden rounded-[1.5rem] bg-[#e7edf5] p-7 sm:min-h-[255px] sm:p-9"><div className="absolute -end-14 -top-14 size-72 rounded-full border-[28px] border-[#d1e3d0]" /><div className="absolute bottom-7 end-9 grid size-16 place-items-center rounded-2xl bg-[#fff0ab] text-[#0a285a] shadow-lg"><MapPin className="size-7" /></div><div className="relative z-10 max-w-[60%]"><p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("delivery.kuwait")}</p><h2 className="display-face mt-3 text-3xl leading-[.94] text-[#0a285a]">{t("home.deliveryTitle")}</h2><p className="mt-4 text-sm leading-6 text-[#536b8c]">{t("home.deliveryNote")}</p><button onClick={() => setDeliveryOpen(true)} className="glass glass-accent pressable mt-6 inline-flex items-center gap-2 rounded-full px-4 py-3 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("home.chooseDeliveryArea")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></button></div></div></section>

    <section className="container pb-10"><div className="grid overflow-hidden rounded-[1.6rem] bg-[#0a285a] text-[#fffdf9] lg:grid-cols-[1.1fr_.9fr]"><div className="relative p-7 sm:p-10"><div className="pointer-events-none absolute -bottom-24 -start-12 size-64 rounded-full border border-[#f2683a]/55" /><p className="relative text-[10px] font-extrabold tracking-[.15em] text-[#ffcc64] uppercase">{t("home.promise")}</p><h2 className="relative display-face mt-3 text-4xl leading-[.94] sm:text-5xl">{t("home.lessSearching")}<br /><em className="font-normal">{t("home.moreFinding")}</em></h2><p className="relative mt-4 max-w-md text-sm leading-6 text-[#d9e7f7]">{t("home.promiseNote")}</p></div><div className="grid grid-cols-3 divide-x divide-[#49658d] border-t border-[#49658d] lg:border-s lg:border-t-0"><div className="grid place-items-center p-5 text-center"><Truck className="size-5 text-[#ffcc64]" /><p className="mt-2 text-lg font-extrabold">{t(deliveryZone ? "home.statSaved" : "home.statChoose")}</p><p className="mt-1 text-[9px] font-bold tracking-[.08em] text-[#b9cce5] uppercase">{t("home.deliveryArea")}</p></div><div className="grid place-items-center p-5 text-center"><PackageCheck className="size-5 text-[#ffcc64]" /><p className="mt-2 text-lg font-extrabold">{catalog.length}</p><p className="mt-1 text-[9px] font-bold tracking-[.08em] text-[#b9cce5] uppercase">{t("home.statLiveItems")}</p></div><div className="grid place-items-center p-5 text-center"><ShoppingBag className="size-5 text-[#ffcc64]" /><p className="mt-2 text-lg font-extrabold">{t("home.statEasy")}</p><p className="mt-1 text-[9px] font-bold tracking-[.08em] text-[#b9cce5] uppercase">{t("home.statNativeCart")}</p></div></div></div></section>

    <footer className="bg-[#0a285a] pb-24 pt-12 text-white lg:pb-7"><div className="container grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]"><div><FooterLogo t={t} /><p className="mt-4 max-w-xs text-sm leading-6 text-[#b9cce5]">{t("home.footerNote")}</p><button onClick={toggleLocale} className="glass glass-on-dark pressable mt-6 rounded-full px-3 py-2 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("header.language")}</button></div>{footerGroups.map((group) => <div key={group.title}><p className="text-xs font-extrabold text-white">{t(group.title)}</p>{group.links.map((link) => <button key={link.key} onClick={() => followFooterLink(link)} className="mt-3 block text-start text-xs font-medium text-[#b9cce5] hover:text-[#ffcc64]">{t(link.key)}</button>)}</div>)}</div><div className="container mt-10 flex flex-col gap-3 border-t border-[#49658d] pt-5 text-[10px] font-semibold text-[#b9cce5] sm:flex-row sm:items-center sm:justify-between"><span>{t("home.copyright", { year: new Date().getFullYear() })}</span><span>{t("home.legal")}</span></div></footer>

    <MobileTabBar onBrowse={() => setMenuOpen(true)} />
    <DeliveryZoneDialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />
  </main>;
}
