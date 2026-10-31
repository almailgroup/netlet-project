/**
 * Checkout: what is coming, a code, how it is paid, then place it.
 *
 * **It confirms; it does not ask.** On the owner's word ("in the checkout page
 * you should only confirm your details — your location and your preferred
 * payment method — and then you can place order") the long form went: the
 * governorate, area, block, street, house, name, number and map were typed
 * here on every order. **And where it goes is the cart's alone**, on the
 * owner's word ("remove the Deliver to and Deliver this elsewhere options from
 * the checkout page entirely"): the address in use is chosen on the cart's
 * first card and each line's own on its delivery button (`LineDestination`),
 * so this page draws neither. An order with nowhere to go — Buy now comes
 * here without passing the cart — says so under Place order, and the press
 * opens the address book. What is left is one column of cards: what is coming
 * from each store and when, a code (open, right before paying), how it is
 * paid, and the total with Place order — on a phone the total and Place order
 * also float at the foot while the summary's own button is below the screen.
 *
 * **Cash on delivery is the one method that pays, and the others are drawn as
 * coming**, on the owner's word ("for now add multiple payment methods as a
 * mockup design"). KNET, a card and Apple Pay are choices that cannot be
 * chosen yet, each saying so beside its name, so the page shows what paying
 * will look like without a press on one leading anywhere: a payment button
 * that does nothing is the dead-control rule on the page where it costs most.
 * When a card service is integrated (3.2.1) they become real choices here.
 *
 * Each store's parcel says when it comes — the seller's own band
 * (`deliverySpeed` on the line, `arrivalFor`), and nothing when the seller
 * stated none, since NetLet does not promise for a seller.
 */
