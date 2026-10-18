import { BUTTON_PRIMARY, Breadcrumbs, PageBody, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar } from "@/components/layout/PhoneActionBar";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ZoomViewer } from "@/components/product/ZoomViewer";
import { usePageChrome } from "@/components/layout/StorefrontShell";
import { briefFor } from "@shared/commerce/assistant";
import { useCart } from "@/contexts/CartContext";
import { useCatalog, useProductByHandle } from "@/hooks/useCatalog";
import { SizeGuide } from "@/components/product/SizeGuide";
import { TryOn } from "@/components/product/TryOn";
import { SubscribePanel } from "@/components/product/SubscribePanel";
import { ProductReviews } from "@/components/product/ProductReviews";
import { BoughtTogether } from "@/components/product/BoughtTogether";
import { ProductAssistant } from "@/components/product/ProductAssistant";
import { PriceOfferPanel } from "@/components/product/PriceOfferPanel";
import { ProductInfo } from "@/components/product/ProductInfo";
import { AskSeller } from "@/components/product/AskSeller";
import { DeliverySpeedLine } from "@/components/product/DeliverySpeedLine";
import { UnitPrice } from "@/components/product/UnitPrice";
import { AvailabilityLine, buyLabelFor } from "@/components/product/Availability";
import { AddonPicker } from "@/components/product/AddonPicker";
import { BundleOffer } from "@/components/product/BundleOffer";
import { QuickView } from "@/components/product/QuickView";
import { useCustomer } from "@/contexts/CustomerContext";
import { Thumb } from "@/components/product/Thumb";
import { QuantityStepper } from "@/components/cart/QuantityStepper";
import { PURCHASE_TONE } from "@/lib/purchaseStyle";
import { useOverlay } from "@/hooks/useOverlay";
import { SITE_URL, usePageMeta } from "@/hooks/usePageMeta";
import { breadcrumbJsonLd, privatePageMeta, productJsonLd, productMeta } from "@shared/seo";
import { trpc } from "@/lib/trpc";
import { canUseGalleryKeyboard, galleryIndex, galleryOf } from "@shared/commerce/gallery";
import {
  isExpressEligible,
  productRating,
  savingsPercent,
  merchantWarranty,
  specifications,
} from "@shared/commerce/productDetail";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { relatedProducts } from "@shared/commerce/related";
import { descriptionBlocks } from "@shared/commerce/productDetail";
import { categorySlug } from "@shared/commerce/browse";
import { categoryMessageKey } from "@/content/homeLayout";
import type { Product } from "@shared/commerce/types";
import { visibleBadges } from "@shared/inventory/vendorHealth";
import { ArrowLeft, BadgeCheck, ChevronLeft, ChevronRight, Heart, ListTree, LoaderCircle, PackageOpen, Play, RotateCcw, Share2, ShieldCheck, ShoppingBag, Star, Tag, Truck, Wallet, Wrench, X, Zap, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { useMoney, useTranslation, type Translate } from "@/hooks/useTranslation";
import { ProductCard, shareProduct } from "@/components/product/ProductCard";
import { VariantPicker, imageIndexForVariant } from "@/components/product/VariantPicker";
import { FollowProduct } from "@/components/product/FollowProduct";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useFeature } from "@/hooks/useFeature";
import { useMembership } from "@/hooks/useMembership";

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

/** How far one arrow press moves a zoomed picture, in px. */
const PAN_STEP = 60;

type ViewerProps = {
  product: Product;
  selectedImageIndex: number;
  onClose: () => void;
  onSelectImage: (index: number) => void;
  onChangeImage: (direction: "previous" | "next") => void;
};

/**
 * The product's photos, opened from the product page: a press on the photo,
 * the magnifier, or "+N" on the rail.
 *
 * Two shapes, one at a time (`useMediaQuery`, never both with one hidden). A
 * wide screen keeps the grid beside a large stage with step zoom. Below `lg`
 * it is `PhotoSheet` — every photo large, one under another, and a press on
 * one opens it full screen to pinch and pan (`ZoomViewer`), on the owner's
 * word: a phone's stage with two small zoom buttons was a desk's viewer
 * squeezed onto a screen a thumb works.
 */
function ImageLightbox(props: ViewerProps) {
  const wide = useMediaQuery("(min-width: 1024px)");
  return wide ? <WideImageViewer {...props} /> : <PhotoSheet {...props} />;
}

/**
 * A phone's "Images": every photo of the product, the width of the screen and
 * square, one under another, opening at the one the shopper was looking at.
 * Square frames, so a photo further up that has not loaded yet cannot push
 * the one on screen down when it does. A video plays where it is; a photo is
 * a button that opens it full screen, and closing that comes back here with
 * the same photo in view and focus on it.
 */
