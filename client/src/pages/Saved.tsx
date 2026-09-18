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
import { ProductCard } from "@/components/ProductCard";
import { QuickView } from "@/components/QuickView";
import { StoreHeader } from "@/components/StoreHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/lib/usePageMeta";
import { useTranslation } from "@/lib/useTranslation";
import { privatePageMeta } from "@shared/seo";
import type { Product } from "@shared/commerce/types";
import { ArrowLeft, ArrowRight, Heart, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function Saved() {
  usePageMeta(privatePageMeta("Saved items"));
  const [, navigate] = useLocation();
  const { savedIds, toggleSaved } = useCustomer();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const { addItem, loading: cartLoading } = useCart();
  const { data: catalog = [], isLoading } = trpc.commerce.products.list.useQuery({ first: 60 });

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
    window.location.assign(appPath(`/products/${encodeURIComponent(product.handle)}`));

  const addToCart = async (product: Product, quantity = 1) => {
    const variant = product.variants[0];
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    try {
      await addItem(variant.id, quantity);
      // The confirmation counts when the count is not one: "added to your cart"
      // after picking three is a receipt that does not match the request.
      toast.success(quantity > 1
        ? t("cart.addedQuantity", { count: String(quantity), name: product.title })
        : t("cart.added", { name: product.title }));
    } catch {
      toast.error(t("cart.addFailed"));
    }
  };

  const buyNow = async (product: Product, quantity = 1) => {
    const variant = product.variants[0];
    if (!variant?.availableForSale) return toast.error(t("cart.itemUnavailable"));
    try {
      await addItem(variant.id, quantity);
      window.location.assign(appPath("/checkout"));
    } catch {
      toast.error(t("cart.buyFailed"));
    }
  };

  return (
    <main className="min-h-screen bg-background pb-28 text-[#0a285a] lg:pb-16">
      <StoreHeader catalog={catalog} search={search} onSearch={setSearch} onSelectProduct={openProduct} />

      <div id="main" className="container py-8 sm:py-10">
        <p className="text-[10px] font-extrabold tracking-[.15em] text-[#a44a2b] uppercase">{t("saved.eyebrow")}</p>
        <h1 className="display-face mt-2 text-4xl text-[#0a285a] sm:text-5xl">{t("saved.title")}</h1>
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
                onDetails={() => openProduct(product)}
                onQuickView={() => setQuickProduct(product)}
                onAdd={(quantity) => void addToCart(product, quantity)}
                onBuyNow={(quantity) => void buyNow(product, quantity)}
                isAdding={cartLoading}
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

        {cartLoading ? (
          <p className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold ink-muted">
            <LoaderCircle className="size-3.5 animate-spin" />{t("saved.updatingCart")}
          </p>
        ) : null}
      </div>
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
      <MobileTabBar />
    </main>
  );
}
