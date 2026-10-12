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
import type { Product } from "@shared/commerce/types";
import { ArrowRight, LoaderCircle, ShoppingBag, Star, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FollowProduct } from "@/components/product/FollowProduct";
import { QuantityStepper } from "@/components/cart/QuantityStepper";
import { PURCHASE_TONE } from "@/lib/purchaseStyle";
import { Select } from "@/components/ui/Select";

export function QuickView({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { addItem, loading } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState("");
  const [imageIndex, setImageIndex] = useState(0);
  /* Above the early return, with every other hook: the popup renders with no
     product first, so a hook below `if (!product)` ran on the second render
     and not the first, and React refused the whole page (error #310). */
  const buyNow = useBuyNow();

  useOverlay(Boolean(product), onClose);

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
  const image = product.images[imageIndex] ?? product.images[0];
  const fullHref = appPath(`/products/${encodeURIComponent(product.handle)}`);

  const add = async (thenCheckout: boolean) => {
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    /* Buy now goes through the shared path (3.2.9): no drawer, no reload. */
    if (thenCheckout) return buyNow(product, quantity, variant.id);
    try {
      await addItem(variant.id, quantity);
      toast.success(t("cart.addedQuantity", { count: quantity, name: product.title }));
      onClose();
    } catch {
      toast.error(t(thenCheckout ? "cart.buyFailed" : "cart.addFailed"));
    }
  };

  return (
    <div className="fixed inset-0 z-[75] grid place-items-end bg-[#061b3b]/40 sm:place-items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("quick.title")}
        onClick={event => event.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[1.5rem] bg-background p-5 shadow-2xl sm:max-w-3xl sm:rounded-[1.5rem] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="type-label text-[12px] font-semibold text-[#a44a2b]">{t("quick.title")}</p>
          <button onClick={onClose} aria-label={t("quick.close")} className="glass pressable grid size-9 shrink-0 place-items-center rounded-full">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <a
              href={fullHref}
              aria-label={t("product.view", { name: product.title })}
              className="block w-full overflow-hidden rounded-2xl border border-[#e2e5eb] bg-white"
            >
              {image
                ? <Thumb src={image.url} alt={image.altText ?? product.title} className="aspect-square w-full object-contain p-4" />
                : <div className="aspect-square" />}
            </a>
            {product.images.length > 1 ? (
              <div className="hide-scrollbar mt-2 flex gap-2 overflow-x-auto">
                {product.images.slice(0, 6).map((item, index) => (
                  <button
                    key={`${item.url}-${index}`}
                    onClick={() => setImageIndex(index)}
                    aria-label={t("product.showImage", { index: index + 1, total: product.images.length })}
                    aria-current={index === imageIndex}
                    className={`pressable grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border-2 bg-white p-1 ${index === imageIndex ? "border-[#0a285a]" : "border-[#e2e5eb] hover:border-[#aac0da]"}`}
                  >
                    <Thumb src={item.url} alt="" className="size-full object-contain" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            {product.vendor ? <p className="type-label text-[12px] font-bold ink-muted">{product.vendor}</p> : null}
            <h2 dir="auto" className="type-product mt-1 text-lg font-extrabold tracking-[-.025em] text-[#0a285a]">{product.title}</h2>

            {rating ? (
              <div className="mt-2 flex items-center gap-1.5 text-[13px]">
                <Star className="size-3.5 fill-[#ffb800] text-[#ffb800]" aria-hidden />
                <strong className="font-extrabold text-[#1f2229]">{rating.value}</strong>
                {rating.count ? <span className="ink-muted">({rating.count})</span> : null}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-baseline gap-2">
              <span className="type-price text-2xl font-extrabold tracking-[-.04em] text-[#0a285a]">{money(price)}</span>
              {compareAt ? <span className="text-sm ink-muted line-through">{money(compareAt)}</span> : null}
              {savings > 0 ? <span className="rounded-sg bg-[#d4edda] px-2 py-0.5 text-[11px] font-bold text-[#155724]">{t("product.savePercent", { percent: savings })}</span> : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
              <AvailabilityLine variant={variant} size="small" />
              {/* The same component the product page uses, so the two cannot
                  give different answers about one product. */}
              {variant?.preorder
                ? null
                : <DeliverySpeedLine speed={product.deliverySpeed} provider={product.deliveryProvider} className="mt-1 text-[12px]" />}
              {isExpressEligible(product) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#0a285a] px-2 py-0.5 text-[10px] font-extrabold text-white">
                  <Zap className="size-2.5 fill-current" />{t("product.express")}
                </span>
              ) : null}
            </div>

            {product.description ? (
              <p dir="auto" className="mt-3 line-clamp-3 text-[13px] leading-6 text-[#536b8c]">{product.description}</p>
            ) : null}

            {product.variants.length > 1 ? (
              <label className="mt-4 block text-[11px] font-extrabold text-[#0a285a]">
                {t("product.chooseOption")}
                <Select
                  value={variant?.id ?? ""}
                  onChange={event => setVariantId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#0a285a] outline-none focus:border-[#f2683a]"
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
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[12px] font-semibold ink-muted">{t("product.quantity")}</span>
                <QuantityStepper value={quantity} onChange={setQuantity} disabled={loading} />
              </div>
            ) : (
              // Out of stock is the moment a back-in-stock alert is worth
              // offering, so it takes the place the buttons would have had.
              <div className="mt-4"><FollowProduct product={product} /></div>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => void add(false)}
                disabled={!inStock || loading}
                className={`${PURCHASE_TONE.add} pressable flex h-11 w-full items-center justify-center gap-2 rounded-xl disabled:cursor-not-allowed sm:flex-1 disabled:opacity-50`}
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                {t(!inStock ? "product.unavailable" : variant?.preorder ? "product.preorderAction" : quantity > 1 ? "product.addToCartCount" : "product.addToCart", { count: String(quantity) })}
              </button>
              <button
                onClick={() => void add(true)}
                disabled={!inStock || loading}
                className={`${PURCHASE_TONE.buy} pressable flex h-11 w-full items-center justify-center gap-2 rounded-xl disabled:cursor-not-allowed sm:flex-1 disabled:opacity-50`}
              >
                <Zap className="size-4 fill-current" aria-hidden />{t(quantity > 1 ? "product.buyNowCount" : "product.buyNow", { count: String(quantity) })}
              </button>
            </div>

            <a href={fullHref} className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-extrabold ink-accent underline underline-offset-4">
              {t("quick.fullDetails")} <ArrowRight className="size-3.5 rtl:-scale-x-100" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