import { lineTitle, storeName } from "@/lib/lineTitle";
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/product/Thumb";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useCustomer } from "@/contexts/CustomerContext";
import { BareHeader } from "@/components/layout/BareHeader";
import { CARD, PAGE_SPACE, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar } from "@/components/layout/PhoneActionBar";
import { DeliveryZoneDialog, useDeliveryAddress } from "@/components/cart/DeliveryAddressCard";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { formatPhone, normalisePhone } from "@shared/commerce/wishlist";
import { useAuth } from "@/hooks/useAuth";
import { sharerIdFromCode } from "@shared/commerce/affiliate";
import { trpc } from "@/lib/trpc";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { formatMoney } from "@/lib/format";
import { convertFromDinars } from "@shared/commerce/currency";
import AuthDialog from "@/components/auth/AuthDialog";
import { addressToUse, readLastAddressId, rememberAddress } from "@/lib/lastAddress";
import { heldClaims } from "@/lib/giftClaims";
import { productLinks } from "@/lib/referral";
import { BagSavings, useSavingsBill } from "@/components/cart/BagSavings";
import { pressHaptic } from "@/lib/haptics";
import { bagGroups, type BagGroup } from "@/lib/bagGroups";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Banknote, CreditCard, Info, LoaderCircle, PackageCheck, RotateCcw, ShoppingBag, Smartphone, Store, Truck, Wallet } from "lucide-react";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { cleanParts, hasParts, missingParts, partsProblems } from "@shared/commerce/kuwaitAddress";
import { addressLineOf } from "@shared/commerce/addresses";
import { arrivalFor, isDeliverySpeed, slowestSpeed, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import type { CartItem } from "@shared/commerce/types";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import { shortLines } from "@shared/commerce/typedQuantity";

const fieldClass = "h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[15px] outline-none transition-shadow focus:border-[#0a285a] focus:shadow-[0_0_0_3px_rgba(10,40,90,.12)]";

export default function Checkout() {
  usePageMeta(privatePageMeta("Checkout"));
  const { cart, refreshCart, settling, syncing } = useCart();
  const { t, tError, locale } = useTranslation();
  const money = useMoney();
  const reading = useDisplayCurrency();
  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? { amount: "0", currencyCode: "KWD" };
  const { isAuthenticated, user, loading: sessionLoading } = useAuth();
  const { setDeliveryZoneId } = useCustomer();
  const [, navigate] = useLocation();
  const [authOpen, setAuthOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);

  /* The address in use — the cart's, the header's — and the number on "Your
     profile" for a saved address that carries none. */
  const delivery = useDeliveryAddress();
  const address = delivery.address;
  const details = trpc.customer.details.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const accountPhone = details.data?.phone ? formatPhone(details.data.phone) : "";

  /*
   * A book with no address in the area in use — the area chosen as a guest,
   * say — starts from the address used last here, else the first, as the
   * old checkout did, and the area follows it: an order needs a door, and
   * this is the one the shopper picked most recently.
   */
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !delivery.loaded || address || !delivery.book.length) return;
    adopted.current = true;
    const choice = addressToUse(delivery.book, readLastAddressId());
    if (choice?.governorate) {
      setDeliveryZoneId(choice.governorate);
      rememberAddress(choice.id);
    }
  }, [address, delivery.book, delivery.loaded, setDeliveryZoneId]);

  /* The driver's number: the address's, else the account's, else typed here. */
  const [typedPhone, setTypedPhone] = useState("");
  const savedPhone = address?.contactPhone?.trim() || accountPhone;
  const askPhone = Boolean(isAuthenticated && address && !savedPhone);
  const phone = savedPhone || typedPhone.trim();
  const contactName = address?.contactName?.trim() || user?.name?.trim() || "";
  const parts = address?.parts ?? {};

  /*
   * The first thing in NetLet that creates a real order. It is possible only
   * because cash needs no provider: nothing is authorised or captured, so the
   * order is written `pending_payment` and stays there until a seller records
   * that the driver collected.
   */
  const utils = trpc.useUtils();
  const place = trpc.orders.place.useMutation({
    onSuccess: reply => {
      toast.success(t("checkout.placed", { reference: reply.reference }));
      /* The basket has become the order, so the drawer's copy of it is stale —
         and the drawer's copy is the context's own, which an invalidated query
         does not reach. */
      void utils.commerce.cart.get.invalidate();
      void refreshCart();
      /* To the order just placed, open — not the account's front page, where
         the shopper had to find what they had just bought. */
      navigate(`/account/orders?order=${encodeURIComponent(reply.reference)}`);
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("checkout.placeFailed")),
  });

  /*
   * Why Place order cannot be pressed yet, first reason first, said under the
   * button — a greyed button with no sentence beside it leaves somebody
   * looking for what it wants — and a press on the sentence goes to the fix.
   */
  const blocker: MessageKey | null = !isAuthenticated
    ? null /* said by the sign-in card */
    : settling || !delivery.loaded ? null
    : !items.length ? "checkout.needItems"
    : shortLines(items).size ? "checkout.needFewer"
    : cart?.cod.available === false ? "checkout.needCod"
    : !address ? "checkout.needAddressChoice"
    : !addressLineOf(address) ? "checkout.needAddress"
    : hasParts(parts) && missingParts(parts).length ? "address.needsParts"
    : hasParts(parts) && partsProblems(parts).length ? partsProblems(parts)[0]
    : !phone ? "checkout.needPhone"
    : !normalisePhone(phone) ? "checkout.badPhone"
    : null;
  const canPlace = Boolean(isAuthenticated && !settling && !syncing && !blocker && cart?.id && items.length && cart?.cod.available && address);
  const fixBlocker = () => {
    if (!blocker) return;
    if ((blocker === "checkout.needPhone" || blocker === "checkout.badPhone") && askPhone) {
      const field = document.getElementById("checkout-phone");
      field?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      field?.focus({ preventScroll: true });
      return;
    }
    if (blocker === "checkout.needCod" || blocker === "checkout.needItems") return;
    /* The quantity is changed where the stepper is. */
    if (blocker === "checkout.needFewer") {
      navigate("/cart");
      return;
    }
    setAddressOpen(true);
  };
  const fixable = Boolean(blocker && blocker !== "checkout.needCod" && blocker !== "checkout.needItems");

  /*
   * A discount code, a gift card and points (3.2.3, 3.1.15), each its own
   * row — the cart's own card (`BagSavings`), so what was chosen in the cart
   * is here already and can still be changed. **Open, right before the ways to
   * pay, on the owner's word.** `useSavingsBill` is the arithmetic, the order
   * writer's own `settle`.
   */
  const bill = useSavingsBill();
  /* Whose links the bag's products came through (3.7), said before paying:
     paid promotion is disclosed to the shopper it reaches. Only a member
     whose link earns on it is named, and never this shopper's own. */
  const [links] = useState(() => productLinks());
  const linkCodes = [...new Set(links
    .filter(link => cart?.items.some(line => line.productId === link.productId))
    .map(link => link.code))]
    .filter(code => !user || sharerIdFromCode(code) !== user.id);
  const via = trpc.affiliates.sharers.useQuery({ codes: linkCodes }, { enabled: linkCodes.length > 0, retry: false, staleTime: 5 * 60_000 });
  const sharerNames = (via.data ?? []).map(sharer => sharer.displayName);
  const payable = { amount: bill.payable, currencyCode: "KWD" };

  const placeNow = () => {
    if (!cart || !address) return;
    pressHaptic();
    place.mutate({
      cartId: cart.id,
      paymentMethod: "cod",
      contactName: contactName || null,
      contactPhone: phone || null,
      deliveryZoneId: address.governorate ?? null,
      addressLine: hasParts(parts) ? undefined : (address.addressLine ?? "").trim(),
      addressNotes: address.addressNotes?.trim() || null,
      pin: address.pin ?? null,
      addressParts: cleanParts(parts),
      usePoints: bill.usePoints,
      voucherCode: bill.voucherCode,
      giftCardCode: bill.giftCardCode,
      giftClaims: heldClaims(),
      /* Product links this browser arrived through (3.1.14, 3.7); the server
         keeps only those for products in this order, from members, and never
         the buyer's own. */
      productReferrals: links,
    });
  };

  const [placeRef, placeBelow] = useBeyondScreen("bottom");
  /* Not while somebody is typing: with the keyboard up, a bar at the foot of
     what is left of the screen sits over the field being filled in. */
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => {
      const field = document.activeElement;
      setTyping(field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(field.type)));
    };
    const later = () => setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", later); };
  }, []);

  const placeLabel = t(place.isPending ? "checkout.placing" : "checkout.placeOrder");
  const totalText = settling ? null : money(payable);

  return (
    <div className="type-body flex min-h-screen flex-col bg-background text-[#0a285a]">
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      <BareHeader note={<><Wallet className="size-4 ink-accent" aria-hidden /> {t("home.payOnDelivery")}</>} />

      <main id="main" tabIndex={-1} className={`container flex-1 outline-none ${PAGE_SPACE}`}>
        <div className="mx-auto w-full max-w-2xl lg:max-w-5xl">
          <PageHeading title={t("checkout.heading")} note={t("checkout.confirmNote")} />
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
            <div className="min-w-0 space-y-3">
              {/* Where it goes was chosen in the cart, line by line, on the
                  owner's word, so there is no "Deliver to" here; a guest is
                  asked to sign in, and an order with nowhere to go says so
                  under Place order, whose press opens the address book. */}
              {isAuthenticated || sessionLoading ? null : <SignInCard onSignIn={() => setAuthOpen(true)} />}
              {addressOpen ? <Suspense fallback={null}><DeliveryZoneDialog open onClose={() => setAddressOpen(false)} /></Suspense> : null}
              {/* A saved address with no number, on an account with none: the
                  driver has to be able to ring the door. */}
              {askPhone ? (
                <div className={`${CARD} p-4 sm:p-5`}>
                  <label htmlFor="checkout-phone" className="text-[13px] font-bold text-[#0a285a]">{t("checkout.driverPhone")}</label>
                  <input id="checkout-phone" type="tel" value={typedPhone} onChange={event => setTypedPhone(event.target.value)} placeholder="+965" dir="ltr" inputMode="tel" autoComplete="tel" enterKeyHint="done" className={`${fieldClass} mt-2`} />
                  <p className="mt-1.5 text-[12px] leading-5 ink-muted">{t("checkout.driverPhoneNote")}</p>
                </div>
              ) : null}
              <OrderItems />
              {/* A code, a gift card and points — right before the ways to
                  pay, open. */}
              <section aria-label={t("cart.savingsHeading")} className={`${CARD} px-4 sm:px-5`}>
                <BagSavings />
              </section>
              <PaymentMethods />
            </div>

            <aside aria-label={t("checkout.orderSummary")} aria-busy={settling || syncing} className={`${CARD} p-4 sm:p-5 lg:sticky lg:top-6`}>
              <h2 className="text-[17px] font-extrabold">{t("checkout.orderSummary")}</h2>
              <dl className="mt-3 space-y-2 text-[14px]">
                <Row label={<>{t("cart.subtotal")} <span className="ink-muted">({t("cart.itemCount", { count: cart?.itemCount ?? 0 })})</span></>} value={settling ? null : money(subtotal)} />
                <Row label={t("cart.delivery")} value={settling ? null : cart ? (Number(cart.delivery.total.amount) > 0 ? money(cart.delivery.total) : t("cart.deliveryFree")) : null} faint={syncing} />
                {Number(bill.discountOff) > 0 ? <Row label={t("checkout.discountRow")} value={`−${money({ amount: bill.discountOff, currencyCode: "KWD" })}`} good /> : null}
                {Number(bill.pointsOff) > 0 ? <Row label={t("checkout.pointsRow")} value={`−${money({ amount: bill.pointsOff, currencyCode: "KWD" })}`} good /> : null}
                {Number(bill.giftOff) > 0 ? <Row label={t("checkout.giftCardRow")} value={`−${money({ amount: bill.giftOff, currencyCode: "KWD" })}`} good /> : null}
              </dl>
              {/* A member's free delivery (4.1), said with what it saved. */}
              {cart?.delivery.memberWaived ? <p className="mt-2 text-[12px] font-bold text-[#2f5d33]">{t("membership.deliveryWaived", { amount: money(cart.delivery.memberWaived) })}</p> : null}
              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[#e6e9ef] pt-3">
                <span className="text-[15px] font-bold">{t("cart.total")}</span>
                <span className={`text-[20px] font-extrabold transition-opacity ${syncing ? "opacity-50" : ""}`}>{totalText ?? <span aria-hidden className="inline-block h-5 w-24 animate-pulse rounded bg-[#e7edf5] align-middle" />}</span>
              </div>
              {/* Read in another currency: the total in it, marked as the
                  estimate it is — the dinars above are what is collected. */}
              {reading.code !== "KWD" && !settling ? (
                <p className="mt-1 text-end text-[13px] font-semibold ink-muted">
                  ≈ {formatMoney(convertFromDinars(Number(payable.amount), reading.code, reading.rates), { currencyCode: reading.code, locale })}
                  <span className="block text-[12px] font-normal">{t("currency.chargedNote")}</span>
                </p>
              ) : null}
              {sharerNames.length ? <p className="mt-3 text-[12px] leading-5 ink-muted">{t("affiliate.viaDisclosure", { name: new Intl.ListFormat(locale, { type: "conjunction" }).format(sharerNames) })}</p> : null}
              {isAuthenticated || sessionLoading ? (
                <button
                  ref={placeRef}
                  type="button"
                  onClick={placeNow}
                  disabled={!canPlace || place.isPending}
                  aria-describedby={blocker ? "place-blocker" : undefined}
                  className="glass-accent mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-[16px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {place.isPending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <PackageCheck className="size-5" aria-hidden />}
                  {placeLabel}
                  {canPlace && !place.isPending && totalText ? <span className="font-semibold">· {totalText}</span> : null}
                </button>
              ) : (
                <button ref={placeRef} type="button" onClick={() => setAuthOpen(true)} className="glass glass-navy mt-4 flex h-14 w-full items-center justify-center rounded-2xl px-5 text-[16px] font-bold">
                  {t("checkout.signInShort")}
                </button>
              )}
              {blocker ? (
                <button id="place-blocker" type="button" onClick={fixBlocker} disabled={!fixable} className="mt-2.5 flex w-full items-start gap-1.5 rounded-lg px-1 py-1 text-start text-[13px] font-bold leading-5 ink-accent disabled:cursor-default">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t(blocker)}
                </button>
              ) : null}
              <ul className="mt-4 space-y-1.5 border-t border-[#e6e9ef] pt-3 text-[12px] ink-muted">
                <li className="flex items-center gap-2"><RotateCcw className="size-3.5 shrink-0" aria-hidden />{t("home.returnsWithin", { days: RETURN_WINDOW_DAYS })}</li>
                <li className="flex items-center gap-2"><Truck className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />{t("checkout.parcelsNote")}</li>
              </ul>
            </aside>
          </div>
        </div>
      </main>
      {items.length || settling ? (
        <PhoneActionBar shown={placeBelow && !typing} label={t("checkout.placeBar")} overTabBar={false}>
          {blocker ? (
            <button type="button" onClick={fixBlocker} disabled={!fixable} className="mb-1.5 flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-start text-[13px] font-bold leading-5 ink-accent disabled:cursor-default">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t(blocker)}
            </button>
          ) : null}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 px-1.5 min-[360px]:px-2">
              <p className="text-[12px] font-semibold leading-4 ink-muted">{t("cart.total")}</p>
              <p className={`truncate text-[16px] font-extrabold leading-6 text-[#0a285a] transition-opacity ${syncing ? "opacity-50" : ""}`}>{totalText ?? <span className="inline-block h-4 w-20 animate-pulse rounded bg-[#e7edf5] align-middle" aria-hidden />}</p>
            </div>
            {!isAuthenticated && !sessionLoading ? (
              <button type="button" onClick={() => setAuthOpen(true)} className="glass glass-navy flex h-11 shrink-0 items-center justify-center rounded-xl px-4 text-[14px] font-bold">{t("checkout.signInShort")}</button>
            ) : (
              <button type="button" onClick={placeNow} disabled={!canPlace || place.isPending} className="glass-accent flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-55 min-[360px]:px-5">
                {place.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />}
                {placeLabel}
              </button>
            )}
          </div>
        </PhoneActionBar>
      ) : null}
    </div>
  );
}

