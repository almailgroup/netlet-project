import { useCart } from "@/contexts/CartContext";
import { ProductReviews } from "@/components/product/ProductReviews";
import { BoughtTogether } from "@/components/product/BoughtTogether";
import { ProductAssistant } from "@/components/product/ProductAssistant";
import { UnitPrice } from "@/components/product/UnitPrice";
import { AvailabilityLine, buyLabelFor } from "@/components/product/Availability";
import { QuickView } from "@/components/product/QuickView";
import { useCustomer } from "@/contexts/CustomerContext";
import { Thumb } from "@/components/product/Thumb";
import { QuantityStepper } from "@/components/cart/QuantityStepper";
import { appPath } from "@/lib/basePath";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { breadcrumbJsonLd, privatePageMeta, productJsonLd, productMeta } from "@shared/seo";
import { logoImage } from "@/lib/brandAssets";
import { trpc } from "@/lib/trpc";
import { canUseGalleryKeyboard, galleryIndex } from "@shared/commerce/gallery";
import {
  isExpressEligible,
  productRating,
  savingsPercent,
  merchantWarranty,
  specifications,
} from "@shared/commerce/productDetail";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { relatedProducts } from "@shared/commerce/related";
import { categorySlug } from "@shared/commerce/browse";
import { categoryMessageKey } from "@/content/homeLayout";
import type { Product } from "@shared/commerce/types";
import { visibleBadges } from "@shared/inventory/vendorHealth";
import { ArrowLeft, ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Heart, ListTree, LoaderCircle, PackageOpen, Play, RotateCcw, Share2, ShieldCheck, ShoppingBag, Star, Tag, Truck, Wallet, Wrench, X, Zap, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { useMoney, useTranslation, type Translate } from "@/hooks/useTranslation";
import { shareProduct } from "@/components/product/ProductCard";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { VariantPicker, imageIndexForVariant } from "@/components/product/VariantPicker";
import { FollowProduct } from "@/components/product/FollowProduct";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import type { MessageKey } from "@shared/i18n/dictionary";

/**
 * NetLet's delivery terms, not per-product data — the same six rows the
 * storefront promises on every item. The Express row only appears for products
 * the merchant has actually tagged for it.
 */
type PolicyRow = { icon: typeof Truck; title: MessageKey; body: MessageKey };

/*
 * Three panels, not one.
 *
 * Returns and buyer protection used to sit at the bottom of the shipping list,
 * which is where a shopper looking for "what if it breaks" never thinks to
 * look — shipping answers "when does it arrive". They are separate questions
 * and they get separate tabs.
 */
const SHIPPING_POLICY = [
  { icon: Truck, title: "shipping.standard.title", body: "shipping.standard.body" },
  { icon: Tag, title: "shipping.charges.title", body: "shipping.charges.body" },
  { icon: Wallet, title: "shipping.payment.title", body: "shipping.payment.body" },
] as const satisfies readonly PolicyRow[];

const WARRANTY_POLICY = [
  { icon: ShieldCheck, title: "shipping.protection.title", body: "shipping.protection.body" },
  { icon: Wrench, title: "warranty.claim.title", body: "warranty.claim.body" },
] as const satisfies readonly PolicyRow[];

function RelatedCard({ product }: { product: Product }) {
  const { t } = useTranslation();
  const money = useMoney();
  const image = product.images[0];
  return (
    <article className="group min-w-[190px] overflow-hidden rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] p-3 sm:min-w-0">
      <button onClick={() => window.location.assign(appPath(`/products/${encodeURIComponent(product.handle)}`))} className="block w-full text-start">
        <div className="relative overflow-hidden rounded-xl bg-[#e7edf5]">
          <Thumb src={image?.url} alt={image?.altText ?? product.title} className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        </div>
        <p className="mt-3 text-[9px] font-extrabold tracking-[.12em] text-[#a44a2b] uppercase">{product.productType || t("product.netletEdit")}</p>
        <h3 className="mt-1 line-clamp-2 text-sm font-extrabold tracking-[-.025em] text-[#0a285a] group-hover:text-[#a44a2b]">{product.title}</h3>
        <p className="mt-2 text-base font-extrabold tracking-[-.04em] text-[#0a285a]">{money(product.priceRange.min)}</p>
      </button>
    </article>
  );
}

/**
 * How many thumbnails the rail shows before collapsing into "View all".
 *
 * Fewer on a phone: the rail is horizontal there, and six 62px tiles overflow a
 * 358px strip, which pushed the View-all tile off the right edge where nobody
 * would find it. Five tiles fit.
 */
const RAIL_LIMIT = 5;
const RAIL_LIMIT_NARROW = 4;
/** Magnification applied by the hover lens, as a multiple of displayed size. */
const LENS_ZOOM = 2.5;
/**
 * The zoom pane's width in px.
 *
 * A constant rather than only a Tailwind class, because the lens geometry has
 * to know it: the lens rectangle is *derived* from what the pane can show, and
 * a number in the stylesheet that the arithmetic guesses at is how the two
 * stopped agreeing in the first place.
 */
const LENS_PANE_WIDTH = 520;

/**
 * Full-screen viewer: every image as a grid on the left, the selected one large
 * on the right, with step zoom. This is the "inspect it properly" surface — the
 * hover lens is for a glance, this is for deciding.
 */
function ImageLightbox({ product, selectedImageIndex, onClose, onSelectImage, onChangeImage }: {
  product: Product;
  selectedImageIndex: number;
  onClose: () => void;
  onSelectImage: (index: number) => void;
  onChangeImage: (direction: "previous" | "next") => void;
}) {
  const { direction, t } = useTranslation();
  const [scale, setScale] = useState(1);
  /* The same list the gallery indexes into, or "image 4" would mean two
     different things on the two surfaces the moment a video is in the set. */
  const media = product.media.length ? product.media : product.images.map(item => ({ ...item, kind: "image" as const, posterUrl: null }));
  const image = media[selectedImageIndex] ?? media[0];
  const isVideo = image?.kind === "video";
  const hasMultipleImages = media.length > 1;
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // A new image at 3x would drop the shopper into a corner of it.
  useEffect(() => setScale(1), [selectedImageIndex]);

  const endSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    // Only while un-zoomed: past 1x a drag is how you pan around the image.
    if (!start || !hasMultipleImages || scale > 1) return;
    const travelled = event.clientX - start.x;
    if (Math.abs(travelled) < SWIPE_THRESHOLD || Math.abs(travelled) < Math.abs(event.clientY - start.y)) return;
    onChangeImage(swipeDirection(travelled, direction));
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t("product.allImages", { name: product.title })}>
      <div className="flex items-start justify-between px-6 pt-5">
        <div>
          <h2 className="border-b-2 border-[#0a285a] pb-2 text-lg font-extrabold text-[#0a285a]">{t("product.images")}</h2>
        </div>
        <button autoFocus onClick={onClose} aria-label={t("product.closeViewer")} className="pressable grid size-10 place-items-center rounded-full text-[#404553] hover:bg-[#f1f1f3]"><X className="size-6" /></button>
      </div>

      {/* On a phone the grid used to sit above the image, so opening the viewer
          showed nine thumbnails and the photo 460px down the scroll. The image
          comes first there; the desktop keeps the grid on the left. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-4 sm:px-6 lg:flex-row lg:gap-6 lg:overflow-hidden">
        <div className="order-2 grid h-fit shrink-0 grid-cols-4 gap-2.5 sm:grid-cols-5 lg:order-1 lg:w-[400px] lg:grid-cols-3 lg:gap-3">
          {media.map((item, index) => (
            <button
              key={`${item.url}-${index}`}
              onClick={() => onSelectImage(index)}
              aria-label={t(item.kind === "video" ? "product.showVideo" : "product.showImage", { index: index + 1, total: media.length })}
              aria-current={selectedImageIndex === index}
              className={`pressable relative aspect-square overflow-hidden rounded-xl border-2 bg-white p-1 ${selectedImageIndex === index ? "border-[#0a285a]" : "border-[#e2e5eb] hover:border-[#aac0da]"}`}
            >
              <Thumb src={item.kind === "video" ? (item.posterUrl ?? undefined) : item.url} alt="" className="size-full object-contain" icon={item.kind === "video" ? <Play className="size-5 text-[#536b8c]" /> : undefined} />
              {item.kind === "video" ? (
                <span aria-hidden className="absolute inset-0 m-auto grid size-7 place-items-center rounded-full bg-[#0a285a]/85 text-white">
                  <Play className="size-3.5 fill-current" />
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div
          onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={endSwipe}
          onPointerCancel={() => { swipeStart.current = null; }}
          className="relative order-1 flex min-h-[46vh] flex-1 touch-pan-y items-center justify-center overflow-auto lg:order-2 lg:min-h-[320px]"
        >
          <Thumb src={image?.url} alt={image?.altText ?? product.title} priority style={{ transform: `scale(${scale})` }} className="max-h-full max-w-full object-contain transition-transform duration-200" />
          <div className="absolute end-2 top-2 flex flex-col gap-2">
            <button onClick={() => setScale(s => Math.min(3, +(s + 0.5).toFixed(1)))} disabled={scale >= 3} aria-label={t("product.zoomIn")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)] disabled:opacity-35"><ZoomIn className="size-5" /></button>
            <button onClick={() => setScale(s => Math.max(1, +(s - 0.5).toFixed(1)))} disabled={scale <= 1} aria-label={t("product.zoomOut")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)] disabled:opacity-35"><ZoomOut className="size-5" /></button>
          </div>
          {hasMultipleImages ? <>
            <button onClick={() => onChangeImage("previous")} aria-label={t("product.prevImage")} className="pressable absolute start-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)]"><ChevronLeft className="size-6 rtl:-scale-x-100" /></button>
            <button onClick={() => onChangeImage("next")} aria-label={t("product.nextImage")} className="pressable absolute end-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)]"><ChevronRight className="size-6 rtl:-scale-x-100" /></button>
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#0a285a]/85 px-3 py-1 text-[11px] font-bold text-white" aria-live="polite"><span dir="ltr">{selectedImageIndex + 1} / {media.length}</span></span>
          </> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Gallery: a thumbnail rail down the left, the current view large beside it,
 * the inspection tools stacked over its top-right corner, and a magnifier that
 * opens beside the panel on hover.
 *
 * The lens is pointer-driven and mouse-only. It is keyed off a
 * `(hover: hover) and (pointer: fine)` query rather than a width breakpoint,
 * because a touch device cannot hover — a panel that appears on tap and then
 * cannot be dismissed is worse than no panel — and a small laptop can.
 */
/** Horizontal travel, in px, that counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 45;

/**
 * Which image a horizontal drag asks for.
 *
 * A swipe means "pull the next one into view", and in Arabic the rail runs the
 * other way — dragging left there is asking for the previous image, not the
 * next one.
 */
function swipeDirection(travelled: number, direction: "ltr" | "rtl"): "previous" | "next" {
  const forward = direction === "rtl" ? travelled > 0 : travelled < 0;
  return forward ? "next" : "previous";
}

/**
 * Gallery.
 *
 * Desktop keeps the rail down the left with the view large beside it. Below
 * `sm` that arrangement does not survive: a 72px rail out of a 390px screen
 * left the product 274px wide, so the rail moves under the image and the stage
 * takes the full width. Order is swapped with CSS rather than by rendering
 * twice, so there is one rail with one selected state.
 *
 * Touch gets what touch expects — a swipe, both arrows, and a counter, since
 * a vertical rail scrolled out of view is the only other clue that image four
 * of nine is showing. The hover magnifier stays mouse-only.
 */
function ProductGallery({ product, selectedImageIndex, onSelectImage, onChangeImage, onZoom, onShare, onToggleSaved, isSaved }: {
  product: Product;
  selectedImageIndex: number;
  onSelectImage: (index: number) => void;
  onChangeImage: (direction: "previous" | "next") => void;
  onZoom: () => void;
  onShare: () => void;
  onToggleSaved: () => void;
  isSaved: boolean;
}) {
  const { direction, t } = useTranslation();
  /*
   * `media`, not `images`: the video sits in the shopper's sequence between
   * the photographs, which is what "alongside photos" asks for. Cards and
   * rails keep reading `images`, so none of them can render a video frame.
   */
  const media = product.media.length ? product.media : product.images.map(image => ({ ...image, kind: "image" as const, posterUrl: null }));
  const image = media[selectedImageIndex] ?? media[0];
  const isVideo = image?.kind === "video";
  const hasMultipleImages = media.length > 1;
  /*
   * Resolved geometry, not a pointer fraction.
   *
   * The lens rectangle and the zoom pane have to describe the same region, and
   * the only way to guarantee that is to compute one from the other rather than
   * to derive each from the pointer independently.
   */
  const [lens, setLens] = useState<{
    left: number; top: number; width: number; height: number;
    bgX: number; bgY: number; bgWidth: number; bgHeight: number; paneHeight: number;
  } | null>(null);
  const [canHover, setCanHover] = useState(false);
  const [narrowRail, setNarrowRail] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const queries: [MediaQueryList, (matches: boolean) => void][] = [
      [window.matchMedia("(hover: hover) and (pointer: fine)"), setCanHover],
      // Matches Tailwind's `sm`, the same point the rail turns horizontal.
      [window.matchMedia("(max-width: 639px)"), setNarrowRail],
    ];
    const listeners = queries.map(([query, set]) => {
      const apply = () => set(query.matches);
      apply();
      query.addEventListener("change", apply);
      return () => query.removeEventListener("change", apply);
    });
    return () => listeners.forEach(off => off());
  }, []);

  // Keep the selected thumbnail in view as the image changes, however it
  // changed — the rail scrolls in both axes depending on the breakpoint.
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = railRef.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedImageIndex]);

  // One limit drives both the slice and the count, or the tile advertises a
  // number that does not match the thumbnails beside it.
  const railLimit = narrowRail ? RAIL_LIMIT_NARROW : RAIL_LIMIT;
  const overflow = media.length - railLimit;
  const railImages = overflow > 0 ? media.slice(0, railLimit) : media;

  /**
   * Point the magnifier at what the cursor is actually over.
   *
   * Two things were wrong here and they compounded, which is why the pane
   * showed a different part of the product from the one under the lens:
   *
   * 1. **The pointer was measured against the container, not the picture.**
   *    The box is `p-6` and the image is `object-contain`, so a tall-ish photo
   *    in a wide box is letterboxed — and the fraction was taken across the
   *    whole box including that empty margin. At the centre it looked nearly
   *    right; at the edges it was off by the width of the letterbox, which is
   *    exactly what a shopper notices.
   * 2. **`background-size: 250% 250%` is a percentage of the *pane*, not of
   *    the image**, and applied to each axis independently — so the zoomed
   *    copy was stretched to the pane's aspect ratio as well as being at the
   *    wrong scale. The 130px lens square then had no relationship at all to
   *    the region the pane displayed.
   *
   * So: measure the rendered `<img>`, work in pixels, and derive the lens
   * rectangle from the pane rather than choosing it separately. The pane shows
   * `paneWidth / zoom` by `paneHeight / zoom` of displayed image, and that is
   * precisely the rectangle drawn on the photo — the two cannot disagree
   * because there is one calculation.
   */
  const trackLens = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canHover || !image) return setLens(null);

    /* The element, not a ref on `Thumb`: a broken image renders a `<span>`
       fallback instead, and there is nothing to magnify about that. */
    const picture = event.currentTarget.querySelector("img");
    if (!picture) return setLens(null);

    const box = event.currentTarget.getBoundingClientRect();
    const rect = picture.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return setLens(null);

    /* `getBoundingClientRect` measures the border box, but an absolutely
       positioned child is placed against the padding box — so the stage's 1px
       border offsets the lens by exactly that much unless it is taken off.
       Small, and precisely the kind of small that reads as "not quite on the
       pointer". `clientLeft`/`clientTop` are the border widths. */
    const borderX = event.currentTarget.clientLeft;
    const borderY = event.currentTarget.clientTop;

    // Over the padding rather than the product: nothing to show.
    const outside =
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) return setLens(null);

    const paneWidth = LENS_PANE_WIDTH;
    const paneHeight = box.height;
    const bgWidth = rect.width * LENS_ZOOM;
    const bgHeight = rect.height * LENS_ZOOM;

    const fractionX = (event.clientX - rect.left) / rect.width;
    const fractionY = (event.clientY - rect.top) / rect.height;

    /* Centre the pane on the pointer, then hold it inside the picture, so the
       edges show image rather than empty pane. `Math.min(0, …)` keeps the
       range valid when the zoomed image is smaller than the pane. */
    const clamp = (value: number, min: number) => Math.min(0, Math.max(min, value));
    const bgX = clamp(paneWidth / 2 - fractionX * bgWidth, Math.min(0, paneWidth - bgWidth));
    const bgY = clamp(paneHeight / 2 - fractionY * bgHeight, Math.min(0, paneHeight - bgHeight));

    setLens({
      // The same region, divided back down out of zoomed pixels.
      left: (rect.left - box.left - borderX) + -bgX / LENS_ZOOM,
      top: (rect.top - box.top - borderY) + -bgY / LENS_ZOOM,
      width: Math.min(paneWidth / LENS_ZOOM, rect.width),
      height: Math.min(paneHeight / LENS_ZOOM, rect.height),
      bgX, bgY, bgWidth, bgHeight, paneHeight,
    });
  };

  const endSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !hasMultipleImages) return;
    const travelled = event.clientX - start.x;
    // Ignore a mostly-vertical drag: that is the page being scrolled.
    if (Math.abs(travelled) < SWIPE_THRESHOLD || Math.abs(travelled) < Math.abs(event.clientY - start.y)) return;
    onChangeImage(swipeDirection(travelled, direction));
  };

  const arrow = "pressable absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_12px_rgba(10,40,90,.18)] sm:size-11";

  return (
    <div className="min-w-0 lg:sticky lg:top-[150px] lg:z-20 lg:self-start">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        {hasMultipleImages ? (
          <div
            ref={railRef}
            className="hide-scrollbar order-2 flex w-full min-w-0 shrink-0 gap-2.5 overflow-auto sm:order-1 sm:max-h-[460px] sm:w-[72px] sm:flex-col"
            role="tablist"
            aria-label={t("product.productImages")}
          >
            {railImages.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                role="tab"
                onClick={() => onSelectImage(index)}
                onMouseEnter={() => { if (canHover) onSelectImage(index); }}
                aria-label={t(item.kind === "video" ? "product.showVideo" : "product.showImage", { index: index + 1, total: media.length })}
                aria-selected={selectedImageIndex === index}
                className={`pressable grid size-[62px] shrink-0 place-items-center overflow-hidden rounded-xl border-2 bg-white p-1 transition-colors sm:size-[68px] ${selectedImageIndex === index ? "border-[#0a285a]" : "border-[#e2e5eb] hover:border-[#aac0da]"}`}
              >
                {item.kind === "video" ? (
                  <span className="relative grid size-full place-items-center">
                    <Thumb src={item.posterUrl ?? undefined} alt="" className="size-full object-contain" icon={<Play className="size-5 text-[#536b8c]" />} />
                    {/* The marker, not a label: the tab's accessible name
                        already says this one is a video. */}
                    <span aria-hidden className="absolute grid size-6 place-items-center rounded-full bg-[#0a285a]/85 text-white">
                      <Play className="size-3 fill-current" />
                    </span>
                  </span>
                ) : (
                  <Thumb src={item.url} alt="" className="size-full object-contain" />
                )}
              </button>
            ))}
            {overflow > 0 ? (
              <button onClick={onZoom} aria-label={t("product.viewAllImages", { count: media.length })} className="pressable grid size-[62px] shrink-0 place-items-center rounded-xl border-2 border-[#e2e5eb] bg-[#0a285a] text-white hover:border-[#aac0da] sm:size-[68px]">
                <span className="text-base font-extrabold leading-none">+{overflow}</span>
                <span className="text-[9px] font-bold leading-none">{t("home.viewAll")}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="relative order-1 min-w-0 flex-1 sm:order-2">
          <div
            onPointerMove={trackLens}
            onPointerLeave={() => { setLens(null); swipeStart.current = null; }}
            onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; }}
            onPointerUp={endSwipe}
            onPointerCancel={() => { swipeStart.current = null; }}
            className="relative flex h-[340px] touch-pan-y items-center justify-center overflow-hidden rounded-[1.25rem] border border-[#e2e5eb] bg-white p-5 sm:h-[460px] sm:p-6"
          >
            {isVideo ? (
              /* `controls` rather than a bespoke player: the browser's own is
                 keyboard-operable, captioned-capable and familiar, and a
                 hand-rolled one would have to earn all three back. No autoplay
                 — sound starting by itself on a product page is the reason
                 people mute tabs. `preload="metadata"` fetches the duration
                 and not the clip, since most shoppers never press play. */
              <video
                key={image.url}
                src={image.url}
                poster={image.posterUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                aria-label={image.altText ?? product.title}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <Thumb
                src={image?.url}
                alt={image?.altText ?? product.title}
                priority
                draggable={false}
                className="max-h-full max-w-full object-contain"
                icon={<PackageOpen className="size-24 text-[#e2e5f1]" />}
              />
            )}
            {lens && image && !isVideo ? (
              /* Physical `left`/`top`, deliberately: these are measured from
                 `getBoundingClientRect`, which is physical in both directions,
                 so a logical property here would mirror a number that has
                 already accounted for the mirroring. */
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-sg border-2 border-[#0a285a]/35 bg-[#0a285a]/8"
                style={{ left: lens.left, top: lens.top, width: lens.width, height: lens.height }}
              />
            ) : null}
            {hasMultipleImages ? (
              <span className="pointer-events-none absolute bottom-3 start-3 rounded-full bg-[#0a285a]/85 px-2.5 py-1 text-[11px] font-bold text-white" aria-live="polite">
                <span dir="ltr">{selectedImageIndex + 1} / {media.length}</span>
              </span>
            ) : null}
          </div>

          <div className="absolute end-3 top-3 flex flex-col gap-2">
            <button onClick={onShare} aria-label={t("product.share", { name: product.title })} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:text-[#a44a2b]"><Share2 className="size-[18px]" /></button>
            <button onClick={onToggleSaved} aria-pressed={isSaved} aria-label={t(isSaved ? "product.removeSaved" : "product.save", { name: product.title })} className="pressable grid size-10 place-items-center rounded-full bg-white shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:text-[#e61c38]"><Heart className={`size-[18px] ${isSaved ? "fill-[#e61c38] text-[#e61c38]" : "text-[#0a285a]"}`} /></button>
            <button onClick={onZoom} aria-label={t("product.openViewer")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:text-[#a44a2b]"><ZoomIn className="size-[18px]" /></button>
          </div>

          {hasMultipleImages ? <>
            {/* Both directions on touch. The rail is the only other way back,
                and on a phone it is a scrolled strip rather than a full list. */}
            <button onClick={() => onChangeImage("previous")} aria-label={t("product.prevImage")} className={`${arrow} start-3 sm:hidden`}><ChevronLeft className="size-6 rtl:-scale-x-100" strokeWidth={2.3} /></button>
            <button onClick={() => onChangeImage("next")} aria-label={t("product.nextImage")} className={`${arrow} end-3`}><ChevronRight className="size-6 rtl:-scale-x-100" strokeWidth={2.3} /></button>
          </> : null}

          {lens && image ? (
            <div
              aria-hidden
              className="pointer-events-none absolute start-[calc(100%+1rem)] top-0 z-30 hidden overflow-hidden rounded-[1.25rem] border border-[#e2e5eb] bg-white bg-no-repeat shadow-[0_18px_50px_rgba(10,40,90,.18)] lg:block"
              style={{
                width: LENS_PANE_WIDTH,
                height: lens.paneHeight,
                backgroundImage: `url("${image.url}")`,
                /* Pixels off the picture's own size, so the zoomed copy keeps
                   its aspect ratio. As a percentage this resolved against the
                   pane and stretched each axis to fit it. */
                backgroundSize: `${lens.bgWidth}px ${lens.bgHeight}px`,
                backgroundPosition: `${lens.bgX}px ${lens.bgY}px`,
              }}
            />
          ) : null}
        </div>
      </div>

      {hasMultipleImages ? <p className="mt-3 text-[11px] font-semibold ink-muted">{t(canHover ? "product.galleryHintHover" : "product.galleryHintTouch")}</p> : null}
    </div>
  );
}

/**
 * The seller's trust badges, beside their name.
 *
 * `visibleBadges` filters rather than trusting the payload: an unknown badge
 * would otherwise render as a raw key, and a shopper reading "topSeller" in a
 * pill learns nothing and sees a bug.
 */
function VendorBadges({ badges }: { badges: string[] }) {
  const { t } = useTranslation();
  const shown = visibleBadges(badges);
  if (!shown.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shown.map(badge => (
        <span
          key={badge}
          className="rounded-full bg-[#eaf1fb] px-2 py-0.5 text-[10px] font-extrabold text-[#0a285a]"
        >
          {t(`badge.${badge}` as MessageKey)}
        </span>
      ))}
    </span>
  );
}

function StarRating({ value, scaleMax, count }: { value: number; scaleMax: number; count: number | null }) {
  const { t } = useTranslation();
  const label = count === null
    ? t("product.ratingAria", { value, max: scaleMax })
    : t("product.ratingAriaCount", { value, max: scaleMax, count });
  return (
    <div className="mt-3 flex items-center gap-2 text-sm" aria-label={label}>
      <Star className="size-4 fill-[#ffb800] text-[#ffb800]" aria-hidden />
      <strong className="font-extrabold text-[#1f2229]">{value}</strong>
      {count === null ? null : <span className="ink-muted">({count === 1 ? t("product.reviewOne") : t("product.reviews", { count })})</span>}
    </div>
  );
}

function SpecificationsPanel({ product, t }: { product: Product; t: Translate }) {
  const { rows, text } = specifications(product);
  if (!rows.length && !text) return <p className="text-sm leading-7 ink-muted">{t("product.noSpecs")}</p>;
  return (
    <div className="space-y-3">
      {rows.length ? (
        <dl className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} dir="auto" className="text-sm leading-6">
              <dt className="inline font-bold text-[#1f2229]">{row.label}: </dt>
              <dd className="inline text-[#404553]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {/* Pre-wrapped: a spec block written into the description keeps one line
          per specification, which is how it reads in the admin. */}
      {text ? <p dir="auto" className="text-sm leading-7 whitespace-pre-wrap text-[#404553]">{text}</p> : null}
    </div>
  );
}

/**
 * One row of a policy list. The three panels differ in content, not in shape.
 */
function PolicyRows({ rows, t }: { rows: readonly PolicyRow[]; t: Translate }) {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.title} className="flex items-start gap-3.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]"><row.icon className="size-4" /></span>
          <div>
            <strong className="block text-sm font-bold text-[#1f2229]">{t(row.title)}</strong>
            <span className="text-[13px] leading-[1.55] text-[#404553]">{t(row.body)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What the seller promised, and what NetLet covers regardless.
 *
 * The merchant's own term leads when there is one, shown as they typed it and
 * attributed to them — "12 months" from a seller and NetLet's buyer protection
 * are different promises from different parties, and merging them into one
 * sentence would leave a shopper unable to tell who they are owed by. When the
 * seller recorded nothing the panel says exactly that rather than inventing a
 * default, which is the same rule the store-details page follows: report what
 * is absent instead of guessing at it.
 */
function WarrantyPanel({ product, t }: { product: Product; t: Translate }) {
  const stated = merchantWarranty(product.attributes);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]"><ShieldCheck className="size-4" /></span>
        <div>
          <strong className="block text-sm font-bold text-[#1f2229]">{t("warranty.seller.title")}</strong>
          {stated
            ? <span dir="auto" className="block text-[13px] leading-[1.55] text-[#404553]">{t("warranty.seller.stated", { value: stated })}</span>
            : <span className="block text-[13px] leading-[1.55] text-[#404553]">{t("warranty.seller.none")}</span>}
        </div>
      </div>
      <PolicyRows rows={WARRANTY_POLICY} t={t} />
    </div>
  );
}

/**
 * The refund window, taken from the constant the server enforces.
 *
 * `RETURN_WINDOW_DAYS` is the same number `shared/commerce/returns.ts` uses to
 * decide whether a return is actually open, so the page cannot promise a
 * fortnight while the API refuses on day eight. The old copy spelled "14 days"
 * into both dictionaries, which meant the policy lived in three places and two
 * of them were prose.
 */
function ReturnsPanel({ t }: { t: Translate }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]"><RotateCcw className="size-4" /></span>
        <div>
          <strong className="block text-sm font-bold text-[#1f2229]">{t("shipping.returns.title")}</strong>
          <span className="text-[13px] leading-[1.55] text-[#404553]">{t("returns.window.body", { days: RETURN_WINDOW_DAYS })}</span>
        </div>
      </div>
      <PolicyRows rows={RETURNS_POLICY} t={t} />
    </div>
  );
}

