/**
 * Quick view: the product, without leaving the list.
 *
 * Browsing is comparison — a shopper on a category page is holding four
 * products in their head at once, and opening the full page to check one
 * detail costs them the other three. This answers "what is it, how much, is it
 * in stock, can I buy it" and hands back the list unchanged.
 *
 * It is deliberately not the product page in a box. There is no gallery rail,
 * no specification tabs and no reviews: anything that needs that much room is
 * what the full page is for, and the link to it is right there.
 *
 * **It is large and in the brand's navy, on the owner's word.** It was a
 * 768px card whose photo was a third of a laptop's height, its title and
 * price held to a card's 18px and 16px by `.type-product` and `.type-price`,
 * an orange label and link and the card's white pair of buttons. It is 1024px
 * wide from `lg` now, the photo square up to 60% of the window's height, the
 * title 28px and the price 32px, under a navy band carrying its name and
 * Close, with a navy Add to cart and a navy-rimmed Buy now (`PREVIEW_TONE`).
 * The dialog is named by the band and the product together.
 */
import { useBuyNow } from "@/hooks/useBuyNow";
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/product/Thumb";
import { appPath } from "@/lib/basePath";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { isExpressEligible, productRating, savingsPercent } from "@shared/commerce/productDetail";
import { AvailabilityLine } from "@/components/product/Availability";
import { DeliverySpeedLine } from "@/components/product/DeliverySpeedLine";
import { MAX_LINE_QUANTITY, type Product } from "@shared/commerce/types";
import { roomFor } from "@shared/commerce/typedQuantity";
import { ArrowRight, ShoppingBag, Star, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { FollowProduct } from "@/components/product/FollowProduct";
import { QuantityStepper } from "@/components/cart/QuantityStepper";
import { PREVIEW_TONE } from "@/lib/purchaseStyle";
import { Select } from "@/components/ui/Select";

export function QuickView({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { addItem, cart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState("");
  const [imageIndex, setImageIndex] = useState(0);
  /* Above the early return, with every other hook: the popup renders with no
     product first, so a hook below `if (!product)` ran on the second render
     and not the first, and React refused the whole page (error #310). */
  const buyNow = useBuyNow();
  const bandId = useId();
  const titleId = useId();

  useOverlay(Boolean(product), onClose);
  /* Into the preview as it opens, by an effect declared after `useOverlay` so
     the hook has already recorded the opener to hand focus back to. Left on
     the card's eye, the keyboard was behind a modal it could not see. */
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (product) closeRef.current?.focus();
  }, [product?.id]);

  // A fresh product starts fresh: carrying quantity 3 over from the last one
  // is a way to sell somebody three of something they wanted one of.
  useEffect(() => {
    setQuantity(1);
    setVariantId(product?.variants[0]?.id ?? "");
    setImageIndex(0);
  }, [product?.id]);

  if (!product) return null;

  const variant = product.variants.find(entry => entry.id === variantId) ?? product.variants[0];
  const price = variant?.price ?? product.priceRange.min;
  const compareAt = variant?.compareAtPrice ?? null;
  const savings = savingsPercent(price, compareAt);
  const rating = productRating(product.attributes);
  const inStock = Boolean(variant?.availableForSale);
  /* What is left of this option once the bag's own is counted — the product
     page's rule: the stepper stops there, and a number chosen for another
     option is held to it on the press. */
  const inBag = variant ? (cart?.items ?? []).filter(item => item.variantId === variant.id).reduce((total, item) => total + item.quantity, 0) : 0;
  const room = roomFor(variant?.maxQuantity ?? MAX_LINE_QUANTITY, inBag);
  const asked = Math.min(quantity, room);
  const image = product.images[imageIndex] ?? product.images[0];
  const fullHref = appPath(`/products/${encodeURIComponent(product.handle)}`);

  const add = async (thenCheckout: boolean) => {
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    /* Buy now goes through the shared path (3.2.9): no drawer, no reload. */
    if (thenCheckout) return buyNow(product, asked, variant.id);
    /* The drawer opening is the confirmation; no toast (see the product page).
       It opens on the line drawn ahead, so the preview closes on the press. */
    onClose();
    try {
      await addItem(variant.id, asked, { product });
    } catch {
      toast.error(t("cart.addFailed"));
    }
  };

  return (
    <div className="fixed inset-0 z-[75] grid place-items-end bg-[#061b3b]/50 sm:place-items-center sm:p-6" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${bandId} ${titleId}`}
        onClick={event => event.stopPropagation()}
        className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-3xl sm:rounded-[1.75rem] lg:max-w-5xl"
      >
        {/* The brand's navy across the top, on the owner's word: the preview
            is the shop speaking over the page, and says so in its colour. */}
        <div className="flex shrink-0 items-center justify-between gap-4 bg-[#0a285a] py-2.5 pe-3 ps-5 sm:pe-4 sm:ps-7">
          <p id={bandId} className="truncate text-[15px] font-bold text-white">{t("quick.title")}</p>
          <button ref={closeRef} onClick={onClose} aria-label={t("quick.close")} className="grid size-11 shrink-0 place-items-center rounded-full border border-white/25 text-white hover:bg-white/[.12]">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain p-5 sm:p-7 lg:p-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
            <div className="min-w-0">
              {/* Square, and never taller than most of the screen, so a
                  laptop's short window still shows the price beside it. */}
              <a
                href={fullHref}
                aria-label={t("product.view", { name: product.title })}
                className="mx-auto block w-full max-w-[min(100%,60vh)] overflow-hidden rounded-3xl border border-[#e2e5eb] bg-white"
              >
                {image
                  ? <Thumb src={image.url} alt={image.altText ?? product.title} className="aspect-square w-full object-contain p-5 lg:p-8" />
                  : <div className="aspect-square" />}
              </a>
              {product.images.length > 1 ? (
                <div className="hide-scrollbar mx-auto mt-3 flex max-w-[min(100%,60vh)] gap-2 overflow-x-auto">
                  {product.images.slice(0, 6).map((item, index) => (
                    <button
                      key={`${item.url}-${index}`}
                      onClick={() => setImageIndex(index)}
                      aria-label={t("product.showImage", { index: index + 1, total: product.images.length })}
                      aria-current={index === imageIndex}
                      className={`grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 bg-white p-1.5 ${index === imageIndex ? "border-[#0a285a]" : "border-[#e2e5eb] hover:border-[#aac0da]"}`}
                    >
                      <Thumb src={item.url} alt="" className="size-full object-contain" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              {product.vendor ? <p dir="auto" className="text-[13px] font-semibold ink-muted">{product.vendor}</p> : null}
              <h2 id={titleId} dir="auto" className="mt-1 text-[22px] font-extrabold leading-tight tracking-[-.02em] text-[#0a285a] lg:text-[28px]">{product.title}</h2>

              {rating ? (
                <div className="mt-2.5 flex items-center gap-1.5 text-[14px]">
                  <Star className="size-4 fill-[#ffb800] text-[#ffb800]" aria-hidden />
                  <strong className="font-extrabold text-[#1f2229]">{rating.value}</strong>
                  {rating.count ? <span className="ink-muted">({rating.count})</span> : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[28px] font-extrabold leading-none tracking-[-.03em] text-[#0a285a] lg:text-[32px]">{money(price)}</span>
                {compareAt ? <span className="text-[15px] ink-muted line-through">{money(compareAt)}</span> : null}
                {savings > 0 ? <span className="rounded-full bg-[#d4edda] px-2.5 py-0.5 text-[13px] font-bold text-[#155724]">{t("product.savePercent", { percent: savings })}</span> : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-semibold">
                <AvailabilityLine variant={variant} size="small" />
                {/* The same component the product page uses, so the two cannot
                    give different answers about one product. */}
                {variant?.preorder
                  ? null
                  : <DeliverySpeedLine speed={product.deliverySpeed} provider={product.deliveryProvider} className="text-[13px]" />}
                {isExpressEligible(product) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#0a285a] px-2.5 py-0.5 text-[12px] font-extrabold text-white">
                    <Zap className="size-3 fill-current" />{t("product.express")}
                  </span>
                ) : null}
              </div>

              {product.description ? (
                <p dir="auto" className="mt-4 line-clamp-4 text-[15px] leading-7 text-[#404553]">{product.description}</p>
              ) : null}

              <div className="mt-5 border-t border-[#eef1f5] pt-5">
                {product.variants.length > 1 ? (
                  <label className="mb-4 block text-[13px] font-bold text-[#0a285a]">
                    {t("product.chooseOption")}
                    <Select
                      value={variant?.id ?? ""}
                      onChange={event => setVariantId(event.target.value)}
                      className="mt-1.5 h-12 w-full rounded-2xl border border-[#d5dfeb] bg-white px-4 text-[15px] font-semibold text-[#0a285a] outline-none focus:border-[#0a285a] focus:ring-2 focus:ring-[#0a285a]/15"
                    >
                      {product.variants.map(entry => (
                        <option key={entry.id} value={entry.id} disabled={!entry.availableForSale}>
                          {entry.title} — {money(entry.price)}{entry.availableForSale ? "" : t("product.variantUnavailable")}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}

                {inStock ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold ink-muted">{t("product.quantity")}</span>
                    <QuantityStepper value={asked} onChange={next => setQuantity(current => (typeof next === "function" ? next(Math.min(current, room)) : next))} max={room} />
                  </div>
                ) : (
                  // Out of stock is the moment a back-in-stock alert is worth
                  // offering, so it takes the place the buttons would have had.
                  <FollowProduct product={product} />
                )}

                {/* The preview's pair is the brand's navy (`PREVIEW_TONE`). Not
                    `.pressable`, which would force its own size and weight. */}
                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                  <button
                    onClick={() => void add(false)}
                    disabled={!inStock}
                    className={`${PREVIEW_TONE.add} flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1`}
                  >
                    <ShoppingBag className="size-[18px]" aria-hidden />
                    {t(!inStock ? "product.unavailable" : variant?.preorder ? "product.preorderAction" : asked > 1 ? "product.addToCartCount" : "product.addToCart", { count: String(asked) })}
                  </button>
                  <button
                    onClick={() => void add(true)}
                    disabled={!inStock}
                    className={`${PREVIEW_TONE.buy} flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1`}
                  >
                    <Zap className="size-[18px] fill-current" aria-hidden />{t(asked > 1 ? "product.buyNowCount" : "product.buyNow", { count: String(asked) })}
                  </button>
                </div>
              </div>

              <a href={fullHref} className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-bold text-[#0a285a] underline underline-offset-4">
                {t("quick.fullDetails")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
