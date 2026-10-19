/**
 * Checkout: where it goes, and cash on delivery.
 *
 * Cash is the one way to pay (3.2.2), and the page says so in a shopper's
 * words. It used to carry "Payment mockup only", a row of KNET, Visa,
 * Mastercard and Google Pay logos, and "Cards, KNET and instalments are not
 * connected yet" — a developer's status report on the one page where a shopper
 * reads every line, and four brands drawn beside an order they cannot pay
 * with. When a card service is integrated (3.2.1) the methods come back as
 * real choices in the payment fieldset, not as logos.
 */
import { AddressPartsFields } from "@/components/account/AddressPartsFields";
import { addressLineOf } from "@shared/commerce/addresses";
import { cleanParts, hasParts, missingParts, partsProblems, type AddressParts } from "@shared/commerce/kuwaitAddress";
import { lineTitle, storeName } from "@/lib/lineTitle";
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/product/Thumb";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useCustomer } from "@/contexts/CustomerContext";
import { BareHeader } from "@/components/layout/BareHeader";
import { PAGE_SPACE, PageHeading } from "@/components/layout/Page";
import { PhoneActionBar } from "@/components/layout/PhoneActionBar";
import { useBeyondScreen } from "@/hooks/useBeyondScreen";
import { kuwaitDeliveryZones } from "@shared/customer";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { normalisePhone } from "@shared/commerce/wishlist";
import { useAuth } from "@/hooks/useAuth";
import { pointsSpendableOn, spendValue } from "@shared/commerce/referral";
import { giftCardPayment, settle } from "@shared/commerce/vouchers";
import { subtractMoney } from "@shared/money";
import { trpc } from "@/lib/trpc";
import { ItemDestinations } from "@/components/cart/ItemDestinations";
import { useEffect, useState } from "react";
import AuthDialog from "@/components/auth/AuthDialog";
import { addressToUse, readLastAddressId, rememberAddress } from "@/lib/lastAddress";
import { currentAffiliate } from "@/lib/affiliate";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Info, LoaderCircle, MapPin, PackageCheck, RotateCcw, ShoppingBag, Truck, Wallet } from "lucide-react";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { PinPicker } from "@/components/map/PinPicker";
import type { Pin } from "@shared/commerce/geo";
import { Select } from "@/components/ui/Select";


const fieldClass = "type-body mt-2 h-11 w-full rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-3 outline-none transition-shadow focus:shadow-[0_0_0_4px_rgba(20,52,203,.10)]";

function CheckoutField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`type-label text-[#0a285a] ${className}`}>{label}{children}</label>;
}

/*
 * The governorate is the only region control on this page, and there used to be
 * two.
 *
 * An "Area" dropdown sat in the form below with no `value`, no `onChange` and
 * options carrying no `value` attribute — so a shopper picked Salmiya and it
 * went nowhere. Nothing downstream could have taken it either: an order stores
 * `delivery_zone_id`, `address_line` and `address_notes`, and a saved address
 * has the same three, so there is no field for an area to be. It was also the
 * dishonest half of the pair — five hard-coded names out of the dozens Kuwait
 * has, beside a governorate list that is complete.
 *
 * The street and the district go in the address line, which is what the account
 * page's own address form does.
 */
