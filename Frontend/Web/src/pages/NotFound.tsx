/**
 * 404.
 *
 * This was a slate-and-red template card with a pulsing alert icon — a page
 * from a different product, shown at the moment a shopper is most likely to
 * leave. It looks like every other page now — the shop's frame round it, the
 * title every page has — and, more usefully, offers a way
 * onward: a mistyped or dead product link is a dead end otherwise. The
 * suggestions are the shop's own cards, so they can be bought from here.
 */
import { toastHeart } from "@/lib/heartToast";
import { BUTTON_PLAIN, BUTTON_PRIMARY, PageBody, PageHeading } from "@/components/layout/Page";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { useCustomer } from "@/contexts/CustomerContext";
import { useCatalog } from "@/hooks/useCatalog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";
import { privatePageMeta } from "@shared/seo";
import { ArrowRight, Heart } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function NotFound() {
  usePageMeta(privatePageMeta("Page not found"));
  const [location] = useLocation();
  const { t } = useTranslation();
  const { savedIds, toggleSaved } = useCustomer();
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  // A handful of real products beats a dead end, and the catalog is already
  // cached from wherever the shopper came in.
  const { data: catalog = [] } = useCatalog(8);
  const suggestions = catalog.slice(0, 4);

  return (
    <PageBody>
      <PageHeading
        title={t("notFound.title")}
        note={
          <>
            {t("notFound.note")}
            {/* The path is shown so a mistyped URL is obvious, and escaped by
                React rather than interpolated into markup. */}
            <span className="mt-1 block truncate font-mono text-[13px] ink-muted"><bdi dir="ltr">{location}</bdi></span>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className={BUTTON_PRIMARY}>
          {t("notFound.back")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
        <Link href="/saved" className={BUTTON_PLAIN}>
          <Heart className="size-4" aria-hidden />{t("notFound.saved")}
        </Link>
      </div>

      {suggestions.length ? (
        <section className="mt-12" aria-labelledby="not-found-suggestions">
          <h2 id="not-found-suggestions" className="text-lg font-extrabold text-[#0a285a]">{t("notFound.suggestions")}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {suggestions.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                saved={savedIds.includes(product.id)}
                onSave={() => toastHeart(toggleSaved(product.id), product.title, t)}
                onQuickView={() => setQuickProduct(product)}
              />
            ))}
          </div>
        </section>
      ) : null}
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    </PageBody>
  );
}
