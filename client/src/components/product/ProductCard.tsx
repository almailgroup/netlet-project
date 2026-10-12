/**
 * The product card, and the share action the product page uses.
 *
 * Extracted from the home page so the saved-items page shows shoppers exactly
 * the card they saved from, rather than a second, subtly different one that
 * drifts every time the first is touched.
 *
 * **A card is a photograph, a name, a price, and Add to cart over Buy now**,
 * sharing one quantity whose minus and plus appear inside either button under
 * a pointer — without moving anything, which is what the old pair got wrong.
 * Both are the card's original white button (`PURCHASE_TONE`).
 *
 * **Add turns into the quantity once the item is in the bag**, the way the
 * delivery apps people here use every day do it: the card answers "is this in
 * my bag, and how many" by looking at it, and the bag drawer no longer opens
 * over the page on every press — the header's count is the receipt.
 *
 * **A product with more than one variant asks which**, by opening the preview,
 * rather than adding the first one that happens to be in stock. A shopper who
 * pressed Add on a shirt and found a medium in the bag was given a choice
 * nobody offered them.
 */
import { isExpressEligible, productRating, savingsPercent } from "@shared/commerce/productDetail";
import { MAX_QUANTITY } from "@/components/cart/QuantityStepper";
import { Thumb } from "@/components/product/Thumb";
import { UnitPrice } from "@/components/product/UnitPrice";
import { PreorderBadge } from "@/components/product/Availability";
import type { Product } from "@shared/commerce/types";
import { Eye, Heart, LoaderCircle, Minus, Plus, ShoppingBag, Star, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { useMoney, useTranslation, type Translate } from "@/hooks/useTranslation";
import { useCart } from "@/contexts/CartContext";
import { DiscButton } from "@/components/ui/DiscButton";
import { useBuyNow } from "@/hooks/useBuyNow";
import { PURCHASE_TONE } from "@/lib/purchaseStyle";

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

/**
 * One of the card's two buttons, with the shared quantity inside it.
 *
 * The pill is the coloured surface and holds three buttons side by side —
 * minus, the press itself, plus — because a button inside a button is not a
 * thing HTML allows. The minus and plus are `pill-step`: there for a pointer
 * that hovers and for a keyboard inside the pill, laid out but invisible
 * otherwise, so the label never moves when they appear, and absent on a touch
 * screen, which has no hover to reveal them. `always` draws them regardless,
 * which is the bag's own stepper once the item is in it.
 *
 * The focus ring is the shop's own orange, drawn inside the pill so it is not
 * cut off by the card's edge.
 */
function BuyPill({ tone, label, children, onPress, href, busy = false, step, always = false, pressRef, plusRef }: {
  tone: "add" | "buy";
  /** The press's accessible name. It starts with the words drawn, so somebody driving the page by voice can say what they see. */
  label: string;
  children: ReactNode;
  onPress?: () => void;
  /** A press that goes to another page is a link. */
  href?: string;
  busy?: boolean;
  step?: { name: string; less: () => void; more: () => void; canLess: boolean; canMore: boolean; lessIsRemove?: boolean };
  always?: boolean;
  pressRef?: Ref<HTMLButtonElement>;
  plusRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const ring = "focus-visible:outline-offset-[-2px]";
  /* Drawn always (the bag's stepper, which a phone uses too) it is a full
     40px square; revealed by a pointer it can be smaller. */
  const stepClass = `${always ? "grid h-full w-10" : "pill-step size-8"} shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#0a285a]/[.06] ${ring}`;
  /* `pressable` is the header's own button lettering, so the card's two
     buttons read like every other button on the site. */
  const press = `pressable flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 whitespace-nowrap disabled:cursor-wait ${ring}`;

  /* Nothing to press in the middle: it is the bag's count, and the pill is a
     group named by it rather than a button that does nothing. */
  const display = !onPress && !href;

  return (
    <div role={display ? "group" : undefined} aria-label={display ? label : undefined} className={`buy-pill ${PURCHASE_TONE[tone]} flex h-10 w-full items-center rounded-xl ${always ? "@container" : "px-1"}`}>
      {step ? (
        <button type="button" onClick={step.less} disabled={busy || !step.canLess} aria-label={t(step.lessIsRemove ? "cart.remove" : "cart.decrease", { name: step.name })} className={stepClass}>
          {step.lessIsRemove ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
        </button>
      ) : null}
      {display ? (
        <span className={press}>{children}</span>
      ) : href ? (
        <Link href={href} aria-label={label} className={press}>{children}</Link>
      ) : (
        <button ref={pressRef} type="button" onClick={onPress} disabled={busy} aria-label={label} className={press}>
          {children}
        </button>
      )}
      {step ? (
        <button ref={plusRef} type="button" onClick={step.more} disabled={busy || !step.canMore} aria-label={t("cart.increase", { name: step.name })} className={stepClass}>
          <Plus className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Add to cart and Buy now, sharing one quantity.
 *
 * **One number, drawn in both.** Before the item is in the bag it is the
 * card's own pick, set by the minus and plus that appear on either button; once
 * it is in, it is the bag's line, so the two buttons can never disagree about
 * how many — choose three on Add and Buy now reads "Buy 3 now", and the bag's
 * stepper and Buy now's minus change the same line. Buy now with the item
 * already in the bag goes straight to checkout rather than adding it again.
 *
 * The line it reads is the plain one for this variant — no extras, no bundle —
 * because that is the line a card makes. A line carrying a fitting or priced as
 * part of a set is something the shopper built on the product page, and a
 * card's minus should not quietly take it apart.
 *
 * Its own `busy` rather than the bag's `loading`: the bag's flag is one for the
 * whole page, and a spinner on every card in the grid while one of them adds
 * says the wrong thing about the other thirty.
 *
 * Focus follows the press. Add is replaced by the bag's stepper and the
 * stepper's bin by Add, so the button somebody just pressed is gone by the next
 * frame, and without this the keyboard lands on `<body>`.
 */
function CardAction({ product, onChoose }: { product: Product; onChoose?: () => void }) {
  const { t } = useTranslation();
  const { cart, addItem, updateQuantity, removeItem } = useCart();
  const buyNow = useBuyNow();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  /** How many, before the item is in the bag. */
  const [pick, setPick] = useState(1);
  const addRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"add" | "plus" | null>(null);

  const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0];
  const line = variant
    ? cart?.items.find(item => item.variantId === variant.id && !item.addons?.length && !item.bundleName)
    : undefined;
  const choosing = product.variants.length > 1;
  const quantity = line ? line.quantity : pick;
  const count = String(quantity);
  const name = product.title;

  useEffect(() => {
    const target = focusNext.current === "add" ? addRef.current : focusNext.current === "plus" ? plusRef.current : null;
    if (!target) return;
    focusNext.current = null;
    target.focus();
  }, [line?.quantity]);

  const run = async (act: () => Promise<void>, after: string, focus: "add" | "plus" | null) => {
    setBusy(true);
    try {
      await act();
      focusNext.current = focus;
      setSaid(after);
    } catch {
      toast.error(t("cart.addFailed"));
    } finally {
      setBusy(false);
    }
  };

  /* The one place the shared number changes: the card's pick, or the bag's line. */
  const setQuantity = (next: number) => {
    const clamped = Math.max(1, Math.min(MAX_QUANTITY, next));
    if (clamped === quantity) return;
    if (line) {
      void run(() => updateQuantity(line.lineId, clamped), t("cart.quantityShort", { count: String(clamped) }), null);
    } else {
      setPick(clamped);
      setSaid(t("cart.quantityShort", { count: String(clamped) }));
    }
  };
  const shared = {
    name,
    less: () => setQuantity(quantity - 1),
    more: () => setQuantity(quantity + 1),
    canLess: quantity > 1,
    canMore: quantity < MAX_QUANTITY,
  };

  let control: ReactNode;
  if (!variant?.availableForSale) {
    control = (
      <button type="button" disabled aria-label={t("product.unavailableName", { name })} className="pressable flex h-10 w-full cursor-not-allowed items-center justify-center rounded-xl border border-[#e6e9ef] bg-[#f4f6f9] ink-muted">
        {t("product.soldOut")}
      </button>
    );
  } else if (choosing) {
    /* Both open the choice: the preview where there is one, the product page
       where there is not. Neither picks a quantity, because the preview has
       its own and a size has to be chosen before a number means anything. */
    const href = onChoose ? undefined : `/products/${encodeURIComponent(product.handle)}`;
    control = (
      <>
        <BuyPill tone="add" label={t("card.chooseName", { name })} onPress={onChoose} href={href}>
          <span className="truncate">{t("product.chooseOption")}</span>
        </BuyPill>
        <BuyPill tone="buy" label={t("card.buyName", { name })} onPress={onChoose} href={href}>
          <Zap className="size-4 shrink-0 fill-current" aria-hidden />
          <span className="truncate">{t("product.buyNow")}</span>
        </BuyPill>
      </>
    );
  } else {
    const preorder = Boolean(variant.preorder);
    const add = line ? (
      /* In the bag: the bag's own stepper, always drawn — it is the answer to
         "how many have I got", which is a state rather than an offer. */
      <BuyPill
        tone="add"
        always
        busy={busy}
        label={t("cart.quantityShort", { count })}
        plusRef={plusRef}
        step={{
          ...shared,
          canLess: true,
          lessIsRemove: quantity <= 1,
          less: () => quantity <= 1
            ? void run(() => removeItem(line.lineId), t("cart.removedName", { name }), "add")
            : setQuantity(quantity - 1),
        }}
      >
        {/* "2 in cart" where the pill has room for it beside two 40px steps,
            the number alone on a narrow phone card — never a word cut short. */}
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : (
          <>
            <span className="tabular-nums @min-[11rem]:hidden">{count}</span>
            <span className="hidden truncate tabular-nums @min-[11rem]:inline">{t("card.inCart", { count })}</span>
          </>
        )}
      </BuyPill>
    ) : (
      <BuyPill
        tone="add"
        busy={busy}
        pressRef={addRef}
        label={t(preorder ? (quantity > 1 ? "card.preorderCountName" : "card.preorderName") : (quantity > 1 ? "card.addCountName" : "card.addName"), { count, name })}
        onPress={() => void run(
          async () => { await addItem(variant.id, pick, false); setPick(1); },
          t("cart.added", { name }),
          "plus",
        )}
        step={shared}
      >
        {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden /> : <ShoppingBag className="size-4 shrink-0" aria-hidden />}
        <span className="truncate">{t(preorder ? (quantity > 1 ? "product.preorderCount" : "product.preorder") : (quantity > 1 ? "product.addToCartCount" : "product.addToCart"), { count })}</span>
      </BuyPill>
    );
    control = (
      <>
        {add}
        <BuyPill
          tone="buy"
          busy={busy}
          label={t(quantity > 1 ? "card.buyCountName" : "card.buyName", { count, name })}
          /* Already in the bag at this number: checkout is the whole of what is left. */
          onPress={() => line
            ? navigate("/checkout")
            : void run(() => buyNow(product, pick, variant.id), t("cart.added", { name }), null)}
          step={shared}
        >
          <Zap className="size-4 shrink-0 fill-current" aria-hidden />
          <span className="truncate">{t(quantity > 1 ? "product.buyNowCount" : "product.buyNow", { count })}</span>
        </BuyPill>
      </>
    );
  }

  return (
    <div className="mt-auto flex flex-col gap-1.5 pt-2.5">
      {control}
      <span aria-live="polite" className="sr-only">{said}</span>
    </div>
  );
}

export function ProductCard({ product, saved, onSave, onQuickView, compact = false, note }: {
  product: Product;
  saved: boolean;
  onSave: () => void;
  /** Opens the preview: the eye on the photo, and how a variant is chosen. */
  onQuickView?: () => void;
  compact?: boolean;
  /**
   * One line above the title saying why this card is here.
   *
   * The recommendation rails and the sponsored shelf pass it. It sits where
   * the vendor's name would, because that is the line a shopper already reads
   * for "where is this from" — and "why am I seeing this" is the same question.
   */
  note?: ReactNode;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0];
  const price = variant?.price ?? product.priceRange.min;
  const compareAt = variant?.compareAtPrice;
  const canBuy = Boolean(variant?.availableForSale);
  const savings = savingsPercent(price, compareAt);
  const rating = productRating(product.attributes);
  const express = isExpressEligible(product);
  const href = `/products/${encodeURIComponent(product.handle)}`;
  const image = product.images[0];

  return (
    <article className={`product-card group relative flex h-full flex-col rounded-2xl border border-[#e6e9ef] bg-white hover:border-[#0a285a]/20 ${compact ? "p-2" : "p-2.5"}`}>
      <div className="relative">
        {/*
          The photo and the title both open the product, and only the title is
          a stop for the keyboard and a name for a screen reader: two links to
          one place, read out twice in a row, is a grid that takes twice as
          long to get through.
        */}
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block overflow-hidden rounded-xl bg-[#f4f6f9]">
          {image
            ? <Thumb src={image.url} alt="" className="product-card-photo aspect-square w-full object-cover" />
            : <div className="grid aspect-square place-items-center px-3 text-center text-[12px] font-semibold ink-muted">{t("product.imageProcessing")}</div>}
        </Link>

        <div className="pointer-events-none absolute start-1.5 top-1.5 flex flex-col items-start gap-1">
          {/* Navy on the orange: white on #f2683a is 3.08:1 at this size, navy is 4.65:1. */}
          {savings > 0 ? (
            <span dir="ltr" className="rounded-md bg-[#f2683a] px-1.5 py-0.5 text-[11px] font-bold text-[#0a285a]">−{savings}%</span>
          ) : null}
          <PreorderBadge variant={variant} />
          {express ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[#0a285a] px-1.5 py-0.5 text-[10px] font-bold text-white">
              <Zap className="size-2.5 fill-current" aria-hidden />{t("product.express")}
            </span>
          ) : null}
          {!canBuy ? (
            <span className="rounded-md bg-[#404553] px-1.5 py-0.5 text-[10px] font-bold text-white">{t("product.soldOut")}</span>
          ) : null}
        </div>

        <DiscButton onClick={onSave} aria-pressed={saved} aria-label={t(saved ? "product.removeSaved" : "product.save", { name: product.title })} className="absolute end-0 top-0" discClassName={`size-8 ${saved ? "!text-[#e61c38]" : ""}`}>
          <Heart className={`size-4 ${saved ? "fill-current" : ""}`} />
        </DiscButton>

        {/*
          The preview, for somebody with a mouse. `reveal-control` shows it on
          hover and on keyboard focus, and leaves it out altogether on a touch
          screen: a phone has no hover to reveal it, the whole card is already
          one tap from the product, and an eye drawn over every photo in a grid
          is clutter that answers nothing a tap on the photo does not.
        */}
        {onQuickView ? (
          <button
            type="button"
            onClick={onQuickView}
            aria-label={t("quick.open", { name: product.title })}
            title={t("quick.preview")}
            className="glass glass-white reveal-control pressable absolute bottom-2 end-2 grid size-10 place-items-center rounded-full"
          >
            <Eye className="size-[18px]" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-1 pt-2">
        {note ?? (product.vendor ? <p className="truncate text-[12px] ink-muted"><bdi>{product.vendor}</bdi></p> : null)}
        <h3 className="mt-0.5 min-h-[2.5em] text-[14px] font-semibold leading-[1.25] text-[#0a285a]">
          <Link href={href} className="line-clamp-2 hover:underline">{product.title}</Link>
        </h3>

        {rating ? (
          <div className="mt-1 flex items-center gap-1" aria-label={rating.count ? t("product.ratingAriaCount", { value: rating.value, max: rating.scaleMax, count: rating.count }) : t("product.ratingAria", { value: rating.value, max: rating.scaleMax })}>
            <Star className="size-3 fill-[#ffb800] text-[#ffb800]" aria-hidden />
            <span className="text-[12px] font-semibold text-[#1f2229]">{rating.value}</span>
            {rating.count ? <span className="text-[12px] ink-muted">({rating.count})</span> : null}
          </div>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
          <p className="text-[16px] font-bold text-[#0a285a]">{money(price)}</p>
          {compareAt && savings > 0 ? <p className="text-[12px] ink-muted line-through">{money(compareAt)}</p> : null}
        </div>
        {/* Draws nothing for a counted product, which is nearly every product. */}
        {variant ? <UnitPrice variant={variant} className="mt-0.5" /> : null}

        <CardAction product={product} onChoose={onQuickView} />
      </div>
    </article>
  );
}
