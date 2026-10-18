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
 *
 * On a phone the summary comes after the lines, so with three things in the
 * bag Checkout started below the screen, under the tab bar. While it is still
 * below, the total and Checkout float over the tab bar (`PhoneActionBar`), and
 * they leave as the page's own button comes up to meet them.
 */
import { BagLines, BagSettling, BagSummary } from "@/components/cart/BagDrawer";
import { BUTTON_PRIMARY, CARD, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar, TAB_BAR_REACH } from "@/components/layout/PhoneActionBar";
import { useCart } from "@/contexts/CartContext";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { Link } from "wouter";

export default function Cart() {
  const { t } = useTranslation();
  const money = useMoney();
  const { cart, settling, loading, proceedToCheckout } = useCart();
  usePageMeta(privatePageMeta("Your cart"));
  const items = cart?.items.length ?? 0;
  const [checkoutRef, checkoutBelow] = useBeyondScreen("bottom", TAB_BAR_REACH);

  return (
    <PageBody>
      <PageHeading title={t("cart.title")} />
      {!items && settling ? (
        <div className="max-w-2xl"><BagSettling /></div>
      ) : !items ? (
        <EmptyState icon={<ShoppingBag className="size-6" />} title={t("cart.empty")} note={t("cart.emptyNote")}>
          <Link href="/" className={BUTTON_PRIMARY}>{t("cart.keepBrowsing")}</Link>
        </EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label={t("cart.title")} className={`${CARD} min-w-0 p-4 sm:p-6`}><BagLines /></section>
          <aside aria-label={t("cart.total")} className={`${CARD} p-4 sm:p-6 lg:sticky lg:top-[92px]`}><BagSummary checkoutRef={checkoutRef} /></aside>
        </div>
      )}
      {items && cart ? (
        <PhoneActionBar shown={checkoutBelow} label={t("cart.bar")}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 px-1.5 min-[360px]:px-2">
              <p className="text-[12px] font-semibold leading-4 ink-muted">{t("cart.total")}</p>
              <p className="truncate text-[16px] font-extrabold leading-6 text-[#0a285a]">{money(cart.total)}</p>
            </div>
            <button type="button" onClick={proceedToCheckout} disabled={loading} className="glass glass-accent flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold disabled:opacity-60 min-[360px]:px-5">
              {t("cart.checkoutShort")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        </PhoneActionBar>
      ) : null}
    </PageBody>
  );
}
