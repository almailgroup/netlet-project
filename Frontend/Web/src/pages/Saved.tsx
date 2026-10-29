/**
 * Saved items.
 *
 * The heart on every product card wrote to a list nothing could read: the
 * header and the mobile tab both answered with a toast counting the items,
 * and there was no page to send anyone to. A save button that cannot be
 * reviewed is a promise the storefront does not keep, so this is that page.
 *
 * Saves live in the customer context — localStorage for a guest, the account
 * once signed in — so the list survives a reload either way.
 */
import { toastHeart } from "@/lib/heartToast";
import { useProductsByIds } from "@/hooks/useCatalog";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { RecommendedRail } from "@/components/product/RecommendedRail";
import { BUTTON_PRIMARY, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import type { Product } from "@shared/commerce/types";
import { ArrowRight, Heart } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function Saved() {
  usePageMeta(privatePageMeta("Saved items"));
  const { savedIds, heartedIds, toggleSaved } = useCustomer();
  const { t } = useTranslation();
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  /* By id, so a heart on something older than the newest sixty products is
     still a card — it used to be counted as no longer available. */
  const saved = useProductsByIds(savedIds);
  const isLoading = saved.waiting;

  // Ordered by the saved list rather than by catalog order, so the most
  // recently saved item is where the shopper left it.
  const savedProducts = saved.products;

  // A saved id with no product behind it means the item left the catalog while
  // it was on the list. Counted rather than hidden: "two items are no longer
  // available" is information; silently showing fewer cards is a bug report.
  // Only once the server has answered: the shelves' copy is not the catalogue.
  const missingCount = saved.missing;

  return (
    <>
      <PageBody>
        <PageHeading
          title={t("saved.title")}
          /* A line held while the list loads, so the grid does not drop when it lands. */
          note={isLoading ? "\u00a0" : savedProducts.length === 0
            ? t("saved.emptyPrompt")
            : savedProducts.length === 1
              ? t("saved.countOne")
              : t("saved.count", { count: savedProducts.length })}
        />
        {missingCount > 0 && !isLoading ? (
          <p className="-mt-2 mb-6 rounded-xl border border-[#f2b69e] bg-white px-4 py-3 text-[13px] font-semibold text-[#a44a2b]">
            {missingCount === 1 ? t("saved.unavailableOne") : t("saved.unavailableCount", { count: missingCount })}
          </p>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[420px] animate-pulse rounded-2xl border border-[#d5dfeb] bg-white/60" />
            ))}
          </div>
        ) : savedProducts.length ? (
          <>
          {/* The cards are h3s under the page's h1: the department grid's rung. */}
          <h2 className="sr-only">{t("browse.resultsRegion")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {savedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                saved
                onSave={() => toastHeart(toggleSaved(product.id), product.title, t)}
                onQuickView={() => setQuickProduct(product)}
              />
            ))}
          </div>
          </>
        ) : (
          <EmptyState icon={<Heart className="size-6" />} title={t("saved.emptyTitle")} note={t("saved.emptyNote")}>
            <Link href="/" className={BUTTON_PRIMARY}>
              {t("saved.browse")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </EmptyState>
        )}
      </PageBody>
      {/* Under the hearts it learns from, and only once it has learned
          something: the rail draws nothing until it is personal. */}
      <RecommendedRail
        saved={heartedIds}
        onSave={(id, title) => toastHeart(toggleSaved(id), title, t)}
        onQuickView={setQuickProduct}
      />
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    </>
  );
}