function Row({ label, value, faint = false, good = false }: { label: ReactNode; value: ReactNode | null; faint?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[#404553]">{label}</dt>
      <dd className={`shrink-0 font-bold transition-opacity ${good ? "text-[#2f5d33]" : ""} ${faint ? "opacity-50" : ""}`}>
        {value ?? <span aria-hidden className="inline-block h-3.5 w-16 animate-pulse rounded bg-[#e7edf5] align-middle" />}
      </dd>
    </div>
  );
}

/** Signed out there is no address book and no order: sign in here, keeping the bag. */
function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <section className={`${CARD} p-4 sm:p-5`}>
      <h2 className="text-[15px] font-extrabold">{t("checkout.signInTitle")}</h2>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("checkout.signInToOrder")}</p>
      <button type="button" onClick={onSignIn} className="glass glass-navy mt-3 inline-flex h-11 items-center justify-center rounded-full px-5 text-[14px] font-bold">
        {t("checkout.signInHere")}
      </button>
    </section>
  );
}

/**
 * What is coming, from each store: its lines, what its delivery costs and
 * when it comes. Read-only — the bag is where the quantities change, and
 * "Edit" goes back to it.
 */
function OrderItems() {
  const { cart, settling } = useCart();
  const { t, isArabic } = useTranslation();
  if (settling && !cart?.items.length) {
    return (
      <div aria-hidden className={`${CARD} space-y-3 p-4`}>
        {[0, 1].map(row => (
          <div key={row} className="flex gap-3">
            <div className="size-14 shrink-0 animate-pulse rounded-xl bg-[#e7edf5]" />
            <div className="flex-1 space-y-2 pt-1"><div className="h-3.5 w-3/4 animate-pulse rounded bg-[#e7edf5]" /><div className="h-3 w-1/3 animate-pulse rounded bg-[#e7edf5]" /></div>
          </div>
        ))}
      </div>
    );
  }
  if (!cart?.items.length) return null;
  const groups = bagGroups(cart);
  return (
    <section aria-labelledby="checkout-items-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1 pt-1">
        <h2 id="checkout-items-title" className="text-[15px] font-extrabold">{t("checkout.itemsTitle", { count: cart.itemCount })}</h2>
        <Link href="/cart" className="inline-flex min-h-11 items-center rounded-full px-2 text-[13px] font-bold ink-accent hover:underline">{t("checkout.editCart")}</Link>
      </div>
      {groups ? groups.map(group => (
        <StoreParcel key={group.key} group={group} name={storeName({ vendorName: group.store.name, vendorNameAr: group.store.nameAr }, isArabic)} />
      )) : (
        <div className={`${CARD} divide-y divide-[#eef1f5] px-4`}>{cart.items.map(item => <ItemRow key={item.lineId} item={item} />)}</div>
      )}
    </section>
  );
}

