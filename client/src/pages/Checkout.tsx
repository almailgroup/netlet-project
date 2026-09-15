/**
 * NetLet native checkout mockup: Kuwait-focused delivery UI with visual-only
 * KNET, Visa, Mastercard, and Google Pay presentation. No payment is processed.
 */
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/Thumb";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { useCustomer } from "@/contexts/CustomerContext";
import { CHECKOUT_IS_MOCK_ONLY, KUWAIT_PAYMENT_METHODS } from "@/lib/checkoutMock";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { kuwaitDeliveryZones } from "@shared/customer";
import { useMoney, useTranslation } from "@/lib/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, Check, ChevronDown, LockKeyhole, MapPin, PackageCheck, ShoppingBag, Truck } from "lucide-react";

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

function CheckoutDeliveryZone() {
  const { deliveryZone, deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  const zoneName = (zone: { label: string; labelAr: string }) => (isArabic ? zone.labelAr : zone.label);
  return <div className="mt-5 rounded-2xl border border-[#d5dfeb] bg-[#f3f2ed] p-4"><div className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 shrink-0 ink-accent" /><div className="min-w-0 flex-1"><label className="block"><span className="type-label text-[#0a285a]">{t("checkout.governorateLabel")}</span><select value={deliveryZoneId ?? ""} onChange={event => setDeliveryZoneId(event.target.value)} className={`${fieldClass} mt-2`}><option value="" disabled>{t("delivery.selectGovernorate")}</option>{kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zoneName(zone)}</option>)}</select></label><p className="type-body mt-3 text-xs leading-5 text-[#536b8c]">{deliveryZone ? t("delivery.savedForDevice", { name: zoneName(deliveryZone) }) : t("delivery.chooseForDevice")} {t("delivery.awaitingSetup")}</p></div></div></div>;
}

const CHECKOUT_AREAS: MessageKey[] = ["checkout.areaSalmiya", "checkout.areaHawally", "checkout.areaKuwaitCity", "checkout.areaSabahAlSalem", "checkout.areaFahaheel"];

export default function Checkout() {
  usePageMeta(privatePageMeta("Checkout"));
  const { cart } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? { amount: "0", currencyCode: "KWD" };

  return (
    <main className="type-body min-h-screen bg-background text-[#0a285a]">
      <header className="border-b border-[#d5dfeb] bg-background/95"><div className="container flex h-[76px] items-center justify-between"><a href={appPath("/")} aria-label={t("checkout.return")}><img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-10 w-auto max-w-[126px] object-contain" /></a><div className="type-label hidden items-center gap-2 text-[#536b8c] sm:flex"><LockKeyhole className="size-4 ink-accent" /> {t("checkout.mockBadge")}</div><a href={appPath("/")} className="glass type-control pressable flex items-center gap-1.5 rounded-full px-4 py-2.5"><ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t("header.continueShopping")}</a></div></header>

      <div className="container py-8 sm:py-12"><div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="type-label tracking-[.16em] text-[#a44a2b] uppercase">{t("checkout.eyebrow")}</p><h1 className="type-display mt-2 text-4xl sm:text-5xl">{t("checkout.title")}</h1><p className="type-body mt-3 max-w-xl text-[#536b8c]">{t("checkout.note")}</p></div><div className="type-label inline-flex w-fit items-center gap-2 rounded-full bg-[#fff0ab] px-3 py-2 tracking-[.08em] text-[#0a285a] uppercase"><PackageCheck className="size-3.5" /> {t("checkout.mockOnly")}</div></div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_.8fr]">
          <section className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 shadow-[0_18px_50px_rgba(10,40,90,.05)] sm:p-8">
	            <div className="flex items-center gap-3"><div className="type-label grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">1</div><div><h2 className="type-heading text-base">{t("checkout.deliveryDetails")}</h2><p className="type-body text-[#536b8c]">{t("checkout.deliveryQuestion")}</p></div></div>
	            <CheckoutDeliveryZone />
	            <div className="mt-6 grid gap-4 sm:grid-cols-2"><CheckoutField label={t("checkout.fullName")}><input placeholder={t("checkout.fullNamePlaceholder")} className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.mobile")}><input placeholder="+965" dir="ltr" inputMode="tel" className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.area")} className="sm:col-span-2"><select defaultValue="" className={fieldClass}><option value="" disabled>{t("checkout.selectArea")}</option>{CHECKOUT_AREAS.map(area => <option key={area}>{t(area)}</option>)}</select></CheckoutField><CheckoutField label={t("checkout.address")} className="sm:col-span-2"><input placeholder={t("checkout.addressPlaceholder")} className={fieldClass} /></CheckoutField><CheckoutField label={t("checkout.notes")} className="sm:col-span-2"><textarea placeholder={t("checkout.notesPlaceholder")} className={`${fieldClass} min-h-22 py-3`} /></CheckoutField></div>
            <div className="mt-8 border-t border-[#d5dfeb] pt-7"><div className="flex items-center gap-3"><div className="type-label grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">2</div><div><h2 className="type-heading text-base">{t("checkout.paymentMethod")}</h2><p className="type-body text-[#536b8c]">{t("checkout.paymentNote")}</p></div></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{KUWAIT_PAYMENT_METHODS.map((method) => <div key={method.id} className="flex min-h-16 items-center justify-center rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-3"><PaymentMark id={method.id} label={method.label} /></div>)}</div><p className="type-label mt-4 flex items-start gap-2 rounded-xl bg-[#fff7e3] p-3 text-[#705523]"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />{CHECKOUT_IS_MOCK_ONLY ? t("checkout.paymentDisclaimer") : ""}</p></div>
          </section>

          <aside className="h-fit rounded-[1.5rem] border border-[#d5dfeb] bg-[#0a285a] p-5 text-white shadow-[0_18px_50px_rgba(10,40,90,.13)] sm:p-6"><p className="type-label tracking-[.16em] text-[#ffcc64] uppercase">{t("checkout.orderSummary")}</p><h2 className="type-display mt-2 text-3xl">{t("checkout.summaryTitle")}</h2><div className="mt-6 space-y-4 border-y border-[#49658d] py-5">{items.length ? items.map((item) => <div key={item.lineId} className="flex gap-3"><div className="size-14 shrink-0 overflow-hidden rounded-xl bg-white/10"><Thumb src={item.image?.url} alt={item.image?.altText ?? item.productTitle} className="size-full object-cover" icon={<ShoppingBag className="size-5" />} /></div><div className="min-w-0 flex-1"><p className="type-product">{item.productTitle}</p><p className="type-label mt-1 text-[#b9cce5]">{t("cart.quantityShort", { count: item.quantity })}</p></div><p className="type-price">{money(item.lineTotal)}</p></div>) : <div className="flex items-center gap-3 rounded-xl bg-white/8 p-3"><div className="grid size-10 place-items-center rounded-full bg-white/10"><ShoppingBag className="size-4" /></div><p className="type-body text-[#d9e7f7]">{t("checkout.summaryEmpty")}</p></div>}</div><div className="type-body space-y-3 pt-5"><div className="flex justify-between text-[#d9e7f7]"><span>{t("cart.items")}</span><span>{money(subtotal)}</span></div><div className="flex justify-between text-[#d9e7f7]"><span>{t("footer.delivery")}</span><span>{t("checkout.calculatedLater")}</span></div><div className="type-price-lg flex justify-between border-t border-[#49658d] pt-4"><span>{t("cart.subtotal")}</span><span>{money(subtotal)}</span></div></div><div className="type-label mt-6 flex items-center gap-2 rounded-xl bg-white/10 p-3 text-[#d9e7f7]"><Truck className="size-4 shrink-0 text-[#ffcc64]" />{t("checkout.deliveryLater")}</div><button disabled className="glass glass-accent type-control mt-5 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full px-5 py-4 opacity-65">{t("checkout.paymentSoon")} <ChevronDown className="size-4" /></button></aside>
        </div>

        <section className="type-label mt-8 grid gap-3 border-t border-[#d5dfeb] pt-6 text-[#536b8c] sm:grid-cols-3"><div className="flex items-center gap-2"><MapPin className="size-4 ink-accent" /> {t("checkout.builtForKuwait")}</div><div className="flex items-center gap-2"><Truck className="size-4 ink-accent" /> {t("checkout.clearSetup")}</div><div className="flex items-center gap-2"><Check className="size-4 ink-accent" /> {t("checkout.paymentPlanned")}</div></section>
      </div>
    </main>
  );
}
