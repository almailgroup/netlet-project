/**
 * The complements rail, on a product page.
 *
 * **It renders nothing until the shop has real evidence.** `complementsFor`
 * returns an empty list rather than a padded one when nothing clears the
 * support and lift floors, and this draws nothing when it does — because
 * "frequently bought together" is a *claim*, and a row of unrelated products
 * under that heading is checked once and never believed again. That is the
 * same argument `personalised` makes for the recommendation rail: say it when
 * it is true, or say nothing.
 *
 * **"Another seller" is on the card, not hidden.** The requirement asks for
 * cross-vendor complements explicitly, and that is where most of the value is
 * — the phone vendor does not sell the case. But a shopper adding a second
 * seller's item is also taking on a second delivery, so the fact belongs in
 * front of them rather than in the basket afterwards.
 *
 * No `QueryGate` here, deliberately. Everywhere else in this codebase a failed
 * query must say so rather than render as empty — but this rail is *itself*
 * absent most of the time, so a loud error box for a decoration nobody was
 * promised would be noise on a page whose job is to sell one product. The
 * product, its price and its buy button do not depend on this query.
 */
import { ProductCard } from "@/components/product/ProductCard";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";
import { Store } from "lucide-react";

type Complement = {
  product: Product;
  lift: number;
  confidence: number;
  crossVendor: boolean;
};

export function BoughtTogether({ productId, saved, onSave, onDetails, onQuickView, onAdd, onBuyNow, isAdding }: {
  productId: string;
  saved: string[];
  onSave: (id: string, title: string) => void;
  onDetails: (product: Product) => void;
  onQuickView: (product: Product) => void;
  onAdd: (product: Product, quantity: number) => void;
  onBuyNow: (product: Product, quantity: number) => void;
  isAdding: boolean;
}) {
  const { t, locale } = useTranslation();
  const query = trpc.together.forProduct.useQuery({ productId, limit: 4, locale });

  const items = (query.data ?? []) as Complement[];
  if (items.length === 0) return null;

  return (
    <section className="mt-14 border-t border-[#d5dfeb] pt-10">
      <p className="type-label ink-accent uppercase">{t("home.netletSelection")}</p>
      <h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">{t("together.heading")}</h2>
      <p className="mt-2 max-w-prose text-sm ink-muted">{t("together.note")}</p>

      <div className="hide-scrollbar mt-6 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {items.map(item => (
          <div key={item.product.id} className="min-w-[172px] sm:min-w-[195px] lg:min-w-0">
            <ProductCard
              compact
              product={item.product}
              note={<Note item={item} />}
              saved={saved.includes(item.product.id)}
              onSave={() => onSave(item.product.id, item.product.title)}
              onDetails={() => onDetails(item.product)}
              onQuickView={() => onQuickView(item.product)}
              onAdd={quantity => onAdd(item.product, quantity)}
              onBuyNow={quantity => onBuyNow(item.product, quantity)}
              isAdding={isAdding}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One line above the title: who it is from, or how often it rides along.
 *
 * The cross-vendor fact wins when both are true, because it is the one that
 * changes what the shopper is signing up for. The percentage is rounded and
 * only shown from 20% up — "7% also took this" is a number pretending to be a
 * reason.
 */
function Note({ item }: { item: Complement }) {
  const { t } = useTranslation();

  if (item.crossVendor) {
    return (
      <span className="type-label inline-flex items-center gap-1 ink-accent">
        <Store className="size-3 shrink-0" aria-hidden />
        {t("together.otherSeller")}
      </span>
    );
  }

  if (item.confidence >= 0.2) {
    return (
      <span className="type-label block truncate ink-accent">
        {t("together.confidence", { percent: Math.round(item.confidence * 100) })}
      </span>
    );
  }

  return null;
}
