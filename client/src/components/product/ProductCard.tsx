/**
 * The product card, and the share action that sits on it.
 *
 * Extracted from the home page so the saved-items page shows shoppers exactly
 * the card they saved from, rather than a second, subtly different one that
 * drifts every time the first is touched.
 */
import { isExpressEligible, productRating, savingsPercent } from "@shared/commerce/productDetail";
import { MAX_QUANTITY } from "@/components/cart/QuantityStepper";
import { Thumb } from "@/components/product/Thumb";
import { UnitPrice } from "@/components/product/UnitPrice";
import { PreorderBadge } from "@/components/product/Availability";
import type { Product } from "@shared/commerce/types";
import { Eye, Heart, LoaderCircle, Minus, Plus, Share2, ShoppingBag, Star, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useMoney, useTranslation, type Translate } from "@/hooks/useTranslation";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export async function shareProduct(product: Product, t: Translate) {
  const shareUrl = `${window.location.origin}/products/${encodeURIComponent(product.handle)}`;
  const shareData = { title: product.title, text: t("product.shareText", { name: product.title }), url: shareUrl };
  try {
    const nativeBridge = (window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }).ReactNativeWebView;
    if (nativeBridge) {
      nativeBridge.postMessage(JSON.stringify({ type: "share", ...shareData }));
      return;
    }
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    toast.success(t("product.linkCopied"));
  } catch (error) {
    if ((error as DOMException)?.name !== "AbortError") toast.error(t("product.shareFailed"));
  }
}

/** Hovering: the shopper asked to see the other views, so they come quickly. */
const PREVIEW_HOLD = 1500;
const PREVIEW_FADE = 450;

/**
 * Not hovering: the card is offering, not answering, so it moves at a third
 * of the speed and fades across twice as slowly. A grid of twenty cards each
 * flicking every 1.5s is a page nobody can read.
 */
const IDLE_HOLD = 4500;
const IDLE_FADE = 900;

/**
 * Card gallery: every image of the product, previewable without opening it.
 *
 * **Hovering anywhere on the card speeds it up, not just the picture.** The
 * handlers used to sit on the image alone, so a pointer resting over the title
 * or the price — which is where a cursor lands when somebody is reading a card
 * rather than pointing at it — left the photograph on its slow cycle while
 * every other reveal on the card was already out, because those key off
 * `group-hover` on the article. One hover, one behaviour.
 *
 * **It cycles on its own, and faster when hovered.** A second and third
 * photograph that only exist for somebody holding a mouse over the card are
 * invisible on every phone this shop sells to, which is most of them — so the
 * card offers them by itself, at `IDLE_HOLD`, and answers a hover at
 * `PREVIEW_HOLD`. Hovering a dot pins one and stops both, so a shopper who
 * spots the angle they want can hold it.
 *
 * Three things keep a self-cycling grid from becoming a page that cannot be
 * read, and all three are the reason this is not simply a second `setInterval`:
 *
 * **Only what is on screen moves.** An `IntersectionObserver` gates the timer,
 * so a category page with forty cards runs the handful in view rather than
 * forty, and a card scrolled past stops. Twenty permanent cross-fades is real
 * battery on a mid-range phone on a Kuwaiti mobile connection.
 *
 * **Every card starts on its own beat.** Without the per-card offset the whole
 * grid turns over as one block every 4.5 seconds, which is not a set of
 * products breathing but a page blinking. The jitter is drawn once per card
 * and kept, so the stagger is stable rather than re-rolled on every render.
 *
 * **A hidden tab advances nothing.** Browsers throttle background intervals
 * rather than stopping them, and each tick here is a state update and a
 * re-render of every card in the document.
 *
 * Reduced motion turns all of it off, idle and hover alike — through a hook
 * that *subscribes*, because somebody who turns the setting on to stop a page
 * moving should not have to reload it. The dots still work.
 *
 * Leaving a hover resets to the first image and the slow cycle picks up from
 * there: a card left parked on view five reads as a different product when the
 * eye comes back to it, and returning to a known first frame is what makes the
 * rotation feel like one product rather than several.
 *
 * Every image is stacked and cross-faded on opacity rather than swapped in the
 * src. Swapping would show a blank frame on the first pass while the next file
 * decodes, and this way they are all decoded after the first cycle.
 */
