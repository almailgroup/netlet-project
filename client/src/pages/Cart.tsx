/**
 * `/cart`: the bag as a page.
 *
 * The bag was only ever a drawer, so `/cart` answered 404 — nothing could link
 * to it, and on a phone Back from the drawer left the shop rather than closing
 * it. The page draws the drawer's own parts (`BagLines`, `BagSummary`), so the
 * two cannot disagree about a bag: the lines on one side, and on a wide screen
 * the summary beside them where it stays in view down a long bag. The phone's
 * Cart tab opens this; the wide header's cart button keeps the drawer, which
 * is quicker over a page somebody is in the middle of.
 */
import { BagEmpty, BagLines, BagSettling, BagSummary } from "@/components/cart/BagDrawer";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { useCart } from "@/contexts/CartContext";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import { useLocation } from "wouter";

export default function Cart() {
  const { t } = useTranslation();
  const { cart, settling } = useCart();
  const [, navigate] = useLocation();
  usePageMeta(privatePageMeta("Your cart"));
  const items = cart?.items.length ?? 0;

  return (
    <main className="flex min-h-screen flex-col bg-background text-[#0a285a]">
      <StoreHeader />
      <div id="main" className="container py-6 sm:py-10">
        <h1 className="text-2xl font-extrabold sm:text-3xl">{t("cart.title")}</h1>
        {!items && settling ? (
          <div className="mt-6 max-w-2xl"><BagSettling /></div>
        ) : !items ? (
          <div className="mt-6 rounded-2xl border border-[#e6e9ef] bg-white"><BagEmpty heading="h2" onBrowse={() => navigate("/")} /></div>
        ) : (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section aria-label={t("cart.title")} className="min-w-0 rounded-2xl border border-[#e6e9ef] bg-white p-4 sm:p-6"><BagLines /></section>
            <aside aria-label={t("cart.total")} className="rounded-2xl border border-[#e6e9ef] bg-white p-4 sm:p-6 lg:sticky lg:top-[92px]"><BagSummary /></aside>
          </div>
        )}
      </div>
      <SiteFooter />
      <MobileTabBar />
    </main>
  );
}
