/**
 * NetLet native checkout mockup: Kuwait-focused delivery UI with visual-only
 * KNET, Visa, Mastercard, and Google Pay presentation. No payment is processed.
 */
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/product/Thumb";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useCustomer } from "@/contexts/CustomerContext";
import { KUWAIT_PAYMENT_METHODS } from "@/lib/checkoutMock";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { kuwaitDeliveryZones } from "@shared/customer";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { useAuth } from "@/hooks/useAuth";
import { pointsSpendableOn, spendValue } from "@shared/commerce/referral";
import { giftCardPayment, settle } from "@shared/commerce/vouchers";
import { subtractMoney } from "@shared/money";
import { trpc } from "@/lib/trpc";
import { ItemDestinations } from "@/components/cart/ItemDestinations";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Check, LoaderCircle, LockKeyhole, MapPin, PackageCheck, ShoppingBag, Truck } from "lucide-react";

const fieldClass = "type-body mt-2 h-11 w-full rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-3 outline-none transition-shadow focus:shadow-[0_0_0_4px_rgba(20,52,203,.10)]";

/**
 * A payment brand drawn rather than imaged.
 *
 * `role="img"` because each is a picture made of spans: without a role,
 * `aria-label` on a span is ignored, which left these announced as nothing at
 * all. The label says "mockup only" on purpose — nothing is charged here, and
 * a screen reader should not be the last to know.
 */
