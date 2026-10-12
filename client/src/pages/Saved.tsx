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
import { useCatalog } from "@/hooks/useCatalog";
import { ProductCard } from "@/components/product/ProductCard";
import { QuickView } from "@/components/product/QuickView";
import { RecommendedRail } from "@/components/product/RecommendedRail";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import type { Product } from "@shared/commerce/types";
import { ArrowRight, Heart } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Saved() {
  usePageMeta(privatePageMeta("Saved items"));
  const [, navigate] = useLocation();
  const { savedIds, toggleSaved } = useCustomer();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const { data: catalog = [], isLoading } = useCatalog(60);

  // Ordered by the saved list rather than by catalog order, so the most
  // recently saved item is where the shopper left it.
  const savedProducts = useMemo(() => {
    const byId = new Map(catalog.map((product) => [product.id, product]));
    return savedIds.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
  }, [catalog, savedIds]);

  // A saved id with no product behind it means the item left the catalog while
  // it was on the list. Counted rather than hidden: "two items are no longer
  // available" is information; silently showing fewer cards is a bug report.
  const missingCount = savedIds.length - savedProducts.length;

  const openProduct = (product: Product) =>
    navigate(`/products/${encodeURIComponent(product.handle)}`);



  return (
    <main className="flex min-h-screen flex-col bg-background text-[#0a285a]">
      <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openProduct} />

      <div id="main" className="container py-8 sm:py-10">
        <h1 className="text-2xl font-extrabold text-[#0a285a] sm:text-3xl">{t("saved.title")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#536b8c]">
          {savedProducts.length === 0
            ? t("saved.emptyPrompt")
            : savedProducts.length === 1
              ? t("saved.countOne")
              : t("saved.count", { count: savedProducts.length })}
        </p>
        {missingCount > 0 ? (
          <p className="mt-3 rounded-xl border border-[#f2b69e] bg-white px-4 py-3 text-xs font-semibold text-[#a44a2b]">
            {missingCount === 1 ? t("saved.unavailableOne") : t("saved.unavailableCount", { count: missingCount })}
          </p>
        ) : null}

        {isLoading ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[420px] animate-pulse rounded-2xl border border-[#d5dfeb] bg-white/60" />
            ))}
          </div>
        ) : savedProducts.length ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {savedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                saved
                onSave={() => {
                  toggleSaved(product.id);
                  toast(t("saved.removed", { name: product.title }));
                }}
                onQuickView={() => setQuickProduct(product)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-[1.5rem] border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#e7edf5] ink-accent">
              <Heart className="size-6" />
            </div>
            <h2 className="mt-5 text-lg font-extrabold text-[#0a285a]">{t("saved.emptyTitle")}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#536b8c]">
              {t("saved.emptyNote")}
            </p>
            <button
              onClick={() => navigate("/")}
              className="glass glass-navy pressable mt-6 inline-flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold"
            >
              {t("saved.browse")} <ArrowRight className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
        )}
      </div>
      {/* Under the hearts it learns from, and only once it has learned
          something: the rail draws nothing until it is personal. */}
      <RecommendedRail
        saved={savedIds}
        onSave={(id, title) => {
          const adding = !savedIds.includes(id);
          toggleSaved(id);
          toast(t(adding ? "saved.savedForLater" : "saved.removed", { name: title }));
        }}
        onQuickView={setQuickProduct}
      />
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
      <MobileTabBar />
      <div aria-hidden className="h-12 lg:h-16" />
      <SiteFooter />
    </main>
  );
}
