/**
 * `/cart`: the bag as a page.
 *
 * The bag was only ever a drawer, so `/cart` answered 404 — nothing could link
 * to it, and on a phone Back from the drawer left the shop rather than closing
 * it. The page draws the drawer's own parts (`BagLines`, `BagSummary`), so the
 * two cannot disagree about a bag: the lines on one side, by store, and on a
 * wide screen the summary beside them where it stays in view down a long bag.
 * The phone's Cart tab opens this; the wide header's cart button keeps the
 * drawer, which is quicker over a page somebody is in the middle of.
 *
 * **On a phone it opens on where the order is going and on the wishlists, on
 * the owner's word** (`CartTopBar`): the page has no header there (see
 * `StorefrontShell`), so the delivery location the header carried is at the
 * start of its own bar — the address book, as the header's opens — and a heart
 * to the wishlists at the end, the place somebody sends what they decided not
 * to buy yet.
 *
 * On a phone the summary comes after the lines, so with three things in the
 * bag Checkout started below the screen, under the tab bar. While it is still
 * below, the total and Checkout float over the tab bar (`PhoneActionBar`), and
 * they leave as the page's own button comes up to meet them.
 */
import { BagLines, BagSettling, BagSummary } from "@/components/cart/BagDrawer";
import { BUTTON_PRIMARY, CARD, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar, TAB_BAR_REACH } from "@/components/layout/PhoneActionBar";
import { useDeliveryArea } from "@/components/layout/deliveryArea";
import { PixelBadge } from "@/components/ui/PixelBadge";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { lazyPage } from "@/lib/lazyPage";
import { privatePageMeta } from "@shared/seo";
import { ArrowRight, ChevronDown, Heart, MapPin, ShoppingBag } from "lucide-react";
import { Suspense, useState } from "react";
import { Link } from "wouter";

const DeliveryZoneDialog = lazyPage(async () => ({ default: (await import("@/components/layout/DeliveryZoneDialog")).DeliveryZoneDialog }));

export default function Cart() {
  const { t } = useTranslation();
  const money = useMoney();
  const { cart, settling, proceedToCheckout } = useCart();
  usePageMeta(privatePageMeta("Your cart"));
  const items = cart?.items.length ?? 0;
  const [checkoutRef, checkoutBelow] = useBeyondScreen("bottom", TAB_BAR_REACH);
  const wide = useMediaQuery("(min-width: 1024px)");

  return (
    <PageBody>
      {wide ? null : <CartTopBar />}
      <PageHeading title={t("cart.title")} note={items && cart ? t("cart.itemCount", { count: cart.itemCount }) : undefined} />
      {!items && settling ? (
        <div className="max-w-2xl"><BagSettling /></div>
      ) : !items ? (
        <EmptyState icon={<ShoppingBag className="size-6" />} title={t("cart.empty")} note={t("cart.emptyNote")}>
          <Link href="/" className={BUTTON_PRIMARY}>{t("cart.keepBrowsing")}</Link>
        </EmptyState>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          <div className="min-w-0"><BagLines layout="page" /></div>
          <aside aria-label={t("checkout.orderSummary")} className={`${CARD} p-4 sm:p-6 lg:sticky lg:top-[92px]`}><BagSummary checkoutRef={checkoutRef} heading /></aside>
        </div>
      )}
      {items && cart ? (
        <PhoneActionBar shown={checkoutBelow} label={t("cart.bar")}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 px-1.5 min-[360px]:px-2">
              <p className="text-[12px] font-semibold leading-4 ink-muted">{t("cart.total")}</p>
              <p className="truncate text-[16px] font-extrabold leading-6 text-[#0a285a]">{money(cart.total)}</p>
            </div>
            <button type="button" onClick={proceedToCheckout} className="glass glass-accent flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold min-[360px]:px-5">
              {t("cart.checkoutShort")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        </PhoneActionBar>
      ) : null}
    </PageBody>
  );
}

/**
 * Where the order is going, at the start, and the wishlists, at the end. The
 * location is the header's own (`useDeliveryArea`) and opens the same address
 * book; here it says "Deliver to" out loud, having the room the header did
 * not. The heart goes to the account's wishlists, or for a guest — who has no
 * lists, only hearts kept on the device — to Saved, and counts the hearts.
 */
function CartTopBar() {
  const { t } = useTranslation();
  const area = useDeliveryArea();
  const { isAuthenticated } = useAuth();
  const { savedIds } = useCustomer();
  const [open, setOpen] = useState(false);
  return (
    <div className="-mt-2 mb-4 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => { pressHaptic(); setOpen(true); }}
        title={area.title}
        className="pressable -ms-2 flex min-h-12 min-w-0 items-center gap-2.5 rounded-2xl px-2 text-start text-[#0a285a] hover:bg-[#0a285a]/[.06]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#fdf3ee]">
          <MapPin className="size-[18px] ink-accent" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] font-medium leading-4 ink-muted">{t("home.deliverTo")} </span>
          <span className="flex min-w-0 items-center gap-1 text-[15px] font-bold leading-5">
            <span dir="auto" className="truncate">{area.name}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          </span>
        </span>
      </button>
      <Link
        href={isAuthenticated ? "/account/wishlists" : "/saved"}
        aria-label={isAuthenticated ? t("cart.wishlists") : t("nav.saved")}
        title={isAuthenticated ? t("cart.wishlists") : t("nav.saved")}
        className="pressable relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_1px_4px_rgba(10,40,90,.12)] hover:bg-[#f0f2f5]"
      >
        <Heart className="size-5" aria-hidden />
        <PixelBadge value={savedIds.length} className="absolute -end-1.5 -top-1.5" />
      </Link>
      {open ? <Suspense fallback={null}><DeliveryZoneDialog open onClose={() => setOpen(false)} /></Suspense> : null}
    </div>
  );
}