function PaymentMark({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation();
  const described = t("checkout.paymentIcon", { label });
  if (id === "mastercard") return <span role="img" aria-label={described} className="relative inline-flex h-7 w-11 items-center justify-center"><span className="absolute start-1 size-6 rounded-full bg-[#ed1b2f]" /><span className="absolute end-1 size-6 rounded-full bg-[#f79e1b] mix-blend-multiply" /></span>;
  if (id === "google-pay") return <span role="img" aria-label={described} className="text-lg font-bold tracking-[-.09em] text-[#202124]">G<span className="ms-0.5 font-medium tracking-[-.04em]">Pay</span></span>;
  return <span role="img" aria-label={described} className={id === "visa" ? "text-lg font-black italic tracking-[-.08em] text-[#1434cb]" : "rounded-md bg-[#0a285a] px-2 py-1 text-sm font-black tracking-[-.06em] text-white"}>{label}</span>;
}

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
  return <div className="mt-5 rounded-2xl border border-[#d5dfeb] bg-[#f3f2ed] p-4"><div className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 shrink-0 ink-accent" /><div className="min-w-0 flex-1"><label className="block"><span className="type-label text-[#0a285a]">{t("checkout.governorateLabel")}</span><select value={deliveryZoneId ?? ""} onChange={event => setDeliveryZoneId(event.target.value)} className={`${fieldClass} mt-2`}><option value="" disabled>{t("delivery.selectGovernorate")}</option>{kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zoneName(zone)}</option>)}</select></label><p className="type-body mt-3 text-xs leading-5 text-[#536b8c]">{deliveryZone ? t("delivery.savedForDevice", { name: zoneName(deliveryZone) }) : t("delivery.chooseForDevice")} {t("delivery.awaitingSetup")}</p></div></div></div>;
}


export default function Checkout() {
  usePageMeta(privatePageMeta("Checkout"));
  const { cart } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? { amount: "0", currencyCode: "KWD" };
  const { isAuthenticated } = useAuth();
  const { deliveryZoneId } = useCustomer();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ contactName: "", contactPhone: "", addressLine: "", addressNotes: "" });

  /*
   * The first thing in NetLet that creates a real order. It is possible only
   * because cash needs no provider: nothing is authorised or captured, so the
   * order is written `pending_payment` and stays there until a seller records
   * that the driver collected.
   */
  const place = trpc.orders.place.useMutation({
    onSuccess: reply => {
      toast.success(t("checkout.placed", { reference: reply.reference }));
      /* The basket has become the order, so the drawer's copy of it is stale. */
      void utils.commerce.cart.get.invalidate();
      navigate("/account");
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("checkout.placeFailed")),
  });
  const utils = trpc.useUtils();

  const canPlace = Boolean(
    isAuthenticated && cart?.id && items.length && cart?.cod.available && form.addressLine.trim(),
  );

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
    { enabled: Boolean(cart?.id && applied) },
  );

  const rewards = trpc.rewards.mine.useQuery(undefined, { enabled: isAuthenticated });
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
    <main className="type-body min-h-screen bg-background text-[#0a285a]">
      <header className="border-b border-[#d5dfeb] bg-background/95"><div className="container flex h-[76px] items-center justify-between"><a href={appPath("/")} aria-label={t("checkout.return")}><img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-10 w-auto max-w-[126px] object-contain" /></a><div className="type-label hidden items-center gap-2 text-[#536b8c] sm:flex"><LockKeyhole className="size-4 ink-accent" /> {t("checkout.mockBadge")}</div><a href={appPath("/")} className="glass type-control pressable flex items-center gap-1.5 rounded-full px-4 py-2.5"><ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t("header.continueShopping")}</a></div></header>

      <div className="container py-8 sm:py-12"><div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="type-label tracking-[.16em] text-[#a44a2b] uppercase">{t("checkout.eyebrow")}</p><h1 className="type-display mt-2 text-4xl sm:text-5xl">{t("checkout.title")}</h1><p className="type-body mt-3 max-w-xl text-[#536b8c]">{t("checkout.note")}</p></div><div className="type-label inline-flex w-fit items-center gap-2 rounded-full bg-[#fff0ab] px-3 py-2 tracking-[.08em] text-[#0a285a] uppercase"><PackageCheck className="size-3.5" /> {t("checkout.mockOnly")}</div></div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_.8fr]">
          <section className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 shadow-[0_18px_50px_rgba(10,40,90,.05)] sm:p-8">
	            <div className="flex items-center gap-3"><div className="type-label grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">1</div><div><h2 className="type-heading text-base">{t("checkout.deliveryDetails")}</h2><p className="type-body text-[#536b8c]">{t("checkout.deliveryQuestion")}</p></div></div>
	            <CheckoutDeliveryZone />
	            <div className="mt-6 grid gap-4 sm:grid-cols-2"><CheckoutField label={t("checkout.fullName")}><input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder={t("checkout.fullNamePlaceholder")} className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.mobile")}><input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+965" dir="ltr" inputMode="tel" className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.address")} className="sm:col-span-2"><input value={form.addressLine} onChange={e => setForm(f => ({ ...f, addressLine: e.target.value }))} placeholder={t("checkout.addressPlaceholder")} className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.notes")} className="sm:col-span-2"><textarea value={form.addressNotes} onChange={e => setForm(f => ({ ...f, addressNotes: e.target.value }))} placeholder={t("checkout.notesPlaceholder")} className={`${fieldClass} min-h-22 py-3`} /></CheckoutField></div>
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
                  <label className="mt-3 flex items-start gap-3 rounded-xl border border-[#0a285a]/20 bg-[#f3f2ed] p-4">
                    <input type="radio" name="pay" checked readOnly className="mt-0.5 size-4" />
                    <span>
                      <span className="type-heading block text-sm">{t("checkout.payCod")}</span>
                      <span className="type-body block text-[13px] leading-5 text-[#536b8c]">{t("checkout.payCodNote")}</span>
                    </span>
                  </label>
                )}
              </fieldset>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{KUWAIT_PAYMENT_METHODS.map((method) => <div key={method.id} className="flex min-h-16 items-center justify-center rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-3"><PaymentMark id={method.id} label={method.label} /></div>)}</div><p className="type-label mt-3 text-[#536b8c]">{t("checkout.otherMethodsSoon")}</p></div>
          </section>

          <aside className="h-fit rounded-[1.5rem] border border-[#d5dfeb] bg-[#0a285a] p-5 text-white shadow-[0_18px_50px_rgba(10,40,90,.13)] sm:p-6"><p className="type-label tracking-[.16em] text-[#ffcc64] uppercase">{t("checkout.orderSummary")}</p><h2 className="type-display mt-2 text-3xl">{t("checkout.summaryTitle")}</h2><div className="mt-6 space-y-4 border-y border-[#49658d] py-5">{items.length ? items.map((item) => <div key={item.lineId} className="flex gap-3"><div className="size-14 shrink-0 overflow-hidden rounded-xl bg-white/10"><Thumb src={item.image?.url} alt={item.image?.altText ?? item.productTitle} className="size-full object-cover" icon={<ShoppingBag className="size-5" />} /></div><div className="min-w-0 flex-1"><p className="type-product">{item.productTitle}</p><p className="type-label mt-1 text-[#b9cce5]">{t("cart.quantityShort", { count: item.quantity })}</p></div><p className="type-price">{money(item.lineTotal)}</p></div>) : <div className="flex items-center gap-3 rounded-xl bg-white/8 p-3"><div className="grid size-10 place-items-center rounded-full bg-white/10"><ShoppingBag className="size-4" /></div><p className="type-body text-[#d9e7f7]">{t("checkout.summaryEmpty")}</p></div>}</div><div className="type-body space-y-3 pt-5"><div className="flex justify-between text-[#d9e7f7]"><span>{t("cart.subtotal")}</span><span>{money(subtotal)}</span></div>{/* Delivery is a real figure now (3.2.4), per seller, so the summary
                    stops saying "calculated later" about something already known. */}{(cart?.delivery.perVendor ?? []).filter(row => !row.free).map(row => (<div key={`${row.vendorId ?? row.vendorName}|${row.destinationLabel ?? ""}`} className="flex justify-between text-[11px] text-[#b9cce5]"><span dir="auto">{row.destinationLabel ? t("address.deliveryTo", { name: row.vendorName, label: row.destinationLabel }) : t("cart.deliveryFrom", { name: row.vendorName })}</span><span>{money(row.fee)}</span></div>))}<div className="flex justify-between text-[#d9e7f7]"><span>{t("footer.delivery")}</span><span>{cart ? money(cart.delivery.total) : t("checkout.calculatedLater")}</span></div>{/* Points are offered where the money is, not in a panel of their own:
                    the question "do I spend them" is one somebody asks while
                    reading the total, and nowhere else. The control is absent
                    rather than disabled for a balance of nothing — a checkbox
                    that can only be ticked to no effect is the dead control
                    rule again. */}{balance > 0 ? (<label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/10 p-3"><input type="checkbox" checked={usePoints} onChange={event => setUsePoints(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#ffcc64]" /><span className="type-label text-[#d9e7f7]">{t("checkout.usePoints", { points: pointsSpendableOn(balance, orderTotal), value: money({ amount: spendValue(pointsSpendableOn(balance, orderTotal)), currencyCode: "KWD" }) })}</span></label>) : null}{/* One field for a discount code or a gift card. The refusal names the
                    one fixable thing rather than shrugging, which is what makes
                    somebody type it four more times. */}<div className="rounded-xl bg-white/10 p-3"><label className="type-label block text-[#d9e7f7]" htmlFor="voucher-code">{t("checkout.voucherLabel")}</label><div className="mt-2 flex gap-2"><input id="voucher-code" dir="ltr" value={codeInput} onChange={event => setCodeInput(event.target.value)} placeholder={t("checkout.voucherPlaceholder")} className="type-body h-10 min-w-0 flex-1 rounded-xl border border-[#49658d] bg-white/10 px-3 text-[13px] text-white outline-none placeholder:text-[#b9cce5] focus:border-[#ffcc64]" /><button type="button" onClick={() => setApplied(codeInput.trim())} disabled={!codeInput.trim() || quote.isFetching} className="glass type-control pressable shrink-0 rounded-xl px-4 disabled:opacity-60">{t("checkout.voucherApply")}</button></div>{applied && quote.data && !quote.data.ok ? (<p className="type-label mt-2 text-[#ffcc64]">{t(quote.data.reason)}</p>) : null}</div>{voucher?.kind === "discount" && Number(discountOff) > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.discountRow")}</span><span>−{money({ amount: discountOff, currencyCode: "KWD" })}</span></div>) : null}{pointsApplied > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.pointsRow")}</span><span>−{money({ amount: pointsOff, currencyCode: "KWD" })}</span></div>) : null}{voucher?.kind === "gift" && Number(giftOff) > 0 ? (<div className="flex justify-between text-[#d9e7f7]"><span>{t("checkout.giftCardRow")}</span><span>−{money({ amount: giftOff, currencyCode: "KWD" })}</span></div>) : null}<div className="type-price-lg flex justify-between border-t border-[#49658d] pt-4"><span>{t("cart.total")}</span><span>{money({ amount: payable, currencyCode: "KWD" })}</span></div></div><div className="type-label mt-6 flex items-center gap-2 rounded-xl bg-white/10 p-3 text-[#d9e7f7]"><Truck className="size-4 shrink-0 text-[#ffcc64]" />{t("checkout.deliveryLater")}</div>{/* Navy rather than the brand orange: white on #f2683a is 3.08:1 and
                this label is small, which is the rule the dialogs already
                follow. */}
            <button
              onClick={() => place.mutate({
                cartId: cart!.id,
                paymentMethod: "cod",
                contactName: form.contactName.trim() || null,
                contactPhone: form.contactPhone.trim() || null,
                deliveryZoneId: deliveryZoneId ?? null,
                addressLine: form.addressLine.trim(),
                addressNotes: form.addressNotes.trim() || null,
                usePoints,
                voucherCode: applied || undefined,
              })}
              disabled={!canPlace || place.isPending}
              className="glass glass-navy type-control pressable mt-5 flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {place.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" aria-hidden />}
              {t(place.isPending ? "checkout.placing" : "checkout.placeOrder")}
            </button>
            {!isAuthenticated ? (
              <p className="type-label mt-3 text-[#d9e7f7]">{t("checkout.signInToOrder")}</p>
            ) : null}</aside>
        </div>

        <section className="type-label mt-8 grid gap-3 border-t border-[#d5dfeb] pt-6 text-[#536b8c] sm:grid-cols-3"><div className="flex items-center gap-2"><MapPin className="size-4 ink-accent" /> {t("checkout.builtForKuwait")}</div><div className="flex items-center gap-2"><Truck className="size-4 ink-accent" /> {t("checkout.clearSetup")}</div><div className="flex items-center gap-2"><Check className="size-4 ink-accent" /> {t("checkout.paymentPlanned")}</div></section>
      </div>
    </main>
  );
}