function CheckoutDeliveryZone() {
  const { deliveryZone, deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  const zoneName = (zone: { label: string; labelAr: string }) => (isArabic ? zone.labelAr : zone.label);
  return <div className="mt-5 rounded-2xl border border-[#d5dfeb] bg-[#f3f2ed] p-4"><div className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 shrink-0 ink-accent" /><div className="min-w-0 flex-1"><label className="block"><span className="type-label text-[#0a285a]">{t("checkout.governorateLabel")}</span><Select id="checkout-governorate" value={deliveryZoneId ?? ""} onChange={event => setDeliveryZoneId(event.target.value)} className={`${fieldClass} mt-2`}><option value="" disabled>{t("delivery.selectGovernorate")}</option>{kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zoneName(zone)}</option>)}</Select></label><p className="type-body mt-3 text-xs leading-5 text-[#536b8c]">{deliveryZone ? t("delivery.savedForDevice", { name: zoneName(deliveryZone) }) : t("delivery.chooseForDevice")}</p></div></div></div>;
}


export default function Checkout() {
  usePageMeta(privatePageMeta("Checkout"));
  const { cart, refreshCart, settling, syncing } = useCart();
  const { t, tError, isArabic } = useTranslation();
  const money = useMoney();
  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? { amount: "0", currencyCode: "KWD" };
  const { isAuthenticated, user, loading: sessionLoading } = useAuth();
  const { deliveryZone, deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const [, navigate] = useLocation();
  /* The address as its parts (`AddressPartsFields`); `addressLine` is kept for
     a saved address from before the parts, which has only that. */
  const [form, setForm] = useState<{ contactName: string; contactPhone: string; addressLine: string; addressNotes: string; pin: Pin | null; parts: AddressParts }>({ contactName: "", contactPhone: "", addressLine: "", addressNotes: "", pin: null, parts: {} });
  const [authOpen, setAuthOpen] = useState(false);
  const zoneLabel = deliveryZone ? (isArabic ? deliveryZone.labelAr : deliveryZone.label) : null;

  /*
   * Fast checkout (3.2.9): somebody who has ordered before should not type
   * their address again. The address book is offered as one-tap choices, the
   * one used last on this device is chosen already, and picking one fills
   * every field — including the governorate, which is what prices delivery.
   * The fields stay editable: a change is for this order and leaves the saved
   * address alone. A first-time address is saved for next time unless the
   * shopper unticks it.
   */
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: isAuthenticated });
  const [picked, setPicked] = useState<number | "new" | null>(null);
  const [saveForNext, setSaveForNext] = useState(true);
  const addAddress = trpc.customer.addresses.add.useMutation();
  const pickAddress = (address: NonNullable<typeof book.data>[number]) => {
    setPicked(address.id);
    setForm({
      contactName: address.contactName ?? "",
      contactPhone: address.contactPhone ?? "",
      addressLine: address.addressLine ?? "",
      addressNotes: address.addressNotes ?? "",
      pin: address.pin ?? null,
      parts: address.parts ?? {},
    });
    if (address.governorate) setDeliveryZoneId(address.governorate);
    rememberAddress(address.id);
  };
  useEffect(() => {
    if (picked !== null || !book.data) return;
    /* The saved address used last on this device, so the next checkout starts there. */
    const choice = addressToUse(book.data, readLastAddressId());
    if (choice) pickAddress(choice);
    else {
      setPicked("new");
      /* Nothing saved yet: at least the name the account already carries. */
      if (user?.name) setForm(current => (current.contactName ? current : { ...current, contactName: user.name ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.data, picked]);

  /*
   * The first thing in NetLet that creates a real order. It is possible only
   * because cash needs no provider: nothing is authorised or captured, so the
   * order is written `pending_payment` and stays there until a seller records
   * that the driver collected.
   */
  const place = trpc.orders.place.useMutation({
    onSuccess: async reply => {
      toast.success(t("checkout.placed", { reference: reply.reference }));
      /* Saved after the order, never instead of it: a refusal here (an address
         the book's own rules reject) costs the shopper nothing they asked for. */
      if (isAuthenticated && picked === "new" && saveForNext && addressLineOf(form)) {
        try {
          await addAddress.mutateAsync({
            label: zoneLabel ?? t("checkout.savedAddressLabel"),
            contactName: form.contactName.trim() || null,
            contactPhone: form.contactPhone.trim() || null,
            governorate: deliveryZoneId ?? null,
            addressLine: hasParts(form.parts) ? undefined : form.addressLine.trim(),
            addressNotes: form.addressNotes.trim() || null,
            pin: form.pin,
            parts: cleanParts(form.parts),
          });
          void utils.customer.addresses.list.invalidate();
        } catch {
          /* The order stands; the next checkout simply asks again. */
        }
      }
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
  const utils = trpc.useUtils();

  /*
   * Why Place order cannot be pressed yet, first reason first, said under the
   * button. A greyed button with no sentence beside it leaves somebody
   * scrolling a form looking for what it wants; the driver needs a governorate,
   * a street and a number that rings.
   */
  const phoneTyped = form.contactPhone.trim();
  const blocker: MessageKey | null = !isAuthenticated
    ? null /* said by the sign-in offer below the button */
    : settling ? null
    : !items.length ? "checkout.needItems"
    : cart?.cod.available === false ? "checkout.needCod"
    : !deliveryZoneId ? "checkout.needGovernorate"
    : !addressLineOf(form) ? "checkout.needAddress"
    : hasParts(form.parts) && missingParts(form.parts).length ? "address.needsParts"
    : hasParts(form.parts) && partsProblems(form.parts).length ? partsProblems(form.parts)[0]
    : !phoneTyped ? "checkout.needPhone"
    : !normalisePhone(phoneTyped) ? "checkout.badPhone"
    : null;
  const canPlace = Boolean(
    isAuthenticated && !settling && !syncing && !blocker && cart?.id && items.length && cart?.cod.available && addressLineOf(form),
  );

  /*
   * On a phone the summary comes after the whole form, so Place order sat at
   * the foot of a page three screens long. While it is still below, the total
   * and the same button float at the foot of the screen (`PhoneActionBar`),
   * with the first thing missing above them — pressed, it takes the shopper to
   * that field, which is where they would otherwise scroll looking for it.
   */
  const [placeRef, placeBelow] = useBeyondScreen("bottom");
  /* Not while somebody is typing: with the keyboard up, a bar at the foot of
     what is left of the screen sits over the field being filled in. */
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => {
      const field = document.activeElement;
      setTyping(field instanceof HTMLTextAreaElement
        || (field instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(field.type)));
    };
    const settle = () => setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", settle);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", settle);
    };
  }, []);
  const placeNow = () => place.mutate({
    cartId: cart!.id,
    paymentMethod: "cod",
    contactName: form.contactName.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    deliveryZoneId: deliveryZoneId ?? null,
    addressLine: hasParts(form.parts) ? undefined : form.addressLine.trim(),
    addressNotes: form.addressNotes.trim() || null,
    pin: form.pin,
    addressParts: cleanParts(form.parts),
    usePoints,
    voucherCode: applied || undefined,
    affiliateCode: via.data ? affiliateCode : null,
  });
  const blockerField = blocker === "checkout.needGovernorate" ? "checkout-governorate"
    : blocker === "checkout.needAddress" || blocker === "address.needsParts" ? `checkout-address-${missingParts(form.parts)[0] ?? "area"}`
    : blocker === "checkout.needPhone" || blocker === "checkout.badPhone" ? "checkout-phone"
    : null;
  const goToBlocker = () => {
    const field = blockerField ? document.getElementById(blockerField) : null;
    if (!field) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    field.scrollIntoView({ block: "center", behavior: still ? "instant" : "smooth" });
    field.focus({ preventScroll: true });
  };

  /*
   * The loyalty balance, and what it would take off this basket (3.1.15).
   *
   * Asked for only when somebody is signed in, because points belong to an
   * account and the procedure refuses an anonymous caller — a query that is
   * always going to 401 is a request nobody should be making.
   *
   * The figure here is a *display*: the server reads the balance again and
   * caps it again at placement, so a stale page cannot spend what is no longer
   * there. What it must not do is disagree with the button, which is why both
   * use `pointsSpendableOn` over the same total.
   */
  /*
   * A discount code or a gift card, in one field (3.2.3). One field because a
   * shopper holding a code does not necessarily know which kind it is, and
   * asking them to pick the right box before they can use it is a question the
   * shop can answer itself.
   *
   * Applied on a press rather than as they type: a quote per keystroke would
   * be a query per character and a refusal flashing at somebody halfway
   * through typing.
   */
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<string>("");
  const quote = trpc.orders.quoteVoucher.useQuery(
    { cartId: cart?.id ?? "", code: applied },
    /* Not on focus: a code that named nothing counts against the address's
       ceiling on guesses each time it is asked, and switching tabs is not a
       guess. */
    { enabled: Boolean(cart?.id && applied), refetchOnWindowFocus: false },
  );

  const rewards = trpc.rewards.mine.useQuery(undefined, { enabled: isAuthenticated });
  /* The affiliate link this browser came through (3.7), read once, and whose
     it is — said to the shopper before they pay, because paid promotion that
     hides itself is what advertising rules exist to stop. */
  const [affiliateCode] = useState(() => currentAffiliate());
  const via = trpc.affiliates.lookup.useQuery({ code: affiliateCode ?? "" }, { enabled: Boolean(affiliateCode), retry: false });
  const [usePoints, setUsePoints] = useState(false);
  const balance = rewards.data?.balance ?? 0;
  const orderTotal = cart?.total.amount ?? subtotal.amount;
  /* The same `settle` the order writer uses, so the summary and the bill
     cannot disagree about the order things come off in. */
  const voucher = quote.data?.ok ? quote.data : null;
  const discountOff = voucher?.kind === "discount" ? voucher.amount : "0.000";
  const afterDiscount = subtractMoney(orderTotal, discountOff);
  const pointsApplied = usePoints ? pointsSpendableOn(balance, afterDiscount) : 0;
  const pointsOff = spendValue(pointsApplied);
  const giftOff = voucher?.kind === "gift"
    ? giftCardPayment(voucher.remaining, subtractMoney(afterDiscount, pointsOff))
    : "0.000";
  const bill = settle({
    goods: cart?.subtotal.amount ?? subtotal.amount,
    delivery: cart?.delivery.total.amount ?? "0.000",
    discount: discountOff,
    points: pointsOff,
    giftCard: giftOff,
  });
  const payable = bill.payable;

  return (
    <div className="type-body flex min-h-screen flex-col bg-background text-[#0a285a]">
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      <BareHeader note={<><Wallet className="size-4 ink-accent" aria-hidden /> {t("home.payOnDelivery")}</>} />

      <main id="main" tabIndex={-1} className={`container flex-1 outline-none ${PAGE_SPACE}`}>
        <PageHeading title={t("checkout.heading")} note={t("checkout.note")} />

        <div className="grid gap-6 lg:grid-cols-[1.35fr_.8fr]">
          {/* Both columns carry `min-w-0`: a grid item's minimum is its content's,
              and the payment marks below propped the single phone column 55px
              wider than a 320px screen, so checkout scrolled sideways. */}
          <section className="min-w-0 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 shadow-[0_18px_50px_rgba(10,40,90,.05)] sm:p-8">
	            <div className="flex items-center gap-3"><div className="type-label grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">1</div><div><h2 className="type-heading text-base">{t("checkout.deliveryDetails")}</h2><p className="type-body text-[#536b8c]">{t("checkout.deliveryQuestion")}</p></div></div>
	            {/* One tap fills the whole address (3.2.9). */}
	            {isAuthenticated && (book.data?.length ?? 0) > 0 ? (
	              <fieldset className="mt-5">
	                <legend className="type-label text-[#0a285a]">{t("checkout.savedAddresses")}</legend>
	                <div className="mt-2 flex flex-wrap gap-2">
	                  {book.data!.map(address => (
	                    <button
	                      key={address.id}
	                      type="button"
	                      aria-pressed={picked === address.id}
	                      onClick={() => pickAddress(address)}
	                      className={`pressable min-h-11 rounded-full border px-4 py-2 text-[13px] font-bold ${picked === address.id ? "border-[#0a285a] bg-[#0a285a] text-white" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"}`}
	                    >
	                      <bdi>{address.label}</bdi>
	                    </button>
	                  ))}
	                  <button
	                    type="button"
	                    aria-pressed={picked === "new"}
	                    onClick={() => { setPicked("new"); setForm({ contactName: user?.name ?? "", contactPhone: "", addressLine: "", addressNotes: "", pin: null, parts: {} }); }}
	                    className={`pressable min-h-11 rounded-full border px-4 py-2 text-[13px] font-bold ${picked === "new" ? "border-[#0a285a] bg-[#0a285a] text-white" : "border-dashed border-[#b8c9dc] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"}`}
	                  >
	                    {t("checkout.newAddress")}
	                  </button>
	                </div>
	                {typeof picked === "number" ? <p className="type-body mt-2 text-xs text-[#536b8c]">{t("checkout.editForThisOrder")}</p> : null}
	              </fieldset>
	            ) : null}
	            <CheckoutDeliveryZone />
	            <div className="mt-6 grid gap-4 sm:grid-cols-2"><CheckoutField label={t("checkout.fullName")}><input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder={t("checkout.fullNamePlaceholder")} autoComplete="name" enterKeyHint="next" className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.mobile")}><input id="checkout-phone" type="tel" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+965" dir="ltr" inputMode="tel" autoComplete="tel" enterKeyHint="next" className={fieldClass} /></CheckoutField><AddressPartsFields
                parts={form.parts}
                governorate={deliveryZoneId}
                onChange={parts => setForm(f => ({ ...f, parts }))}
                onGovernorate={setDeliveryZoneId}
                fieldClass={fieldClass}
                labelClass="type-label text-[#0a285a]"
                idPrefix="checkout-address"
              />{/* A saved address from before the parts: kept until they are filled in. */}{!hasParts(form.parts) && form.addressLine.trim() ? <p className="text-[12px] leading-5 ink-muted sm:col-span-2">{t("address.legacyLine")} <bdi className="font-semibold text-[#0a285a]">{form.addressLine}</bdi></p> : null}<CheckoutField label={t("checkout.notes")} className="sm:col-span-2"><textarea value={form.addressNotes} onChange={e => setForm(f => ({ ...f, addressNotes: e.target.value }))} placeholder={t("checkout.notesPlaceholder")} className={`${fieldClass} min-h-22 py-3`} /></CheckoutField></div>
	            {/* The pin (3.2.7): optional, and the typed address above is
	                what the order needs. A saved address brings its pin with it. */}
	            <div className="mt-4">
	              <PinPicker value={form.pin} onChange={pin => setForm(f => ({ ...f, pin }))} governorate={deliveryZoneId} />
	            </div>
	            {isAuthenticated && picked === "new" ? (
	              <label className="type-body mt-4 flex items-center gap-2 text-[13px] text-[#0a285a]">
	                <input type="checkbox" checked={saveForNext} onChange={event => setSaveForNext(event.target.checked)} className="size-4 accent-[#0a285a]" />
	                {t("checkout.saveAddress")}
	              </label>
	            ) : null}
            <ItemDestinations />
            <div className="mt-8 border-t border-[#d5dfeb] pt-7"><div className="flex items-center gap-3"><div className="type-label grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">2</div><div><h2 className="type-heading text-base">{t("checkout.paymentMethod")}</h2><p className="type-body text-[#536b8c]">{t("checkout.paymentNote")}</p></div></div>{/* Cash on delivery is the one method NetLet can take today (3.2.2),
                  and it is the only one drawn. The card marks below are what the
                  shop will accept once 3.2.1 lands; they are shown as logos and
                  never as buttons, because a payment button that does nothing is
                  the dead-control rule on the page where it costs most. */}
              <fieldset className="mt-5">
                <legend className="type-label text-[#0a285a]">{t("checkout.payMethod")}</legend>
                {cart?.cod.available === false ? (
                  <p className="type-body mt-3 rounded-xl border border-[#f0d3c6] bg-[#fdf3ee] p-3 text-[13px] leading-6 text-[#8c2f22]">
                    {cart.cod.because.kind === "seller"
                      ? t("checkout.codUnavailableSeller", { name: cart.cod.because.vendorName })
                      : t("checkout.codUnavailableCeiling", { name: cart.cod.because.vendorName, amount: money({ amount: cart.cod.because.ceiling, currencyCode: "KWD" }) })}
                  </p>
                ) : (
                  <label className="tint-on-hover mt-3 flex items-start gap-3 rounded-xl border border-[#0a285a]/20 bg-[#f3f2ed] p-4">
                    <input type="radio" name="pay" checked readOnly className="mt-0.5 size-4" />
                    <span>
                      <span className="type-heading block text-sm">{t("checkout.payCod")}</span>
                      <span className="type-body block text-[13px] leading-5 text-[#536b8c]">{t("checkout.payCodNote")}</span>
                    </span>
                  </label>
                )}
              </fieldset>
              </div>
          </section>

          <aside className="h-fit min-w-0 rounded-[1.5rem] border border-[#d5dfeb] bg-[#0a285a] p-5 text-white shadow-[0_18px_50px_rgba(10,40,90,.13)] sm:p-6"><h2 className="text-xl font-extrabold">{t("checkout.orderSummary")}</h2><div className="mt-6 space-y-4 border-y border-[#49658d] py-5" aria-busy={settling || syncing}>{settling ? (
                /* The bag is still being read. Saying "add products" here told
                   somebody who had just pressed Buy now that their cart was
                   empty, for the second it took to load. */
                [0, 1].map(index => (
                  <div key={index} className="flex gap-3" aria-hidden>
                    <div className="size-14 shrink-0 animate-pulse rounded-xl bg-white/15" />
                    <div className="flex-1 space-y-2 pt-1"><div className="h-3.5 w-3/4 animate-pulse rounded bg-white/15" /><div className="h-3 w-1/3 animate-pulse rounded bg-white/10" /></div>
                    <div className="h-3.5 w-16 animate-pulse rounded bg-white/15" />
                  </div>
                ))
              ) : items.length ? items.map((item) => <div key={item.lineId} className="flex gap-3"><div className="size-14 shrink-0 overflow-hidden rounded-xl bg-white/10"><Thumb src={item.image?.url} alt={item.image?.altText ?? lineTitle(item, isArabic)} className="size-full object-cover" icon={<ShoppingBag className="size-5" />} /></div><div className="min-w-0 flex-1"><p dir="auto" className="type-product">{lineTitle(item, isArabic)}</p><p className="type-label mt-1 text-[#b9cce5]">{t("cart.quantityShort", { count: item.quantity })}</p></div><p className="type-price">{money(item.lineTotal)}</p></div>) : <div className="flex items-center gap-3 rounded-xl bg-white/8 p-3"><div className="grid size-10 place-items-center rounded-full bg-white/10"><ShoppingBag className="size-4" /></div><p className="type-body text-[#d9e7f7]">{t("checkout.summaryEmpty")}</p></div>}</div><div className="type-body space-y-3 pt-5"><div className="flex justify-between text-[#d9e7f7]"><span>{t("cart.subtotal")}</span><span>{settling ? <span className="inline-block h-3.5 w-20 animate-pulse rounded bg-white/15 align-middle" aria-hidden /> : money(subtotal)}</span></div>{/* Delivery is a real figure now (3.2.4), per seller, so the summary
                    stops saying "calculated later" about something already known. */}{(cart?.delivery.perVendor ?? []).filter(row => !row.free).map(row => (<div key={`${row.vendorId ?? row.vendorName}|${row.destinationLabel ?? ""}`} className="flex justify-between text-[12px] text-[#b9cce5]"><span dir="auto">{row.destinationLabel ? t("address.deliveryTo", { name: storeName(row, isArabic), label: row.destinationLabel }) : t("cart.deliveryFrom", { name: storeName(row, isArabic) })}</span><span>{money(row.fee)}</span></div>))}<div className="flex justify-between text-[#d9e7f7]"><span>{t("footer.delivery")}</span><span>{settling ? <span className="inline-block h-3.5 w-16 animate-pulse rounded bg-white/15 align-middle" aria-hidden /> : cart ? money(cart.delivery.total) : t("checkout.calculatedLater")}</span></div>{/* A member's free delivery (4.1), said with what it saved. */}{cart?.delivery.memberWaived ? <p className="text-[12px] font-bold text-[#d9e7f7]">{t("membership.deliveryWaived", { amount: money(cart.delivery.memberWaived) })}</p> : null}{/* Points are offered where the money is, not in a panel of their own:
                    the question "do I spend them" is one somebody asks while
                    reading the total, and nowhere else. The control is absent
                    rather than disabled for a balance of nothing — a checkbox
                    that can only be ticked to no effect is the dead control
                    rule again. */}{balance > 0 ? (<label className="tint-on-hover flex cursor-pointer items-start gap-3 rounded-xl bg-white/10 p-3"><input type="checkbox" checked={usePoints} onChange={event => setUsePoints(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#ffcc64]" /><span className="type-label text-[#d9e7f7]">{t("checkout.usePoints", { points: pointsSpendableOn(balance, orderTotal), value: money({ amount: spendValue(pointsSpendableOn(balance, orderTotal)), currencyCode: "KWD" }) })}</span></label>) : null}{/* One field for a discount code or a gift card. The refusal names the
                    one fixable thing rather than shrugging, which is what makes
                    somebody type it four more times. */}<div className="rounded-xl bg-white/10 p-3"><label className="type-label block text-[#d9e7f7]" htmlFor="voucher-code">{t("checkout.voucherLabel")}</label><div className="mt-2 flex gap-2"><input id="voucher-code" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" value={codeInput} onChange={event => setCodeInput(event.target.value)} placeholder={t("checkout.voucherPlaceholder")} className="type-body h-10 min-w-0 flex-1 rounded-xl border border-[#49658d] bg-white/10 px-3 text-[13px] text-white outline-none placeholder:text-[#b9cce5] focus:border-[#ffcc64]" /><button type="button" onClick={() => setApplied(codeInput.trim())} disabled={!codeInput.trim() || quote.isFetching} className="glass type-control pressable shrink-0 rounded-xl px-4 disabled:opacity-60">{t("checkout.voucherApply")}</button></div>{applied && quote.data && !quote.data.ok ? (<p className="type-label mt-2 text-[#ffcc64]">{t(quote.data.reason)}</p>) : applied && quote.error ? (<p className="type-label mt-2 text-[#ffcc64]">{tError(quote.error.message)}</p>) : null}</div>{voucher?.kind === "discount" && Number(discountOff) > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.discountRow")}</span><span>−{money({ amount: discountOff, currencyCode: "KWD" })}</span></div>) : null}{pointsApplied > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.pointsRow")}</span><span>−{money({ amount: pointsOff, currencyCode: "KWD" })}</span></div>) : null}{voucher?.kind === "gift" && Number(giftOff) > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.giftCardRow")}</span><span>−{money({ amount: giftOff, currencyCode: "KWD" })}</span></div>) : null}<div className="type-price-lg flex justify-between border-t border-[#49658d] pt-4"><span>{t("cart.total")}</span><span className={`transition-opacity ${syncing ? "opacity-50" : ""}`}>{settling ? <span className="inline-block h-5 w-28 animate-pulse rounded bg-white/15 align-middle" aria-hidden /> : money({ amount: payable, currencyCode: "KWD" })}</span></div></div><div className="type-label mt-6 flex items-center gap-2 rounded-xl bg-white/10 p-3 text-[#d9e7f7]"><Truck className="size-4 shrink-0 text-[#ffcc64]" />{t("checkout.parcelsNote")}</div>{/* Navy rather than the brand orange: white on #f2683a is 3.08:1 and
                this label is small, which is the rule the dialogs already
                follow. */}
            {via.data ? <p className="type-label mt-4 text-[#d9e7f7]">{t("affiliate.viaDisclosure", { name: via.data.displayName })}</p> : null}
            <button
              ref={placeRef}
              onClick={placeNow}
              disabled={!canPlace || place.isPending}
              aria-describedby={blocker ? "place-blocker" : undefined}
              className="glass-accent mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-[16px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {place.isPending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <PackageCheck className="size-5" aria-hidden />}
              {t(place.isPending ? "checkout.placing" : "checkout.placeOrder")}
              {canPlace && !place.isPending ? <span className="font-semibold">· {money({ amount: payable, currencyCode: "KWD" })}</span> : null}
            </button>
            {blocker ? <p id="place-blocker" className="type-label mt-2.5 flex items-start gap-1.5 text-[#ffcc64]"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t(blocker)}</p> : null}
            {/* Signing in here keeps the basket: the bag filled as a guest is
                the one the account adopts. */}
            {!isAuthenticated && !sessionLoading ? (
              <>
                <p className="type-label mt-3 text-[#d9e7f7]">{t("checkout.signInToOrder")}</p>
                <button type="button" onClick={() => setAuthOpen(true)} className="glass glass-on-dark type-control pressable mt-3 w-full rounded-full px-5 py-3">
                  {t("checkout.signInHere")}
                </button>
              </>
            ) : null}</aside>
        </div>

        <section className="type-label mt-8 grid gap-3 border-t border-[#d5dfeb] pt-6 text-[#536b8c] sm:grid-cols-3"><div className="flex items-center gap-2"><MapPin className="size-4 ink-accent" /> {t("checkout.builtForKuwait")}</div><div className="flex items-center gap-2"><Wallet className="size-4 ink-accent" /> {t("home.payOnDelivery")}</div><div className="flex items-center gap-2"><RotateCcw className="size-4 ink-accent" /> {t("home.returnsWithin", { days: RETURN_WINDOW_DAYS })}</div></section>
      </main>
      {items.length || settling ? (
        <PhoneActionBar shown={placeBelow && !typing} label={t("checkout.placeBar")} overTabBar={false}>
          {blocker ? (
            <button type="button" onClick={goToBlocker} disabled={!blockerField} className="mb-1.5 flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-start text-[13px] font-bold leading-5 ink-accent disabled:cursor-default">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t(blocker)}
            </button>
          ) : null}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 px-1.5 min-[360px]:px-2">
              <p className="text-[12px] font-semibold leading-4 ink-muted">{t("cart.total")}</p>
              <p className={`truncate text-[16px] font-extrabold leading-6 text-[#0a285a] transition-opacity ${syncing ? "opacity-50" : ""}`}>{settling ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-[#e7edf5] align-middle" aria-hidden /> : money({ amount: payable, currencyCode: "KWD" })}</p>
            </div>
            {!isAuthenticated && !sessionLoading ? (
              <button type="button" onClick={() => setAuthOpen(true)} className="glass glass-navy flex h-11 shrink-0 items-center justify-center rounded-xl px-4 text-[14px] font-bold">
                {t("checkout.signInShort")}
              </button>
            ) : (
              <button type="button" onClick={placeNow} disabled={!canPlace || place.isPending} className="glass-accent flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-55 min-[360px]:px-5">
                {place.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />}
                {t(place.isPending ? "checkout.placing" : "checkout.placeOrder")}
              </button>
            )}
          </div>
        </PhoneActionBar>
      ) : null}
    </div>
  );
}