function PhotoSheet({ product, selectedImageIndex, onClose, onSelectImage }: ViewerProps) {
  const { t } = useTranslation();
  useOverlay(true, onClose);
  const closeButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [full, setFull] = useState(false);
  const media = galleryOf(product);
  useEffect(() => {
    closeButton.current?.focus();
    list.current?.children[selectedImageIndex]?.scrollIntoView({ block: "start", behavior: "instant" });
    /* Once, on opening: the list does not follow the main photo afterwards. */
  }, []);
  /* Back from full screen, the photo last looked at is the one in view and
     the one with focus — it may not be the one pressed, if the shopper swiped
     along. Said here rather than left to the viewer's own return of focus,
     because a phone does not focus a button it taps, so what the viewer saw
     focused when it opened was not the photo. */
  const wasFull = useRef(false);
  useEffect(() => {
    if (full) { wasFull.current = true; return; }
    if (!wasFull.current) return;
    const row = list.current?.children[selectedImageIndex];
    row?.scrollIntoView({ block: "nearest", behavior: "instant" });
    row?.querySelector<HTMLElement>("button, video")?.focus({ preventScroll: true });
  }, [full]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#f7f7f5]" role="dialog" aria-modal="true" aria-label={t("product.allImages", { name: product.title })}>
      <div className="flex items-center justify-between gap-3 border-b border-[#e6e9ef] bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-[#0a285a]">{t("product.images")}</h2>
          <p dir="auto" className="truncate text-[13px] ink-muted">{product.title}</p>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={t("product.closeViewer")} className="grid size-11 shrink-0 place-items-center rounded-full text-[#404553] hover:bg-[#0a285a]/[.06]">
          <X className="size-6" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="mb-3 text-[13px] font-semibold ink-muted">{t("product.photosHint")}</p>
        <ul ref={list} className="space-y-3">
          {media.map((item, index) => (
            <li key={`${item.url}-${index}`} className="scroll-mt-3">
              {item.kind === "video" ? (
                <div className="overflow-hidden rounded-2xl border border-[#e2e5eb] bg-white">
                  <video src={item.url} poster={item.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label={item.altText ?? product.title} className="aspect-square w-full bg-black object-contain" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { onSelectImage(index); setFull(true); }}
                  aria-label={t("product.openPhoto", { index: index + 1, total: media.length })}
                  className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl border border-[#e2e5eb] bg-white p-4"
                >
                  <Thumb src={item.url} alt={item.altText ?? product.title} eager={index === selectedImageIndex} draggable={false} className="size-full object-contain" />
                  <span aria-hidden className="absolute bottom-2.5 end-2.5 flex items-center gap-1.5 rounded-full bg-[#0a285a]/85 px-2.5 py-1 text-[12px] font-bold text-white">
                    <ZoomIn className="size-3.5" />
                    <bdi dir="ltr">{index + 1} / {media.length}</bdi>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {full ? (
        <ZoomViewer items={media} index={selectedImageIndex} title={product.title} onIndex={onSelectImage} onClose={() => setFull(false)} />
      ) : null}
    </div>
  );
}

/**
 * Full-screen viewer: every image as a grid on the left, the selected one large
 * on the right, with step zoom. This is the "inspect it properly" surface — the
 * hover lens is for a glance, this is for deciding.
 */
function WideImageViewer({ product, selectedImageIndex, onClose, onSelectImage, onChangeImage }: {
  product: Product;
  selectedImageIndex: number;
  onClose: () => void;
  onSelectImage: (index: number) => void;
  onChangeImage: (direction: "previous" | "next") => void;
}) {
  const { direction, t } = useTranslation();
  const closeButton = useRef<HTMLButtonElement | null>(null);
  /*
   * The full-screen viewer is a modal, so it owes what every other one here
   * does. It had re-derived exactly one of the three: Escape closed it, the
   * page behind went on scrolling, and closing dropped the keyboard on
   * `<body>` — the shopper tabbing back through the whole header to reach the
   * product they were looking at, which is the failure `useOverlay`'s own
   * comment describes.
   *
   * The order of these two matters and is why focus is moved here rather than
   * with `autoFocus`. Effects in one component run in the order they are
   * declared, so `useOverlay` reads `document.activeElement` — still the button
   * that opened this — before anything moves it. React applies `autoFocus`
   * during the commit, which is earlier than either, so the opener it recorded
   * was this dialog's own close button and there was nothing to go back to.
   */
  useOverlay(true, onClose);
  useEffect(() => closeButton.current?.focus(), []);
  const [scale, setScale] = useState(1);
  /* The same list the gallery indexes into, or "image 4" would mean two
     different things on the two surfaces the moment a video is in the set. */
  const media = galleryOf(product);
  const image = media[selectedImageIndex] ?? media[0];
  const isVideo = image?.kind === "video";
  const hasMultipleImages = media.length > 1;
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  /*
   * Panning a zoomed picture.
   *
   * `scale()` does not change an element's layout size, so the stage had
   * nothing to scroll and the magnified image simply hung off the edges with
   * no way to reach them: you could enlarge a rug and never see its corner.
   * The comment below used to claim a drag panned it, which is the kind of
   * note that outlives the behaviour it describes.
   *
   * The offset is carried in the same transform as the scale, and **clamped to
   * the overflow** — a picture can be moved exactly as far as it hangs over
   * the stage and not one pixel further. Letting it go further is how a drag
   * ends with an empty white square and nothing to drag back.
   */
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  /** Whether there is anything to move: a video is played, not panned. */
  const zoomable = scale > 1 && !isVideo;

  /** How far the picture may move before its edge would come inside the stage. */
  const panLimit = (atScale: number) => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (frame.offsetWidth * atScale - stage.clientWidth) / 2),
      y: Math.max(0, (frame.offsetHeight * atScale - stage.clientHeight) / 2),
    };
  };

  const clampPan = (next: { x: number; y: number }, atScale: number) => {
    const limit = panLimit(atScale);
    return {
      x: Math.min(limit.x, Math.max(-limit.x, next.x)),
      y: Math.min(limit.y, Math.max(-limit.y, next.y)),
    };
  };

  /*
   * Zooming re-clamps, because the limits shrink with the scale: an image
   * pushed into its corner at 3x and then zoomed back to 1.5x would otherwise
   * stay off-centre with a band of white beside it.
   */
  const zoomTo = (next: number) => {
    const atScale = Math.min(3, Math.max(1, +next.toFixed(1)));
    setScale(atScale);
    setPan(current => clampPan(current, atScale));
  };

  // A new image at 3x, or held in the corner the last one was dragged to,
  // would drop the shopper somewhere they did not ask to be.
  useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [selectedImageIndex]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    /*
     * Not on a control. The zoom, the arrows and the player all sit inside the
     * stage, and capturing the pointer on their press retargets the click to
     * the stage — so zooming back out stopped working the moment you had
     * zoomed in, which is the only time anybody wants it. Found by pressing the
     * button, not by reading the handler.
     */
    if ((event.target as HTMLElement).closest("button, a, input, video")) return;
    swipeStart.current = { x: event.clientX, y: event.clientY };
    // A secondary button is a context menu, not a drag.
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (scale <= 1 || isVideo) return;
    dragFrom.current = { x: event.clientX, y: event.clientY, pan };
    setDragging(true);
    /* Captured, so a drag that runs off the window still ends here rather than
       leaving the picture stuck to the cursor. */
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (!from) return;
    setPan(clampPan(
      { x: from.pan.x + (event.clientX - from.x), y: from.pan.y + (event.clientY - from.y) },
      scale,
    ));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragFrom.current) {
      dragFrom.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    endSwipe(event);
  };

  const endSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    // Only while un-zoomed: past 1x a drag pans the picture instead.
    if (!start || !hasMultipleImages || scale > 1) return;
    const travelled = event.clientX - start.x;
    if (Math.abs(travelled) < SWIPE_THRESHOLD || Math.abs(travelled) < Math.abs(event.clientY - start.y)) return;
    onChangeImage(swipeDirection(travelled, direction));
  };

  /*
   * The same pan from a keyboard.
   *
   * A region a mouse can drag and a keyboard cannot reach has no way to see
   * the far side of the picture without a pointer — the argument the finance
   * panel's scrolling tables already make. The press is stopped from
   * propagating so the page's own arrow handler does not also change the
   * image underneath the shopper.
   */
  const panByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    const step = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    setPan(current => clampPan({ x: current.x + step[0], y: current.y + step[1] }, scale));
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t("product.allImages", { name: product.title })}>
      <div className="flex items-start justify-between px-6 pt-5">
        <div>
          <h2 className="border-b-2 border-[#0a285a] pb-2 text-lg font-extrabold text-[#0a285a]">{t("product.images")}</h2>
        </div>
        <button ref={closeButton} onClick={onClose} aria-label={t("product.closeViewer")} className="pressable grid size-10 place-items-center rounded-full text-[#404553] hover:bg-[#0a285a]/[.06]"><X className="size-6" /></button>
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
          ref={stageRef}
          /* Focusable and named, so the pan is reachable without a pointer. */
          tabIndex={0}
          role="group"
          aria-label={t("product.imageStage")}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={(event) => { swipeStart.current = null; endDrag(event); }}
          onKeyDown={panByKey}
          /* `touch-none` only once there is something to pan: at 1x the browser
             still owns the vertical scroll and the swipe between images. */
          className={`relative order-1 flex min-h-[46vh] flex-1 items-center justify-center overflow-hidden outline-none lg:order-2 lg:min-h-[320px] ${
            zoomable ? (dragging ? "cursor-grabbing touch-none" : "cursor-grab touch-none") : "touch-pan-y"
          }`}
        >
          {/* The frame carries the transform and is measured for the clamp:
              its layout size is the picture's own, which `scale()` leaves
              alone. */}
          <div
            ref={frameRef}
            className="flex max-h-full max-w-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              /* No easing while a finger or a cursor is on it: a 200ms
                 transition on every pointer move is a picture that lags
                 behind the hand moving it. */
              transition: dragging ? "none" : "transform 200ms",
            }}
          >
            {isVideo ? (
              /* The browser's own player, as on the product page — the viewer
                 used to hand a video URL to an `<img>`, so opening one full
                 screen showed the broken-picture fallback. */
              <video
                src={image?.url}
                poster={image?.posterUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              /* Not natively draggable: the browser's own image drag would
                 take the gesture and leave a ghost trailing off the stage. */
              <Thumb src={image?.url} alt={image?.altText ?? product.title} priority draggable={false} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          <div className="absolute end-2 top-2 flex flex-col gap-2">
            <button onClick={() => zoomTo(scale + 0.5)} disabled={scale >= 3 || isVideo} aria-label={t("product.zoomIn")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] hover:bg-[#f0f2f5] shadow-[0_2px_10px_rgba(10,40,90,.16)] disabled:opacity-35"><ZoomIn className="size-5" /></button>
            <button onClick={() => zoomTo(scale - 0.5)} disabled={scale <= 1 || isVideo} aria-label={t("product.zoomOut")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] hover:bg-[#f0f2f5] shadow-[0_2px_10px_rgba(10,40,90,.16)] disabled:opacity-35"><ZoomOut className="size-5" /></button>
          </div>
          {/* Said once, and only while it applies: a hint that is always on
              screen is one nobody reads by the third product. */}
          {zoomable ? (
            <p className="pointer-events-none absolute start-2 top-2 rounded-full bg-[#0a285a]/85 px-3 py-1 text-[12px] font-bold text-white">
              {t("product.dragToPan")}
            </p>
          ) : null}
          {hasMultipleImages ? <>
            <button onClick={() => onChangeImage("previous")} aria-label={t("product.prevImage")} className="pressable absolute start-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)] hover:bg-[#f0f2f5]"><ChevronLeft className="size-6 rtl:-scale-x-100" /></button>
            <button onClick={() => onChangeImage("next")} aria-label={t("product.nextImage")} className="pressable absolute end-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,.16)] hover:bg-[#f0f2f5]"><ChevronRight className="size-6 rtl:-scale-x-100" /></button>
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#0a285a]/85 px-3 py-1 text-[12px] font-bold text-white" aria-live="polite"><span dir="ltr">{selectedImageIndex + 1} / {media.length}</span></span>
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
  const media = galleryOf(product);
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
    const selected = railRef.current?.querySelector('[aria-current="true"]');
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

  const swiped = useRef(false);
  const endSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    swiped.current = false;
    if (!start || !hasMultipleImages) return;
    const travelled = event.clientX - start.x;
    // Ignore a mostly-vertical drag: that is the page being scrolled.
    if (Math.abs(travelled) < SWIPE_THRESHOLD || Math.abs(travelled) < Math.abs(event.clientY - start.y)) return;
    swiped.current = true;
    onChangeImage(swipeDirection(travelled, direction));
  };
  /*
   * A press on the photo opens the photos, on the owner's word — on a phone,
   * the list of every one, each a press from full screen. On the click, never
   * the finger lifting: a phone sends its click after the lift, so opening on
   * the lift put the list under the finger first and the click opened
   * whichever photo landed there. Not after a swipe, and not on a video,
   * whose own controls take the press.
   */
  const openFromPress = (event: React.MouseEvent<HTMLDivElement>) => {
    if (swiped.current) { swiped.current = false; return; }
    if (isVideo || (event.target as HTMLElement).closest("video")) return;
    onZoom();
  };

  const arrow = "pressable absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_2px_12px_rgba(10,40,90,.18)] sm:size-11";

  return (
    <div className="min-w-0 lg:sticky lg:top-[150px] lg:z-20 lg:self-start">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        {hasMultipleImages ? (
          <div
            ref={railRef}
            className="hide-scrollbar order-2 flex w-full min-w-0 shrink-0 gap-2.5 overflow-auto sm:order-1 sm:max-h-[460px] sm:w-[72px] sm:flex-col"
            role="group"
            aria-label={t("product.productImages")}
          >
            {railImages.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                onClick={() => onSelectImage(index)}
                onMouseEnter={() => { if (canHover) onSelectImage(index); }}
                aria-label={t(item.kind === "video" ? "product.showVideo" : "product.showImage", { index: index + 1, total: media.length })}
                aria-current={selectedImageIndex === index}
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
            onClick={openFromPress}
            className={`relative flex h-[340px] touch-pan-y items-center justify-center overflow-hidden rounded-[1.25rem] border border-[#e2e5eb] bg-white p-5 sm:h-[460px] sm:p-6 ${isVideo ? "" : "cursor-zoom-in"}`}
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
              <span className="pointer-events-none absolute bottom-3 start-3 rounded-full bg-[#0a285a]/85 px-2.5 py-1 text-[12px] font-bold text-white" aria-live="polite">
                <span dir="ltr">{selectedImageIndex + 1} / {media.length}</span>
              </span>
            ) : null}
          </div>

          <div className="absolute end-3 top-3 flex flex-col gap-2">
            <button onClick={onShare} aria-label={t("product.share", { name: product.title })} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] hover:bg-[#f0f2f5] shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:text-[#a44a2b]"><Share2 className="size-[18px]" /></button>
            <button onClick={onToggleSaved} aria-pressed={isSaved} aria-label={t(isSaved ? "product.removeSaved" : "product.save", { name: product.title })} className="pressable grid size-10 place-items-center rounded-full bg-white shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:bg-[#f0f2f5] hover:text-[#e61c38]"><Heart className={`size-[18px] ${isSaved ? "fill-[#e61c38] text-[#e61c38]" : "text-[#0a285a]"}`} /></button>
            <button onClick={onZoom} aria-label={t("product.openViewer")} className="pressable grid size-10 place-items-center rounded-full bg-white text-[#0a285a] hover:bg-[#f0f2f5] shadow-[0_2px_10px_rgba(10,40,90,.14)] hover:text-[#a44a2b]"><ZoomIn className="size-[18px]" /></button>
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

      {hasMultipleImages ? <p className="mt-3 text-[12px] font-semibold ink-muted">{t(canHover ? "product.galleryHintHover" : "product.galleryHintTouch")}</p> : null}
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
          className="rounded-full bg-[#eaf1fb] px-2 py-0.5 text-[11px] font-extrabold text-[#0a285a]"
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

/** A seller's description, with their dashed lines drawn as a list (`descriptionBlocks`). */
function DescriptionText({ text }: { text: string }) {
  return (
    <div dir="auto" className="space-y-3 text-sm leading-7 text-[#404553]">
      {descriptionBlocks(text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index} className="whitespace-pre-line">{block.text}</p>
        ) : (
          <ul key={index} className="list-disc space-y-1 ps-5 marker:text-[#0a285a]/40">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {item.label ? <strong className="font-semibold text-[#1f2229]">{item.label}: </strong> : null}
                {item.text}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function SpecificationsPanel({ product, t, arabic }: { product: Product; t: Translate; arabic: boolean }) {
  const { rows, text } = specifications(product, { arabic });
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
      {text ? <DescriptionText text={text} /> : null}
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
 * `RETURN_WINDOW_DAYS` is the same number `Shared/commerce/returns.ts` uses to
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

/** The values a product's variants carry on one option axis. */
function sizesOn(product: Product, axis: string): string[] {
  return [...new Set(product.variants.flatMap(variant => variant.selectedOptions.filter(option => option.name === axis).map(option => option.value)))];
}

/**
 * The variant to pick for a size: the one matching the current choice on
 * every other axis — the same colour in the new size — and in stock if one is.
 */
function variantForSize(product: Product, axis: string, size: string, current: Product["variants"][number] | undefined) {
  const others = (current?.selectedOptions ?? []).filter(option => option.name !== axis);
  const matches = product.variants.filter(variant =>
    variant.selectedOptions.some(option => option.name === axis && option.value.toLowerCase() === size.toLowerCase()));
  const sameOthers = matches.filter(variant => others.every(other => variant.selectedOptions.some(option => option.name === other.name && option.value === other.value)));
  const pool = sameOthers.length ? sameOthers : matches;
  return pool.find(variant => variant.availableForSale) ?? pool[0];
}

export default function ProductDetail() {
  const [, params] = useRoute("/products/:handle");
  const [, navigate] = useLocation();
  const handle = params?.handle ?? "";
  const { data: product, isLoading, error } = useProductByHandle(handle);
  const { data: catalog = [] } = useCatalog(24);
  const { addItem, loading: cartLoading, cart, openCart } = useCart();
  const { savedIds, toggleSaved, deliveryZone } = useCustomer();
  const { direction, t, isArabic: isArabicPage } = useTranslation();
  const deliveryArea = deliveryZone ? (isArabicPage ? deliveryZone.labelAr : deliveryZone.label) : null;
  /* Both are switchable (2.3); the server refuses either way, this only stops offering it. */
  const offersOn = useFeature("priceOffers");
  const chatOn = useFeature("chat");
  const money = useMoney();
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  /* Nothing ticked by default (3.1.2): a pre-ticked warranty is how somebody
     pays for what they did not ask for and did not notice. */
  const [chosenAddons, setChosenAddons] = useState<string[]>([]);
  /* The phone's buy bar appears once the page's own buttons have scrolled away
     above the screen — never while they are in view, never before reaching
     them (`useBeyondScreen`, the rule the cart and checkout bars share). */
  const [buyRef, buyPassed] = useBeyondScreen("top");
  /* The department row marks the product's own department, and the shop
     assistant answers about this product — its public listing, nothing else. */
  const assistantProduct = useMemo(() => (product ? { key: product.id, brief: briefFor(product), image: product.images[0]?.url ?? null } : null), [product]);
  usePageChrome({ activeDepartment: product?.productType ?? null, assistantProduct });

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
    setQuantity(1);
  }, [product?.id]);

  useEffect(() => {
    /* The gallery, not the photographs: with a video in the set these two
       differ by one, and the arrows would wrap short of the clip. */
    const imageCount = product ? galleryOf(product).length : 0;
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
  }, [direction, product?.id, product?.media.length, product?.images.length]);

  const selectedVariant = product?.variants.find(variant => variant.id === selectedVariantId) ?? product?.variants[0];
  const related = useMemo(() => product ? relatedProducts(product, catalog) : [], [catalog, product]);
  const isSaved = product ? savedIds.includes(product.id) : false;
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  /* Before any early return, like every hook. */
  const { member } = useMembership();
  const galleryImageCount = product ? galleryOf(product).length : 0;

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
  /* The bag drawer opening is the confirmation, and the header's count hops:
     the "added to your cart" toast that said it a third time is gone, on the
     owner's word. A failure still says so. */
  const addToCart = async () => {
    if (!product || !selectedVariant?.availableForSale) return;
    try {
      await addItem(selectedVariant.id, quantity, true, chosenAddons);
    } catch {
      toast.error(t("cart.addFailed"));
    }
  };
  /*
   * Buy now (3.2.9): the same choice as Add to cart sent to the other
   * destination — the bag is skipped, not the basket. The bag drawer is not
   * revealed on the way past, and the move is in-app rather than a reload, so
   * the press lands on checkout with the item already in it.
   */
  const buyNow = async () => {
    if (!product || !selectedVariant?.availableForSale) return;
    try {
      await addItem(selectedVariant.id, quantity, false, chosenAddons);
      navigate("/checkout");
    } catch {
      toast.error(t("cart.buyFailed"));
    }
  };
  // The cart drawer lives on the home route, and `isOpen` is held in the cart
  // context above the router — so opening it before navigating carries across.

  /* Under the shop's own header, which stays: only the page waits. Rarely
     seen — a card's shelf already holds the product (`useProductByHandle`). */
  if (isLoading) return (
    <PageBody>
      <div className="animate-pulse" aria-hidden>
        <div className="h-4 w-48 rounded bg-[#e9edf3]" />
        <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="aspect-square rounded-2xl bg-[#e9edf3]" />
          <div className="space-y-4 pt-4">
            <div className="h-4 w-28 rounded-2xl bg-[#e9edf3]" />
            <div className="h-9 w-4/5 rounded-2xl bg-[#e9edf3]" />
            <div className="h-7 w-32 rounded-2xl bg-[#e9edf3]" />
            <div className="h-12 rounded-2xl bg-[#e9edf3]" />
            <div className="h-12 rounded-2xl bg-[#e9edf3]" />
          </div>
        </div>
      </div>
    </PageBody>
  );

  if (!product || error) return (
    <PageBody>
      <PageHeading title={t("product.notFound")} note={t("product.notFoundNote")} />
      <Link href="/" className={BUTTON_PRIMARY}><ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("product.backToNetlet")}</Link>
    </PageBody>
  );

  const rating = productRating(product.attributes);
  const express = isExpressEligible(product);
  const price = selectedVariant?.price ?? product.priceRange.min;
  const compareAtPrice = selectedVariant?.compareAtPrice ?? null;
  const savings = savingsPercent(price, compareAtPrice);
  const inBag = selectedVariant ? (cart?.items ?? []).filter(item => item.variantId === selectedVariant.id).reduce((total, item) => total + item.quantity, 0) : 0;
  const inStock = Boolean(selectedVariant?.availableForSale);


  return (
    <>
      <PageBody>
        <Breadcrumbs
          trail={[
            ...(product.productType ? [{
              label: categoryMessageKey(product.productType) ? t(categoryMessageKey(product.productType)!) : product.productType,
              href: `/category/${categorySlug(product.productType)}`,
            }] : []),
            { label: product.title },
          ]}
        />

        <section className="mt-2 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <ProductGallery product={product} selectedImageIndex={selectedImageIndex} onSelectImage={setSelectedImageIndex} onChangeImage={changeImage} onZoom={() => setZoomOpen(true)} onShare={() => void shareProduct(product, t)} onToggleSaved={() => toggleSaved(product.id)} isSaved={isSaved} />

          {/* `min-w-0`, because a grid item's minimum is its content's: the
              tab strip below, when it scrolled sideways inside itself on a
              phone, still propped this column open by its full width, and
              every product page scrolled sideways — 120px in Arabic, 176px
              in English. A phone draws sections there now; the rule stays
              for whatever is next to be wider than its column. */}
          <div className="min-w-0 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-6 shadow-[0_8px_32px_rgba(10,40,90,.05)] sm:p-7">
            {product.vendor ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* The store's own page, where its other products, its delivery
                    terms and its reviews are. */}
                {product.vendorSlug ? (
                  <Link href={`/stores/${encodeURIComponent(product.vendorSlug)}`} className="text-xs font-bold ink-accent hover:underline">
                    <bdi>{t("browse.soldBy", { name: product.vendor })}</bdi>
                  </Link>
                ) : (
                  <p dir="auto" className="text-xs font-bold ink-muted">{product.vendor}</p>
                )}
                <VendorBadges badges={product.vendorBadges} />
              </div>
            ) : null}
            {selectedVariant?.sku ? <p className="mt-3 text-sm font-medium ink-muted">{t("product.sku")}: <span dir="ltr" className="ink-muted">{selectedVariant.sku}</span></p> : null}
            {product.productType ? <p className="mt-2 text-sm font-medium ink-muted">{t("product.category")}: <span className="ink-muted">{categoryMessageKey(product.productType) ? t(categoryMessageKey(product.productType)!) : product.productType}</span></p> : null}

            <h1 dir="auto" className="mt-2 text-[26px] leading-[1.3] font-extrabold tracking-[-.02em] text-[#1f2229]">{product.title}</h1>

            {rating ? <StarRating value={rating.value} scaleMax={rating.scaleMax} count={rating.count} /> : null}

            {express ? <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f2683a] px-3 py-1 text-xs font-bold text-white"><Zap className="size-3.5 fill-current" />{t("product.expressTitle")}</p> : null}

            <div className="mt-5 flex flex-wrap items-baseline gap-3">
              <span className="text-[32px] font-extrabold tracking-[-.04em] text-[#1f2229]">{money(price)}</span>
              {compareAtPrice ? <span className="text-lg ink-muted line-through">{money(compareAtPrice)}</span> : null}
              {savings > 0 ? <span className="rounded-sg bg-[#d4edda] px-2.5 py-1 text-xs font-bold text-[#155724]">{t("product.savePercent", { percent: savings })}</span> : null}
            </div>

            {/* A member's price (4.1), shown only to a member: a price somebody
                is told about and cannot have is not one to show them. The bag
                and checkout charge it through the same rule. */}
            {member && selectedVariant?.memberPrice ? (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#e7edf5] px-3 py-1 text-[13px] font-extrabold text-[#0a285a]">
                <BadgeCheck className="size-4" aria-hidden />
                {t("membership.yourPrice", { price: money(selectedVariant.memberPrice) })}
              </p>
            ) : null}

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
              {/* Beside availability, because "is it in stock" and "when does
                  it get here" are one question a shopper asks twice. Absent on
                  a pre-order, where the release date is the promise. */}
              {selectedVariant?.preorder
                ? null
                : <DeliverySpeedLine speed={product.deliverySpeed} provider={product.deliveryProvider} area={deliveryArea} className="mt-1.5 text-[13px]" />}
            </div>

            <VariantPicker product={product} selected={selectedVariant} onSelect={chooseVariant} />
            {/* Beside the picker it answers (3.1.20): which size is a question
                asked while choosing one. */}
            {/* The fitting and the try-on (3.1.8) side by side: two ways of
                asking "will this suit me" while choosing. Each draws itself
                only where it applies. */}
            <div className="flex flex-wrap gap-x-5">
              {product.sizeChart ? (
                <SizeGuide
                  productId={product.id}
                  chart={product.sizeChart}
                  availableSizes={sizesOn(product, product.sizeChart.axis)}
                  onChooseSize={size => {
                    const variant = variantForSize(product, product.sizeChart!.axis, size, selectedVariant);
                    if (variant) chooseVariant(variant);
                  }}
                />
              ) : null}
              <TryOn productId={product.id} title={product.title} />
            </div>

            {/* With the quantity and the buy button, because they are one
                decision about one purchase — by the time somebody has scrolled
                past the button they have bought it without the fitting. */}
            <AddonPicker addons={product.addons ?? []} chosen={chosenAddons} onChange={setChosenAddons} />

            {/* A bundle is offered where the decision is made — the page for
                one of its members — rather than on an index nobody browses. */}
            <BundleOffer variantId={selectedVariant?.id} />

            <div className="mt-6 flex items-center gap-3">
              <span className="text-sm font-semibold ink-muted">{t("product.quantity")}:</span>
              {/* The shared control: the card grew the same thing, and two
                  copies is how one clamps at 1 and the other at 0. */}
              <QuantityStepper value={quantity} onChange={setQuantity} disabled={cartLoading} />
              {/* What the bag already holds of this option, in every line of it
                  (plain, with extras, in a set): the stepper is "how many more",
                  and showing 1 beside a bag of 5 read as the bag being wrong. */}
              {inBag > 0 ? (
                <button type="button" onClick={openCart} className="text-[13px] font-semibold text-[#0a285a] underline underline-offset-4">
                  {t(inBag === 1 ? "product.inYourCartOne" : "product.inYourCartMany", { count: inBag })}
                </button>
              ) : null}
            </div>

            <div ref={buyRef}>
            <div className="mt-6 flex gap-3">
              <button onClick={() => void addToCart()} disabled={!inStock || cartLoading} className={`${PURCHASE_TONE.add} pressable flex flex-1 items-center justify-center gap-2 rounded-[14px] px-5 py-4 disabled:cursor-not-allowed disabled:opacity-50`}>{cartLoading ? <LoaderCircle className="size-[18px] animate-spin" /> : <ShoppingBag className="size-[18px]" />}{t(buyLabelFor(selectedVariant))}</button>
              <button onClick={() => toggleSaved(product.id)} aria-label={t(isSaved ? "product.removeSaved" : "product.save", { name: product.title })} aria-pressed={isSaved} className="glass pressable grid w-14 place-items-center rounded-[14px] text-[#e61c38]"><Heart className={`size-5 ${isSaved ? "fill-current" : ""}`} /></button>
            </div>
            {/* Under the bag button, in the shop's one Buy now: the orange the
                card and the preview use, so "which button buys" has the same
                answer everywhere (`PURCHASE_TONE`). */}
            <button onClick={() => void buyNow()} disabled={!inStock || cartLoading} className={`${PURCHASE_TONE.buy} pressable mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] px-5 py-4 disabled:cursor-not-allowed disabled:opacity-50`}><Zap className="size-[18px] fill-current" aria-hidden />{t(quantity > 1 ? "product.buyNowCount" : "product.buyNow", { count: String(quantity) })}</button>
            </div>

            {selectedVariant?.preorder
              ? <p className="mt-3 text-[13px] leading-5 ink-muted">{t("product.preorderNote")}</p>
              : null}

            {/* Standing orders (3.1.19), under the one-off buy: buying once is
                the ordinary act, and a schedule is the considered one. */}
            <SubscribePanel product={product} variant={selectedVariant} quantity={quantity} />

            <div className="mt-3"><FollowProduct product={product} compact /></div>

            {/* Below the buy buttons, not above them: the ordinary way to buy
                this is at the price on the page, and a shop that leads with
                "or haggle" has made its own price look provisional. */}
            {selectedVariant && offersOn
              ? <PriceOfferPanel variantId={selectedVariant.id} listPrice={selectedVariant.price.amount} />
              : null}

            {/* A question for the shop (3.8). After the price request, because
                both are ways of talking to the seller and the price is the more
                specific of the two. */}
            {product.vendor && chatOn ? <AskSeller productId={product.id} vendor={product.vendor} /> : null}


            {express ? <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] font-semibold ink-muted"><BadgeCheck className="size-3.5" />{t("product.expressNote")}</p> : null}

            {/* The details come after the decision, not before it. The tabs and
                the assistant sat between the price and the buttons, which put
                Quantity, Add to cart and Buy now below the fold on a laptop. */}
            <hr className="my-6 border-[#0a285a]/8" />
            <ProductInfo
              label={t("product.information")}
              resetKey={product.id}
              sections={[
                { id: "specifications", icon: ListTree, label: t("product.specifications"), panel: <SpecificationsPanel product={product} t={t} arabic={isArabicPage} /> },
                { id: "shipping", icon: Truck, label: t("product.shippingPolicy"), panel: <ShippingPolicyPanel express={express} t={t} /> },
                { id: "warranty", icon: ShieldCheck, label: t("product.warrantyPolicy"), panel: <WarrantyPanel product={product} t={t} /> },
                { id: "returns", icon: RotateCcw, label: t("product.returnsPolicy"), panel: <ReturnsPanel t={t} /> },
              ]}
            />

            {/* Under the tabs, because it answers what the tabs did not: a
                spec block is written for somebody who already knows the
                category. */}
            <ProductAssistant product={product} />
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
          onQuickView={setQuickProduct}
        />

        <div className="mt-14">
          <ProductReviews productId={product.id} productTitle={product.title} />
        </div>

        {/* The same card every shelf uses, and nothing at all when there is
            nothing related: a placeholder promising products "as more arrive"
            is the shop describing itself rather than selling anything. */}
        {related.length ? (
          <section aria-labelledby="related-title" className="mt-14 border-t border-[#e6e9ef] pt-10">
            <h2 id="related-title" className="text-xl font-extrabold text-[#0a285a] sm:text-2xl">{t("product.relatedTitle")}</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {related.map(item => (
                <li key={item.id} className="min-w-0">
                  <ProductCard compact product={item} saved={savedIds.includes(item.id)} onSave={() => toggleSaved(item.id)} onQuickView={() => setQuickProduct(item)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageBody>
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
      {zoomOpen ? <ImageLightbox product={product} selectedImageIndex={selectedImageIndex} onClose={() => setZoomOpen(false)} onSelectImage={setSelectedImageIndex} onChangeImage={changeImage} /> : null}
      <StickyBuyBar
        shown={buyPassed}
        name={t("product.buyBar", { name: product.title })}
        price={money(price)}
        addLabel={t(buyLabelFor(selectedVariant))}
        buyLabel={t("product.buyNow")}
        disabled={!inStock || cartLoading}
        busy={cartLoading}
        onAdd={() => void addToCart()}
        onBuy={() => void buyNow()}
      />
    </>
  );
}

/**
 * The phone's buy bar. Once the page's own Add to cart and Buy now have
 * scrolled away above the screen, the price and the same two buttons float
 * over the tab bar, so somebody reading the specifications or the reviews buys
 * from where they are instead of scrolling back up for the buttons. The same
 * handlers, the same disabled state and the same labels as the buttons it
 * stands in for — the quantity and options chosen above go with it. A wide
 * screen keeps its buy box sticky beside the photos, so it never draws there.
 * Hidden, it is `inert` and out of the accessibility tree, so a keyboard or a
 * screen reader never meets two sets of the same buttons at once.
 */
function StickyBuyBar({ shown, name, price, addLabel, buyLabel, disabled, busy, onAdd, onBuy }: {
  shown: boolean;
  name: string;
  price: string;
  addLabel: string;
  buyLabel: string;
  disabled: boolean;
  busy: boolean;
  onAdd: () => void;
  onBuy: () => void;
}) {
  return (
    <PhoneActionBar shown={shown} label={name}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate px-1.5 text-[15px] font-extrabold text-[#0a285a] min-[360px]:px-2 min-[360px]:text-[16px]">{price}</p>
        <button type="button" onClick={onAdd} disabled={disabled} className={`${PURCHASE_TONE.add} flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50 min-[360px]:px-3 min-[360px]:text-[14px]`}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ShoppingBag className="hidden size-4 min-[380px]:block" aria-hidden />}
          {addLabel}
        </button>
        <button type="button" onClick={onBuy} disabled={disabled} className={`${PURCHASE_TONE.buy} flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50 min-[360px]:px-3 min-[360px]:text-[14px]`}>
          <Zap className="hidden size-4 fill-current min-[380px]:block" aria-hidden />
          {buyLabel}
        </button>
      </div>
    </PhoneActionBar>
  );
}
