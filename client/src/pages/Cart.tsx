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
import { BagLines, BagSettling, BagSummary } from "@/components/cart/BagDrawer";
import { BUTTON_PRIMARY, CARD, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { useCart } from "@/contexts/CartContext";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import { ShoppingBag } from "lucide-react";
import { Link } from "wouter";

export default function Cart() {
  const { t } = useTranslation();
  const { cart, settling } = useCart();
  usePageMeta(privatePageMeta("Your cart"));
  const items = cart?.items.length ?? 0;

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
          <aside aria-label={t("cart.total")} className={`${CARD} p-4 sm:p-6 lg:sticky lg:top-[92px]`}><BagSummary /></aside>
        </div>
      )}
    </PageBody>
  );
}
