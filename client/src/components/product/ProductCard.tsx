/**
 * The product card, and the share action the product page uses.
 *
 * Extracted from the home page so the saved-items page shows shoppers exactly
 * the card they saved from, rather than a second, subtly different one that
 * drifts every time the first is touched.
 *
 * **A card is a photograph, a name, a price and one button.** It used to be
 * more: the photographs cycled on their own, a share disc and a preview disc
 * slid out on hover, and two pills — Add and Buy now — each grew a minus and a
 * plus when a pointer came near. Every one of those had a reason written down
 * beside it, and together they made a grid that moved while somebody was
 * trying to read it and a card that asked three questions before it would sell
 * anything. Buy now lives on the product page, where somebody has decided.
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
import { Eye, Heart, LoaderCircle, Minus, Plus, Star, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { useMoney, useTranslation, type Translate } from "@/hooks/useTranslation";
import { useCart } from "@/contexts/CartContext";
import { DiscButton } from "@/components/ui/DiscButton";

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
 * Add, or the quantity already in the bag.
 *
 * The line it reads is the plain one for this variant — no extras, no bundle —
 * because that is the line an Add from a card makes. A line carrying a fitting
 * or priced as part of a set is something the shopper built on the product
 * page, and a card's minus should not quietly take it apart.
 *
 * Its own `busy` rather than the bag's `loading`: the bag's flag is one for the
 * whole page, and a spinner on every card in the grid while one of them adds
 * says the wrong thing about the other thirty.
 *
 * Focus follows the press. Add is replaced by the stepper and the stepper's
 * minus by Add, so the button somebody just pressed is gone by the next frame,
 * and without this the keyboard lands on `<body>`.
 */
function CardAction({ product, onChoose }: { product: Product; onChoose?: () => void }) {
  const { t } = useTranslation();
  const { cart, addItem, updateQuantity, removeItem } = useCart();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"add" | "plus" | null>(null);

  const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0];
  const line = variant
    ? cart?.items.find(item => item.variantId === variant.id && !item.addons?.length && !item.bundleName)
    : undefined;
  const choosing = product.variants.length > 1;

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

  const base = "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold disabled:cursor-not-allowed";

  let control: ReactNode;
  if (!variant?.availableForSale) {
    control = (
      <button type="button" disabled aria-label={t("product.unavailableName", { name: product.title })} className={`${base} border border-[#e6e9ef] bg-[#f4f6f9] ink-muted`}>
        {t("product.soldOut")}
      </button>
    );
  } else if (choosing) {
    /* Without a preview to open, the product page is where the choice is made. */
    control = onChoose ? (
      <button type="button" onClick={onChoose} className={`${base} border border-[#0a285a]/20 bg-white text-[#0a285a] hover:bg-[#f3f6fa]`}>
        {t("product.chooseOption")}
      </button>
    ) : (
      <Link href={`/products/${encodeURIComponent(product.handle)}`} className={`${base} border border-[#0a285a]/20 bg-white text-[#0a285a] hover:bg-[#f3f6fa]`}>
        {t("product.chooseOption")}
      </Link>
    );
  } else if (line) {
    const last = line.quantity <= 1;
    control = (
      <div role="group" aria-label={t("cart.quantityShort", { count: String(line.quantity) })} className="flex h-10 w-full items-center justify-between rounded-xl bg-[#0a285a] text-white">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(
            () => last ? removeItem(line.lineId) : updateQuantity(line.lineId, line.quantity - 1),
            last ? t("cart.removedName", { name: product.title }) : t("cart.quantityShort", { count: String(line.quantity - 1) }),
            last ? "add" : null,
          )}
          aria-label={t(last ? "cart.remove" : "cart.decrease", { name: product.title })}
          className="grid h-full w-10 shrink-0 place-items-center rounded-s-xl hover:bg-white/10 disabled:opacity-50"
        >
          {last ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
        </button>
        <span className="min-w-0 text-[14px] font-bold tabular-nums">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : line.quantity}
        </span>
        <button
          ref={plusRef}
          type="button"
          disabled={busy || line.quantity >= MAX_QUANTITY}
          onClick={() => void run(
            () => updateQuantity(line.lineId, line.quantity + 1),
            t("cart.quantityShort", { count: String(line.quantity + 1) }),
            null,
          )}
          aria-label={t("cart.increase", { name: product.title })}
          className="grid h-full w-10 shrink-0 place-items-center rounded-e-xl hover:bg-white/10 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    );
  } else {
    control = (
      <button
        ref={addRef}
        type="button"
        disabled={busy}
        onClick={() => void run(
          () => addItem(variant.id, 1, false),
          t("cart.added", { name: product.title }),
          "plus",
        )}
        aria-label={t("product.addToCartName", { name: product.title })}
        className={`${base} border border-[#0a285a]/20 bg-white text-[#0a285a] hover:bg-[#f3f6fa]`}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {t(variant.preorder ? "product.preorder" : "product.addShort")}
      </button>
    );
  }

  return (
    <div className="mt-auto pt-2.5">
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
    <article className={`product-card group relative flex h-full flex-col rounded-2xl border border-[#e6e9ef] bg-white ${compact ? "p-2" : "p-2.5"}`}>
      <div className="relative">
        {/*
          The photo and the title both open the product, and only the title is
          a stop for the keyboard and a name for a screen reader: two links to
          one place, read out twice in a row, is a grid that takes twice as
          long to get through.
        */}
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block overflow-hidden rounded-xl bg-[#f4f6f9]">
          {image
            ? <Thumb src={image.url} alt="" className="aspect-square w-full object-cover" />
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