function StoreParcel({ group, name }: { group: BagGroup; name: string }) {
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  const { syncing } = useCart();
  const shortDay = (value: Date) => value.toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SHOP_TIME_ZONE });
  const arrival = (speed: DeliverySpeed | null) => {
    if (!speed) return null;
    const when = arrivalFor(speed);
    if (!when.from || !when.to) return t(`speed.${speed}` as MessageKey);
    return when.from.getTime() === when.to.getTime()
      ? t("checkout.arrivesOne", { date: shortDay(when.to) })
      : t("checkout.arrives", { from: shortDay(when.from), to: shortDay(when.to) });
  };
  const speedOf = (items: CartItem[], fast: boolean) => slowestSpeed(items.map(item => {
    const band = fast ? item.fastDelivery?.speed : item.deliverySpeed;
    return isDeliverySpeed(band) ? band : null;
  }));
  return (
    <div role="group" aria-label={t("browse.soldBy", { name })} className={`${CARD} overflow-hidden`}>
      <p className="flex items-center gap-2 border-b border-[#eef1f5] px-4 py-3 text-[14px] font-extrabold">
        <Store className="size-4 shrink-0" aria-hidden />
        <span dir="auto" className="truncate">{t("browse.soldBy", { name })}</span>
      </p>
      <div className="divide-y divide-[#eef1f5] px-4">{group.items.map(item => <ItemRow key={item.lineId} item={item} />)}</div>
      <div className={`space-y-1 border-t border-[#eef1f5] bg-[#fafbfc] px-4 py-3 transition-opacity ${syncing ? "opacity-50" : ""}`}>
        {group.delivery.map(row => {
          const fast = row.choice === "fast";
          const when = arrival(speedOf(group.items.filter(item => (item.deliveryChoice === "fast") === fast), fast));
          return (
            <div key={`${row.destinationLabel ?? ""}|${row.choice ?? ""}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span className="flex items-center gap-1.5 font-semibold text-[#404553]">
                <Truck className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
                <span dir="auto">
                  {row.destinationLabel ? `${t("address.sendingTo", { label: row.destinationLabel })} · ` : ""}
                  {fast ? t("delivery.fastTag") : t("cart.delivery")}: {row.free ? <span className="text-[#2f5d33]">{t("cart.deliveryFree")}</span> : money(row.fee)}
                </span>
              </span>
              {when ? <span className="font-bold text-[#2f5d33]">{when}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: CartItem }) {
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  const title = lineTitle(item, isArabic);
  const variant = isDefaultVariantTitle(item.variantTitle) ? null : item.variantTitle;
  return (
    <div className="flex gap-3 py-3">
      <div className="size-14 shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-[#f4f6f9]">
        <Thumb src={item.image?.url} alt={item.image?.altText ?? title} className="size-full object-cover" icon={<ShoppingBag className="size-4" />} />
      </div>
      <div className="min-w-0 flex-1">
        <p dir="auto" className="line-clamp-2 text-[14px] font-bold leading-5">{title}</p>
        {variant ? <p dir="auto" className="mt-0.5 text-[12px] ink-muted">{variant}</p> : null}
        <p className="mt-0.5 text-[12px] ink-muted">{t("cart.quantityShort", { count: item.quantity })}</p>
      </div>
      <p className="shrink-0 text-[14px] font-extrabold">{money(item.lineTotal)}</p>
    </div>
  );
}

/**
 * How it is paid. Cash on delivery is the one that works and is chosen; the
 * rest are drawn as they will be, each marked as coming and none choosable,
 * so the page shows what paying will look like without a press leading to an
 * order nobody can pay for (3.2.1 waits on a card service).
 */
function PaymentMethods() {
  const { cart } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const codRefused = cart?.cod.available === false ? cart.cod.because : null;
  const option = (key: string, icon: ReactNode, title: string, note: string, state: "chosen" | "soon" | "refused") => (
    <label
      key={key}
      className={`flex items-center gap-3 rounded-xl border p-3 ${state === "chosen" ? "border-[#0a285a] bg-[#f6f8fb] shadow-[inset_0_0_0_1px_#0a285a]" : "border-[#e6e9ef] bg-white"} ${state === "chosen" ? "cursor-pointer" : "cursor-not-allowed"}`}
    >
      <input
        type="radio"
        name="payment-method"
        value={key}
        checked={state === "chosen"}
        disabled={state !== "chosen"}
        readOnly
        aria-describedby={`pay-${key}-note`}
        className="size-4 shrink-0 accent-[#0a285a]"
      />
      <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${state === "chosen" ? "bg-[#0a285a] text-white" : "bg-[#f0f2f5] text-[#536b8c]"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-bold ${state === "chosen" ? "text-[#0a285a]" : "text-[#404553]"}`}>{title}</span>
        <span id={`pay-${key}-note`} className="block text-[12px] leading-4 ink-muted">{note}</span>
      </span>
      {state === "soon" ? <span className="shrink-0 rounded-full bg-[#f0f2f5] px-2.5 py-1 text-[11px] font-bold text-[#536b8c]">{t("checkout.paySoon")}</span> : null}
    </label>
  );
  return (
    <fieldset className={`${CARD} p-4 sm:p-5`}>
      <legend className="sr-only">{t("checkout.paymentMethod")}</legend>
      <p aria-hidden className="mb-3 text-[15px] font-extrabold">{t("checkout.paymentMethod")}</p>
      <div className="space-y-2">
        {option("cod", <Banknote className="size-5" />, t("checkout.payCod"), t("checkout.payCodNote"), codRefused ? "refused" : "chosen")}
        {codRefused ? (
          <p className="rounded-xl border border-[#f0d3c6] bg-[#fdf3ee] p-3 text-[13px] leading-5 text-[#8c2f22]">
            {codRefused.kind === "shop" ? t("checkout.codUnavailableShop")
              : codRefused.kind === "seller" ? t("checkout.codUnavailableSeller", { name: codRefused.vendorName })
              : t("checkout.codUnavailableCeiling", { name: codRefused.vendorName, amount: money({ amount: codRefused.ceiling, currencyCode: "KWD" }) })}
          </p>
        ) : null}
        {option("knet", <span className="text-[11px] font-extrabold tracking-tight">KNET</span>, t("checkout.payKnet"), t("checkout.payKnetNote"), "soon")}
        {option("card", <CreditCard className="size-5" />, t("checkout.payCard"), t("checkout.payCardNote"), "soon")}
        {option("apple", <Smartphone className="size-5" />, t("checkout.payApple"), t("checkout.payAppleNote"), "soon")}
      </div>
    </fieldset>
  );
}