const RETURNS_POLICY = [
  { icon: PackageOpen, title: "returns.condition.title", body: "returns.condition.body" },
  { icon: Wallet, title: "returns.refund.title", body: "returns.refund.body" },
] as const satisfies readonly PolicyRow[];

function ShippingPolicyPanel({ express, t }: { express: boolean; t: Translate }) {
  const rows = express
    ? [{ icon: Zap, title: "product.expressTitle", body: "shipping.express.body" } as const, ...SHIPPING_POLICY]
    : SHIPPING_POLICY;
  return <PolicyRows rows={rows} t={t} />;
}

export default function ProductDetail() {
  const [, params] = useRoute("/products/:handle");
  const [, navigate] = useLocation();
  const handle = params?.handle ?? "";
  const { data: product, isLoading, error } = trpc.commerce.products.byHandle.useQuery({ handle }, { enabled: Boolean(handle) });
  const { data: catalog = [] } = trpc.commerce.products.list.useQuery({ first: 24 });
  const { addItem, openCart, loading: cartLoading } = useCart();
  const { savedIds, toggleSaved } = useCustomer();
  const { direction, t } = useTranslation();
  const money = useMoney();
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [tab, setTab] = useState<"specifications" | "shipping" | "warranty" | "returns">("specifications");
  const [quantity, setQuantity] = useState(1);
  const [search, setSearch] = useState("");
  const openRelated = (item: Product) => window.location.assign(appPath(`/products/${encodeURIComponent(item.handle)}`));

  // Built before the loading and error returns below, because a hook cannot be
  // called conditionally. While the product is in flight the page describes
  // itself as loading rather than inheriting the last product's title.
  usePageMeta(
    product ? productMeta(product, SITE_URL) : privatePageMeta("Loading"),
    product ? [productJsonLd(product, SITE_URL), breadcrumbJsonLd(product, SITE_URL)] : undefined,
  );

  useEffect(() => {
    setSelectedVariantId(product?.variants[0]?.id ?? "");
    setSelectedImageIndex(0);
    setZoomOpen(false);
    setTab("specifications");
    setQuantity(1);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [product?.id]);

  useEffect(() => {
    const imageCount = product?.images.length ?? 0;
    if (imageCount <= 1) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !canUseGalleryKeyboard(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      // The arrow that means "onward" is the one pointing the way the page
      // reads, so in Arabic the left arrow advances.
      const onward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
      setSelectedImageIndex(current => galleryIndex(current, imageCount, event.key === onward ? "next" : "previous"));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [direction, product?.id, product?.images.length]);

  useEffect(() => {
    if (!zoomOpen) return;
    const closeZoom = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomOpen(false); };
    window.addEventListener("keydown", closeZoom);
    return () => window.removeEventListener("keydown", closeZoom);
  }, [zoomOpen]);

  const selectedVariant = product?.variants.find(variant => variant.id === selectedVariantId) ?? product?.variants[0];
  const related = useMemo(() => product ? relatedProducts(product, catalog) : [], [catalog, product]);
  const isSaved = product ? savedIds.includes(product.id) : false;
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const galleryImageCount = product?.images.length ?? 0;

  const changeImage = (direction: "previous" | "next") => setSelectedImageIndex(current => galleryIndex(current, galleryImageCount, direction));

  /**
   * Choosing a variant shows it. A colour control that does not change the
   * picture is asking the shopper to take the colour on trust, which is the
   * one thing the picture is there for.
   */
  const chooseVariant = (variant: { id: string }) => {
    setSelectedVariantId(variant.id);
    const next = imageIndexForVariant(product!, product!.variants.find(entry => entry.id === variant.id));
    if (next !== null) setSelectedImageIndex(next);
  };
  const addToCart = async () => {
    if (!product || !selectedVariant?.availableForSale) return;
    try {
      await addItem(selectedVariant.id, quantity);
      toast.success(t("cart.addedQuantity", { count: quantity, name: product.title }));
    } catch {
      toast.error(t("cart.addFailed"));
    }
  };
  // The cart drawer lives on the home route, and `isOpen` is held in the cart
  // context above the router — so opening it before navigating carries across.

  if (isLoading) return <main className="min-h-screen bg-background px-4 py-8"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-10 w-32 rounded-full bg-[#e7edf5]" /><div className="mt-8 grid gap-8 lg:grid-cols-2"><div className="aspect-square rounded-[1.5rem] bg-[#e7edf5]" /><div className="space-y-5 pt-7"><div className="h-5 w-24 rounded bg-[#dce5e9]" /><div className="h-16 w-4/5 rounded bg-[#dce5e9]" /><div className="h-20 rounded bg-[#e7edf5]" /></div></div></div></main>;

  if (!product || error) return <main className="min-h-screen bg-background px-4 py-16"><div className="mx-auto max-w-lg rounded-[2rem] border border-[#d5dfeb] bg-[#fffdf9] p-9 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]"><PackageOpen className="size-7" /></div><h1 className="display-face mt-5 text-4xl text-[#0a285a]">{t("product.notFound")}</h1><p className="mt-3 text-sm leading-6 text-[#536b8c]">{t("product.notFoundNote")}</p><Link href="/" className="glass glass-navy pressable mt-7 inline-flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold"><ArrowLeft className="size-4 rtl:-scale-x-100" />{t("product.backToNetlet")}</Link></div></main>;

  const rating = productRating(product.attributes);
  const express = isExpressEligible(product);
  const price = selectedVariant?.price ?? product.priceRange.min;
  const compareAtPrice = selectedVariant?.compareAtPrice ?? null;
  const savings = savingsPercent(price, compareAtPrice);
  const inStock = Boolean(selectedVariant?.availableForSale);

  // The selected tab keeps its navy on hover. `.glass-navy:hover` shifts to
  // orange, which is right for a button you are about to press but wrong for a
  // tab that is already selected — it reads as a second, different control.
  const tabClass = (active: boolean) => `pressable inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-bold whitespace-nowrap transition-colors ${active ? "glass glass-navy hover:!bg-[#0a285a]" : "ink-muted hover:text-[#0a285a]"}`;

  return (
    <main className="min-h-screen bg-background pb-28 text-[#0a285a] lg:pb-14">
      <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openRelated} />

      <div className="container py-6 sm:py-8">
        <nav className="flex flex-wrap items-center gap-x-2 text-[13px] ink-muted" aria-label={t("nav.breadcrumb")}>
          <Link href="/" className="py-1.5 hover:text-[#0a285a]">{t("nav.home")}</Link>
          {product.productType ? <>
            <span aria-hidden>/</span>
            <Link href={`/category/${categorySlug(product.productType)}`} className="py-1.5 hover:text-[#0a285a]">
              {categoryMessageKey(product.productType) ? t(categoryMessageKey(product.productType)!) : product.productType}
            </Link>
          </> : null}
          <span aria-hidden>/</span>
          <span className="text-[#404553]">{product.title}</span>
        </nav>

        <section id="main" className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <ProductGallery product={product} selectedImageIndex={selectedImageIndex} onSelectImage={setSelectedImageIndex} onChangeImage={changeImage} onZoom={() => setZoomOpen(true)} onShare={() => void shareProduct(product, t)} onToggleSaved={() => toggleSaved(product.id)} isSaved={isSaved} />

          <div className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-6 shadow-[0_8px_32px_rgba(10,40,90,.05)] sm:p-7">
            {product.vendor ? (
              <div className="flex flex-wrap items-center gap-2">
                <p dir="auto" className="text-xs font-bold tracking-[.5px] ink-muted uppercase">{product.vendor}</p>
                <VendorBadges badges={product.vendorBadges} />
              </div>
            ) : null}
            {selectedVariant?.sku ? <p className="mt-3 text-sm font-medium ink-muted">{t("product.sku")}: <span dir="ltr" className="ink-muted">{selectedVariant.sku}</span></p> : null}
            {product.productType ? <p className="mt-2 text-sm font-medium ink-muted">{t("product.category")}: <span className="ink-muted">{product.productType}</span></p> : null}

            <h1 className="mt-2 text-[26px] leading-[1.3] font-extrabold tracking-[-.02em] text-[#1f2229]">{product.title}</h1>

            {rating ? <StarRating value={rating.value} scaleMax={rating.scaleMax} count={rating.count} /> : null}

            {express ? <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f2683a] px-3 py-1 text-xs font-bold text-white"><Zap className="size-3.5 fill-current" />{t("product.expressTitle")}</p> : null}

            <div className="mt-5 flex flex-wrap items-baseline gap-3">
              <span className="text-[32px] font-extrabold tracking-[-.04em] text-[#1f2229]">{money(price)}</span>
              {compareAtPrice ? <span className="text-lg ink-muted line-through">{money(compareAtPrice)}</span> : null}
              {savings > 0 ? <span className="rounded-sg bg-[#d4edda] px-2.5 py-1 text-xs font-bold text-[#155724]">{t("product.savePercent", { percent: savings })}</span> : null}
            </div>

            {/* The per-kilo figure, when there is one. Nothing for a counted
                product — "per each" is the price printed twice. */}
            {selectedVariant ? <UnitPrice variant={selectedVariant} className="mt-1 text-sm" /> : null}

            <hr className="my-6 border-[#0a285a]/8" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* One component for all three answers, shared with the card and
                  Quick View so they cannot disagree about the same variant.
                  This also retired the last `#28a745` in the storefront: 3.13:1
                  on pearl, where everything else had already taken the
                  darkening to #2f5d33. */}
              <AvailabilityLine variant={selectedVariant} />
              <div role="tablist" aria-label={t("product.information")} className="hide-scrollbar inline-flex gap-1 overflow-x-auto rounded-xl border border-[#0a285a]/8 bg-white/50 p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,.7)] max-sm:w-full">
                {/* Four tabs will not divide a phone's width into anything
                    readable, so below `sm` the row scrolls instead of each tab
                    taking a quarter and clipping its own label. */}
                <button role="tab" id="tab-specifications" aria-selected={tab === "specifications"} aria-controls="panel-specifications" onClick={() => setTab("specifications")} className={tabClass(tab === "specifications")}><ListTree className="size-3.5 shrink-0" />{t("product.specifications")}</button>
                <button role="tab" id="tab-shipping" aria-selected={tab === "shipping"} aria-controls="panel-shipping" onClick={() => setTab("shipping")} className={tabClass(tab === "shipping")}><Truck className="size-3.5 shrink-0" />{t("product.shippingPolicy")}</button>
                <button role="tab" id="tab-warranty" aria-selected={tab === "warranty"} aria-controls="panel-warranty" onClick={() => setTab("warranty")} className={tabClass(tab === "warranty")}><ShieldCheck className="size-3.5 shrink-0" />{t("product.warrantyPolicy")}</button>
                <button role="tab" id="tab-returns" aria-selected={tab === "returns"} aria-controls="panel-returns" onClick={() => setTab("returns")} className={tabClass(tab === "returns")}><RotateCcw className="size-3.5 shrink-0" />{t("product.returnsPolicy")}</button>
              </div>
            </div>

            <div className="mt-5 min-h-[120px]">
              <div role="tabpanel" id="panel-specifications" aria-labelledby="tab-specifications" hidden={tab !== "specifications"}><SpecificationsPanel product={product} t={t} /></div>
              <div role="tabpanel" id="panel-shipping" aria-labelledby="tab-shipping" hidden={tab !== "shipping"}><ShippingPolicyPanel express={express} t={t} /></div>
              <div role="tabpanel" id="panel-warranty" aria-labelledby="tab-warranty" hidden={tab !== "warranty"}><WarrantyPanel product={product} t={t} /></div>
              <div role="tabpanel" id="panel-returns" aria-labelledby="tab-returns" hidden={tab !== "returns"}><ReturnsPanel t={t} /></div>
            </div>

            {/* Under the tabs, because it answers what the tabs did not: a
                spec block is written for somebody who already knows the
                category. */}
            <ProductAssistant handle={product.handle} />

            <VariantPicker product={product} selected={selectedVariant} onSelect={chooseVariant} />

            <div className="mt-6 flex items-center gap-3">
              <span className="text-sm font-semibold ink-muted">{t("product.quantity")}:</span>
              {/* The shared control: the card grew the same thing, and two
                  copies is how one clamps at 1 and the other at 0. */}
              <QuantityStepper value={quantity} onChange={setQuantity} disabled={cartLoading} />
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => void addToCart()} disabled={!inStock || cartLoading} className="glass glass-navy pressable flex flex-1 items-center justify-center gap-2 rounded-[14px] px-5 py-4 text-[15px] font-bold tracking-[.02em] uppercase disabled:cursor-not-allowed disabled:opacity-50">{cartLoading ? <LoaderCircle className="size-[18px] animate-spin" /> : <ShoppingBag className="size-[18px]" />}{t(buyLabelFor(selectedVariant))}</button>
              <button onClick={() => toggleSaved(product.id)} aria-label={t(isSaved ? "product.removeSaved" : "product.save", { name: product.title })} aria-pressed={isSaved} className="glass pressable grid w-14 place-items-center rounded-[14px] text-[#e61c38]"><Heart className={`size-5 ${isSaved ? "fill-current" : ""}`} /></button>
            </div>

            {selectedVariant?.preorder
              ? <p className="mt-3 text-[13px] leading-5 ink-muted">{t("product.preorderNote")}</p>
              : null}

            <div className="mt-3"><FollowProduct product={product} compact /></div>


            {express ? <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold ink-muted"><BadgeCheck className="size-3.5" />{t("product.expressNote")}</p> : null}
          </div>
        </section>

        {/*
          Complements before reviews, reviews before "keep discovering".
          Somebody on this page has largely decided: the case that goes with
          the phone is the most useful next thing, what other buyers said is
          the second, and four more products to consider instead is the least.
        */}
        <BoughtTogether
          productId={product.id}
          saved={savedIds}
          onSave={id => toggleSaved(id)}
          onDetails={item => navigate(`/products/${encodeURIComponent(item.handle)}`)}
          onQuickView={setQuickProduct}
          onAdd={(item, quantity) => { const variant = item.variants.find(v => v.availableForSale); if (variant) void addItem(variant.id, quantity); }}
          onBuyNow={(item, quantity) => { const variant = item.variants.find(v => v.availableForSale); if (variant) void addItem(variant.id, quantity).then(openCart); }}
          isAdding={cartLoading}
        />

        <div className="mt-14">
          <ProductReviews productId={product.id} productTitle={product.title} />
        </div>

        <section className="mt-14 border-t border-[#d5dfeb] pt-10"><div className="flex items-end justify-between gap-5"><div><p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("product.keepDiscovering")}</p><h2 className="display-face mt-2 text-3xl text-[#0a285a] sm:text-4xl">{t("product.relatedTitle")}</h2><p className="mt-2 text-sm text-[#536b8c]">{t("product.relatedNote")}</p></div><Link href="/" className="hidden items-center gap-1 text-xs font-extrabold text-[#0a285a] underline decoration-[#f2683a] decoration-2 underline-offset-4 sm:flex">{t("home.viewAll")} <ArrowRight className="size-3.5 rtl:-scale-x-100" /></Link></div>{related.length ? <div className="hide-scrollbar mt-6 flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:overflow-visible">{related.map(item => <RelatedCard key={item.id} product={item} />)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-10 text-center"><p className="text-sm font-bold text-[#0a285a]">{t("product.relatedEmpty")}</p><Link href="/" className="mt-3 inline-block text-xs font-extrabold ink-accent underline underline-offset-4">{t("product.browseCatalog")}</Link></div>}</section>
      </div>
      <MobileTabBar />
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
      {zoomOpen ? <ImageLightbox product={product} selectedImageIndex={selectedImageIndex} onClose={() => setZoomOpen(false)} onSelectImage={setSelectedImageIndex} onChangeImage={changeImage} /> : null}
    </main>
  );
}
