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
 * **It asks where the order is going, on the owner's word** — checkout only
 * confirms it. The first card is the address (`DeliveryAddressCard`): the one
 * in use with Change, or the question, and Checkout pressed without one opens
 * the address book first and goes on once one is chosen. The heart to Saved
 * items is at the end of the title's line. Under the bag, what was saved
 * for later (`SavedForLater`), each with a way back in; every line has a menu
 * (`LineMenu`) that puts it there.
 *
 * On a phone the summary comes after the lines, so with three things in the
 * bag Checkout started below the screen, under the tab bar. While it is still
 * below, the total and Checkout float over the tab bar (`PhoneActionBar`), and
 * they leave as the page's own button comes up to meet them.
 *
 * **Every width draws the phone's page, in the middle of the screen, on the
 * owner's word** — the account's rule (`COLUMN`). A wide screen spread the
 * bag from the logo's line to the edge with its title alone over it, and
 * nothing saying where it was going: the old page beside the phone's new one.
 * It is the same title, address and store cards now, centred; from `lg` the summary
 * stands beside the lines rather than under them, so Checkout stays on the
 * screen down a long bag, and the two together are as wide as the account's
 * column plus the summary.
 */
import { BagLines, BagSettling, BagSummary } from "@/components/cart/BagDrawer";
import { DeliveryAddressCard, useDeliveryAddress } from "@/components/cart/DeliveryAddressCard";
import { SavedForLater } from "@/components/cart/SavedForLater";
import { BUTTON_PRIMARY, CARD, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar, TAB_BAR_REACH } from "@/components/layout/PhoneActionBar";
import { CountBadge } from "@/components/ui/CountBadge";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { formatPhone } from "@shared/commerce/wishlist";
import { privatePageMeta } from "@shared/seo";
import { ArrowRight, Heart, ShoppingBag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

/* The phone's column, centred: the account's width until there is room for the
   summary beside the lines. */
const COLUMN = "mx-auto w-full max-w-2xl lg:max-w-5xl";

export default function Cart() {
  const { t } = useTranslation();
  const money = useMoney();
  const { cart, settling, proceedToCheckout } = useCart();
  const { user, isAuthenticated } = useAuth();
  usePageMeta(privatePageMeta("Your cart"));
  const items = cart?.items.length ?? 0;
  const [checkoutRef, checkoutBelow] = useBeyondScreen("bottom", TAB_BAR_REACH);
  const delivery = useDeliveryAddress();
  const details = trpc.customer.details.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });

  /*
   * Checkout asks where first. A signed-in shopper with no address in use is
   * shown the address book on the press, and goes on to checkout as soon as
   * one is chosen — waiting a moment for the book to answer, since a new
   * address is saved and then read back. Closing the book without choosing
   * stays on the cart.
   */
  const [addressOpen, setAddressOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const giveUp = useRef<number | null>(null);
  const goToCheckout = () => {
    if (delivery.isAuthenticated && delivery.loaded && !delivery.address) {
      setContinuing(true);
      setAddressOpen(true);
      return;
    }
    proceedToCheckout();
  };
  const closeAddress = () => {
    setAddressOpen(false);
    if (giveUp.current) window.clearTimeout(giveUp.current);
    giveUp.current = window.setTimeout(() => setContinuing(false), 3000);
  };
  useEffect(() => {
    if (!continuing || addressOpen || !delivery.address) return;
    setContinuing(false);
    proceedToCheckout();
  }, [continuing, addressOpen, delivery.address, proceedToCheckout]);
  useEffect(() => () => { if (giveUp.current) window.clearTimeout(giveUp.current); }, []);

  return (
    <PageBody>
      <div data-cart-column className={COLUMN}>
        <PageHeading
          title={t("cart.title")}
          note={items && cart ? t("cart.itemCount", { count: cart.itemCount }) : undefined}
          actions={<SavedLink />}
        />
        {!items && settling ? (
          <BagSettling />
        ) : !items ? (
          <>
            <EmptyState icon={<ShoppingBag className="size-6" />} title={t("cart.empty")} note={t("cart.emptyNote")}>
              <Link href="/" className={BUTTON_PRIMARY}>{t("cart.keepBrowsing")}</Link>
            </EmptyState>
            <SavedForLater className="mt-6" />
          </>
        ) : (
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
            <div className="min-w-0 space-y-3">
              <DeliveryAddressCard
                open={addressOpen}
                onOpen={() => setAddressOpen(true)}
                onClose={closeAddress}
                accountName={user?.name}
                accountPhone={details.data?.phone ? formatPhone(details.data.phone) : null}
              />
              <BagLines layout="page" />
              {/* Directly under the lines, on the owner's word, so something
                  kept for later is a press from going back in. */}
              <SavedForLater className="pt-3" />
            </div>
            <aside aria-label={t("checkout.orderSummary")} className={`${CARD} p-4 sm:p-6 lg:sticky lg:top-[92px]`}><BagSummary checkoutRef={checkoutRef} heading onCheckout={goToCheckout} /></aside>
          </div>
        )}
      </div>
      {items && cart ? (
        <PhoneActionBar shown={checkoutBelow} label={t("cart.bar")}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 px-1.5 min-[360px]:px-2">
              <p className="text-[12px] font-semibold leading-4 ink-muted">{t("cart.total")}</p>
              <p className="truncate text-[16px] font-extrabold leading-6 text-[#0a285a]">{money(cart.total)}</p>
            </div>
            <button type="button" onClick={goToCheckout} className="glass glass-accent flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold min-[360px]:px-5">
              {t("cart.checkoutShort")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        </PhoneActionBar>
      ) : null}
    </PageBody>
  );
}

/**
 * Saved items, at the end of the title's line, counted: the hearts, where
 * somebody keeps what they decided not to buy yet — the header's heart, on the
 * owner's word. The wishlists are a row of the account page.
 */
function SavedLink() {
  const { t } = useTranslation();
  const { savedIds } = useCustomer();
  const name = t("header.savedItems", { count: savedIds.length });
  return (
    <Link
      href="/saved"
      aria-label={name}
      title={name}
      className="pressable relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_1px_4px_rgba(10,40,90,.12)] hover:bg-[#f0f2f5]"
    >
      <Heart className="size-5" aria-hidden />
      <CountBadge value={savedIds.length} className="absolute -end-1.5 -top-1.5" />
    </Link>
  );
}
