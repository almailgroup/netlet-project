/**
 * Saved for later: what the shopper keeps without buying yet, directly under
 * the bag's lines on the cart page (under its empty state when the bag is
 * empty), on the owner's word, with a way back into it.
 *
 * It is Saved — the hearts — newest first, less anything already in the bag;
 * the line menu's "Save for later" (`LineMenu`) puts a line here and takes it
 * out of the bag. **Move to cart** adds the plain line and takes the product
 * out of Saved alone: a wishlist it is on keeps it, since a list somebody
 * shared is not the cart's to edit. A product with sizes or colours opens its
 * page instead, because a size has to be chosen before "add" means anything,
 * and a sold-out one says so. One row that scrolls sideways, like the home
 * page's, and not drawn at all with nothing saved.
 */
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { Thumb } from "@/components/product/Thumb";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useSideScroll } from "@/hooks/useSideScroll";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { pressHaptic, refusedHaptic } from "@/lib/haptics";
import type { Product } from "@shared/commerce/types";
import { ChevronRight, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

const SHOWN = 12;

export function SavedForLater({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { savedIds, unsave, saveForLater } = useCustomer();
  const { cart, addItem } = useCart();
  const inBag = new Set((cart?.items ?? []).map(item => item.productId).filter(Boolean));
  const ids = [...savedIds].reverse().filter(id => !inBag.has(id)).slice(0, SHOWN);
  const { products } = useProductsByIds(ids);
  const scroll = useSideScroll<HTMLUListElement>([products.length]);
  const [said, setSaid] = useState("");
  const title = t("cart.savedTitle");
  if (!products.length) return null;

  const move = (product: Product) => {
    const variant = product.variants.find(entry => entry.availableForSale);
    if (!variant) return;
    pressHaptic();
    unsave(product.id);
    setSaid(t("cart.movedToCart", { name: product.title }));
    addItem(variant.id, 1, { reveal: false, product }).catch(() => {
      refusedHaptic();
      saveForLater(product.id);
      toast.error(t("cart.addFailed"));
    });
  };

  return (
    <section aria-labelledby="saved-later-title" className={className}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="saved-later-title" className="text-[17px] font-extrabold text-[#0a285a]">{title}</h2>
        <div className="flex items-center gap-2">
          <ScrollArrows scroll={scroll} previousLabel={t("home.rowBack", { title })} nextLabel={t("home.rowOn", { title })} />
          <Link href="/saved" className="pressable -me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-bold ink-accent hover:underline">
            {t("home.viewAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">{said}</p>
      <ul ref={scroll.trackRef} className="hide-scrollbar -mx-4 mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {products.map(product => <SavedCard key={product.id} product={product} onMove={() => move(product)} onRemove={() => unsave(product.id)} />)}
      </ul>
    </section>
  );
}

function SavedCard({ product, onMove, onRemove }: { product: Product; onMove: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const href = `/products/${encodeURIComponent(product.handle)}`;
  const variant = product.variants.find(entry => entry.availableForSale);
  const choosing = product.variants.length > 1;
  return (
    <li className="flex w-[152px] shrink-0 snap-start flex-col rounded-2xl border border-[#e6e9ef] bg-white p-2 sm:w-[168px]">
      <div className="relative">
        <Link href={href} tabIndex={-1} aria-hidden className="block aspect-square overflow-hidden rounded-xl bg-[#f4f6f9]">
          <Thumb src={product.images[0]?.url} alt={product.images[0]?.altText ?? product.title} className="size-full object-cover" icon={<ShoppingBag className="size-5" />} />
        </Link>
        <button
          type="button"
          onClick={() => { pressHaptic(); onRemove(); }}
          aria-label={t("product.removeSaved", { name: product.title })}
          title={t("product.removeSaved", { name: product.title })}
          className="tap-target absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/95 text-[#0a285a] shadow-[0_1px_4px_rgba(10,40,90,.18)] hover:bg-[#f0f2f5]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <Link href={href} dir="auto" className="mt-2 line-clamp-2 min-h-10 text-[13px] font-bold leading-5 text-[#0a285a] hover:underline">{product.title}</Link>
      <p className="mt-1 text-[14px] font-extrabold text-[#0a285a]">{money(variant?.price ?? product.priceRange.min)}</p>
      <div className="mt-auto pt-2">
        {!variant ? (
          <p className="flex min-h-9 items-center justify-center rounded-full bg-[#f0f2f5] text-[12px] font-bold ink-muted">{t("product.soldOut")}</p>
        ) : choosing ? (
          <Link href={href} className="flex min-h-9 w-full items-center justify-center rounded-full border border-[#0a285a]/25 text-[13px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
            {t("product.chooseOption")}
          </Link>
        ) : (
          <button type="button" onClick={onMove} aria-label={t("cart.moveToCartName", { name: product.title })} className="flex min-h-9 w-full items-center justify-center rounded-full bg-[#0a285a] text-[13px] font-bold text-white hover:bg-[#0d3372]">
            {t("cart.moveToCart")}
          </button>
        )}
      </div>
    </li>
  );
}