export function CardGallery({ product, onDetails, compact, hovering }: { product: Product; onDetails: () => void; compact: boolean; hovering: boolean }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const frame = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const images = product.images;

  // Drawn once per card and kept for its lifetime. See the stagger note above.
  const [jitter] = useState(() => Math.random() * IDLE_HOLD);

  useEffect(() => {
    const node = frame.current;
    if (!node || images.length < 2) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      // A third of the card showing is enough to be worth animating, and is
      // high enough that a card one pixel into the viewport does not start.
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [images.length]);

  useEffect(() => {
    if (pinned || reducedMotion || images.length < 2) return;
    if (!hovering && !onScreen) return;

    const period = hovering ? PREVIEW_HOLD : IDLE_HOLD;
    const advance = () => {
      if (document.hidden) return;
      setIndex(current => (current + 1) % images.length);
    };

    // The first idle turn waits a period *plus* this card's own offset, so the
    // grid never ticks as one. A hover is an answer and waits only the period.
    let repeat = 0;
    const first = window.setTimeout(() => {
      advance();
      repeat = window.setInterval(advance, period);
    }, hovering ? period : period + jitter);

    return () => { window.clearTimeout(first); window.clearInterval(repeat); };
  }, [hovering, onScreen, pinned, reducedMotion, images.length, jitter]);

  /*
   * Leaving the card returns it to its first view, and the slow cycle picks up
   * again from there. Only a change in `hovering` resets it — the idle cycle
   * moves the same state, so reacting to anything else would fight it.
   */
  useEffect(() => {
    if (hovering) return;
    setPinned(false);
    setIndex(0);
  }, [hovering]);

  return (
    <>
      <button
        ref={frame}
        onClick={onDetails}
        className="relative block w-full overflow-hidden rounded-xl bg-[#e7edf5] text-start"
        aria-label={t("product.view", { name: product.title })}
      >
        {images.length ? images.map((item, position) => (
          <Thumb
            key={`${item.url}-${position}`}
            src={item.url}
            alt={position === 0 ? (item.altText ?? product.title) : ""}
            style={{ transitionDuration: `${hovering ? PREVIEW_FADE : IDLE_FADE}ms` }}
            className={`aspect-[1.02] w-full object-cover transition-opacity ease-out group-hover:scale-105 motion-safe:transition-transform ${position === 0 ? "" : "absolute inset-0"} ${position === index ? "opacity-100" : "opacity-0"}`}
          />
        )) : <div className="grid aspect-[1.02] place-items-center text-sm font-bold text-[#536b8c]">{t("product.imageProcessing")}</div>}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0a285a]/20 to-transparent" />
      </button>

      {images.length > 1 ? (
        <div className="relative z-10 mt-2 flex items-center justify-center gap-3" onPointerLeave={() => setPinned(false)}>
          {images.map((item, position) => (
            <button
              key={`dot-${item.url}-${position}`}
              onPointerEnter={(event) => { if (event.pointerType !== "mouse") return; setPinned(true); setIndex(position); }}
              onClick={(event) => { event.stopPropagation(); setIndex(position); setPinned(true); }}
              aria-label={t("product.previewImage", { position: position + 1, total: images.length, name: product.title })}
              aria-current={position === index}
              className={`pressable tap-target rounded-full transition-all duration-200 ${compact ? "size-1.5" : "size-2"} ${position === index ? "scale-125 bg-[#0a285a]" : "bg-[#c3ccda] hover:bg-[#8fa3bd]"}`}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * An action button with its own quantity control inside it.
 *
 * Three real buttons sharing one styled wrapper, because a `<button>` cannot
 * contain a `<button>`: nested, the markup is invalid and the browser decides
 * for itself which one a click meant. The wrapper carries the fill and the
 * rounding, so the three read as one pill.
 *
 * The minus and plus reveal on hover and on focus, and are simply present on a
 * phone — `.qty-step` is where that lives. The label carries the count rather
 * than a separate number: "Add 3 to cart" leaves nothing to work out, where a
 * stepper reading 3 beside a button reading "Add to cart" asks somebody to
 * guess which the press will take.
 */
function ActionWithQuantity({ tone, icon, label, shortLabel, name, quantity, onQuantity, onAct, disabled, busy = false }: {
  tone: "quiet" | "accent";
  icon: ReactNode;
  /** Mid-request. The spinner replaces the icon and is never hidden. */
  busy?: boolean;
  /**
   * What the pill says on a card too narrow for the full label.
   *
   * Both are rendered and one is shown, because a container query cannot pick
   * a string — only CSS. The count has nowhere else to live: the minus and
   * plus carry no number, so a label trimmed to "Add" would lose it entirely.
   */
  shortLabel: string;
  label: string;
  /** The accessible name for the action itself, which already counts. */
  name: string;
  quantity: number;
  onQuantity: (next: number) => void;
  onAct: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const step = "qty-step pressable grid h-full shrink-0 place-items-center disabled:cursor-not-allowed disabled:opacity-40";

  return (
    /*
      A narrow rail card is 172px, and two 36px steps plus an icon clipped the
      label to "Add…". The steps give back 8px each below `@[15rem]` and the
      static icon stands down entirely — the words are the part that says what
      the button does. The spinner is exempt: it is the only sign that a press
      was heard.
    */
    <div className={`qty-inline glass [--qty-step-w:1.6rem] @[15rem]:[--qty-step-w:2.25rem] ${tone === "accent" ? "glass-accent" : "border border-[#0a285a]/15 text-[#0a285a]"} flex h-11 w-full items-center rounded-xl @[15rem]:w-auto @[15rem]:flex-1 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
      <button
        type="button"
        onClick={() => onQuantity(Math.max(1, quantity - 1))}
        disabled={disabled || quantity <= 1}
        aria-label={t("product.decreaseQuantity")}
        className={step}
      >
        <Minus className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={onAct}
        disabled={disabled}
        aria-label={name}
        className="pressable flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-xs font-extrabold @[15rem]:gap-2 @[15rem]:px-2 disabled:cursor-not-allowed"
      >
        {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <span className="shrink-0">{icon}</span>}
        <span className="truncate @[12rem]:hidden">{shortLabel}</span>
        <span className="hidden truncate @[12rem]:inline">{label}</span>
      </button>

      <button
        type="button"
        onClick={() => onQuantity(Math.min(MAX_QUANTITY, quantity + 1))}
        disabled={disabled || quantity >= MAX_QUANTITY}
        aria-label={t("product.increaseQuantity")}
        className={step}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function ProductCard({ product, saved, onSave, onShare, onDetails, onQuickView, onAdd, onBuyNow, isAdding, compact = false, note }: {
  product: Product;
  saved: boolean;
  onSave: () => void;
  onShare?: () => void;
  onDetails: () => void;
  onQuickView?: () => void;
  /** Both take the chosen quantity: the stepper above them is what sets it. */
  onAdd: (quantity: number) => void | Promise<void>;
  onBuyNow: (quantity: number) => void | Promise<void>;
  isAdding: boolean;
  compact?: boolean;
  /**
   * One line above the title saying why this card is here.
   *
   * Only the recommendation rail passes it. It sits where the vendor's name
   * would, because that is the line a shopper already reads for "where is this
   * from" — and "why am I seeing this" is the same question.
   */
  note?: ReactNode;
}) {
  const { t } = useTranslation();
  /*
   * One quantity for the card, not one per button. Two independent counts for
   * the same product leaves no answer to which one applies, and the two
   * buttons are not two things to buy — they are two destinations for the same
   * choice, the bag or the checkout.
   */
  const [quantity, setQuantity] = useState(1);
  /*
   * Hovering lives on the card rather than on the picture, because every other
   * reveal here already keys off `group-hover` on this element — the preview
   * disc, the share button, the quantity steps. A cursor resting on the title
   * had the card half-awake: the controls out, the photograph still idling.
   * Only a mouse engages it; a touch would latch on tap with no pointer to
   * leave with, which is the same reason the header takes that guard.
   */
  const [hovering, setHovering] = useState(false);
  const money = useMoney();
  const share = onShare ?? (() => void shareProduct(product, t));
  const variant = product.variants[0];
  const price = variant?.price ?? product.priceRange.min;
  const compareAt = variant?.compareAtPrice;
  const canBuy = Boolean(variant?.availableForSale);
  const savings = savingsPercent(price, compareAt);
  const rating = productRating(product.attributes);
  const express = isExpressEligible(product);

  return (
    <article
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovering(true); }}
      onPointerLeave={() => setHovering(false)}
      className={`product-card group relative @container flex flex-col overflow-hidden rounded-2xl border border-[#d5dfeb] bg-[#fffdf9] transition-shadow duration-300 hover:shadow-[0_14px_40px_rgba(10,40,90,.10)] ${compact ? "p-2.5" : "p-3"}`}
    >
      <div className="relative overflow-hidden rounded-xl">
        <CardGallery product={product} onDetails={onDetails} compact={compact} hovering={hovering} />

        {/* Signals a shopper scans for before anything else, stacked down the
            leading edge so they read in one pass instead of competing. */}
        <div className="pointer-events-none absolute start-1.5 top-1.5 flex flex-col items-start gap-1.5">
          {savings > 0 ? (
            <span dir="ltr" className="rounded-full bg-[#f2683a] px-2 py-1 text-[10px] font-extrabold text-white shadow-sm">−{savings}%</span>
          ) : null}
          {/* A pre-order is the fact that changes what the shopper is buying,
              so it joins the flags rather than waiting for the product page. */}
          <PreorderBadge variant={variant} className="shadow-sm" />
          {express ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#0a285a] px-2 py-1 text-[9px] font-extrabold text-white shadow-sm">
              <Zap className="size-2.5 fill-current" />{t("product.express")}
            </span>
          ) : null}
          {!canBuy ? (
            <span className="rounded-full bg-[#404553] px-2 py-1 text-[9px] font-extrabold text-white shadow-sm">{t("product.soldOut")}</span>
          ) : null}
        </div>

        <button onClick={onSave} aria-pressed={saved} aria-label={t(saved ? "product.removeSaved" : "product.save", { name: product.title })} className={`glass pressable tap-target absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-full ${saved ? "!text-[#e61c38]" : ""}`}><Heart className={`size-4 ${saved ? "fill-current" : ""}`} /></button>
        {/* Share is secondary: it appears on hover on a pointer device and is
            always present on touch, where there is no hover to reveal it. */}
        <button onClick={share} aria-label={t("product.share", { name: product.title })} className="glass pressable tap-target absolute end-1.5 top-11 grid size-8 place-items-center rounded-full transition-opacity duration-200 @[15rem]:opacity-0 @[15rem]:group-hover:opacity-100 @[15rem]:group-focus-within:opacity-100"><Share2 className="size-3.5" /></button>
        {/*
          Preview: a disc in the trailing bottom corner of the photo.

          It began as an eye third in the stack under the heart and the share,
          unlabelled — three icons deep is not somewhere anybody looks, and a
          shopper asked for this to be added while it was already there. It is
          its own corner now, on its own, and filled rather than glass so it
          reads as the one thing the picture offers rather than a third member
          of the cluster above it.

          `bottom-2 end-2`, so it mirrors in Arabic the way the heart does.
          It is icon-only, so it carries both an `aria-label` and a `title`:
          the label is for anybody not using a pointer, and the tooltip is the
          only thing that tells a mouse user what an eye means before they
          press it.

          `reveal-control` is the hover rule, the same one the quantity steps
          follow — `visibility` rather than opacity alone, because an invisible
          disc over a photo still swallows the tap meant for the card.

          White, and the largest control on the card. It was navy first, which
          vanished into a dark photograph; the clear tint the heart and share
          wear vanishes into a pale one. A solid white fill with a navy rim is
          the one that holds on both, and `.glass-white` is that tint, built to
          the same construction as the other three filled ones.

          `size-11` is 44px, which is the touch minimum — so it no longer needs
          `.tap-target`, and dropping it also removes a 44px pseudo-element
          that would otherwise have sat under the share button's.
        */}
        {onQuickView ? (
          <button
            onClick={onQuickView}
            aria-label={t("quick.open", { name: product.title })}
            title={t("quick.preview")}
            className="glass glass-white reveal-control pressable absolute bottom-2 end-2 grid size-11 place-items-center rounded-full"
          >
            <Eye className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-0.5 pb-0.5 pt-3">
        {note ?? (product.vendor ? <p className="type-label text-[9px] font-bold tracking-[.1em] ink-muted uppercase">{product.vendor}</p> : null)}
        <button onClick={onDetails} className="mt-0.5 text-start"><h3 className="type-product line-clamp-2 text-[15px] font-extrabold tracking-[-.025em] text-[#0a285a] transition-colors group-hover:text-[#a44a2b]">{product.title}</h3></button>

        {rating ? (
          <div className="mt-1.5 flex items-center gap-1" aria-label={rating.count ? t("product.ratingAriaCount", { value: rating.value, max: rating.scaleMax, count: rating.count }) : t("product.ratingAria", { value: rating.value, max: rating.scaleMax })}>
            <Star className="size-3 fill-[#ffb800] text-[#ffb800]" aria-hidden />
            <span className="text-[11px] font-extrabold text-[#1f2229]">{rating.value}</span>
            {rating.count ? <span className="text-[11px] ink-muted">({rating.count})</span> : null}
          </div>
        ) : null}

        {/* Price is the largest thing in the body: it is what the eye returns
            to, and the saving is only legible next to the old price. */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="type-price text-lg font-extrabold tracking-[-.04em] text-[#0a285a]">{money(price)}</p>
          {compareAt ? <p className="type-label text-[11px] ink-muted line-through">{money(compareAt)}</p> : null}
        </div>
        {/* Draws nothing for a counted product, which is every product today. */}
        {variant ? <UnitPrice variant={variant} className="mt-0.5" /> : null}

        {/*
          Both actions carry the same count, because they are not two things to
          buy — they are two destinations for the same choice, the bag or the
          checkout. Two independent counts would leave no answer to which the
          press applies.
        */}
        <div className="mt-auto flex flex-col gap-2 pt-3 @[15rem]:flex-row">
          <ActionWithQuantity
            tone="quiet"
            disabled={!canBuy || isAdding}
            quantity={quantity}
            onQuantity={setQuantity}
            onAct={() => void onAdd(quantity)}
            busy={isAdding}
            icon={<ShoppingBag className="size-4" />}
            label={t(!canBuy ? "product.unavailable" : quantity > 1 ? "product.addToCartCount" : "product.addToCart", { count: String(quantity) })}
            shortLabel={t(!canBuy ? "product.unavailable" : quantity > 1 ? "product.addShortCount" : "product.addShort", { count: String(quantity) })}
            name={canBuy
              ? t(quantity > 1 ? "product.addToCartNameCount" : "product.addToCartName", { name: product.title, count: String(quantity) })
              : t("product.unavailableName", { name: product.title })}
          />
          {/* Buy now is the accent because it is the shorter path to a
              completed order; add-to-cart keeps the quieter clear tint so the
              pair reads as a primary and a secondary rather than two primaries
              shouting at each other. */}
          <ActionWithQuantity
            tone="accent"
            disabled={!canBuy || isAdding}
            quantity={quantity}
            onQuantity={setQuantity}
            onAct={() => void onBuyNow(quantity)}
            icon={<Zap className="size-4 fill-current" />}
            label={t(quantity > 1 ? "product.buyNowCount" : "product.buyNow", { count: String(quantity) })}
            shortLabel={t(quantity > 1 ? "product.buyShortCount" : "product.buyShort", { count: String(quantity) })}
            name={t(quantity > 1 ? "product.buyNowNameCount" : "product.buyNowName", { name: product.title, count: String(quantity) })}
          />
        </div>

        {/*
          One live region for the card, not one per pill. The count lives in two
          button labels now, and a changed label is not announced — but two
          regions saying the same thing would read it twice.
        */}
        <span aria-live="polite" className="sr-only">{t("product.quantity")}: {quantity}</span>
      </div>
    </article>
  );
}
