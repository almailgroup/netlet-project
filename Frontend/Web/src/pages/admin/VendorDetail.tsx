/**
 * One store: what it is, how to reach it, what it may sell under, how it
 * delivers and gets paid, what NetLet charges it, and who signs in for it.
 *
 * It was four sections, and the first held twenty-one fields — the name beside
 * the IBAN beside the discount permit beside the cash-on-delivery ceiling — with
 * one Save at the foot. Somebody fixing a phone number scrolled past the payout
 * account to save, and the save wrote every field on the page. It is eight
 * sections now, each one decision with its own Save, and **each Save sends only
 * its own fields**: `storeDetailColumns` writes an absent key as nothing, so a
 * delivery change cannot rewrite the IBAN and the audit row names what changed.
 *
 * The page opens on the store's figures — its shelf, what is waiting for
 * review, who can sign in, what it is charged — with a way to add a product to
 * this store and to see the ones it has, because "which products are this
 * store's" is the question an administrator most often arrives with.
 *
 * Status, auto-publish, commission and badges save as they change: each is one
 * audited act, and a separate Save for a single switch is a press nobody needs.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { StoreAvatar, StoreStatusPill } from "@/components/admin/StoreAvatar";
import { Card, Field, PageHeader, PasswordBox, Stat, Toggle, buttonClass, fieldClass, isolate } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { kuwaitDeliveryZones } from "@shared/customer";
import { DELIVERY_SPEEDS, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { discountAllowed } from "@shared/inventory/discountLicence";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { ibanReadAs, isValidIban, isValidKuwaitPhone, missingStoreDetails } from "@shared/inventory/storeProfile";
import {
  AWARDED_BADGES,
  awardedBadges,
  FAST_SHIPPING_HOURS,
  FAST_SHIPPING_MIN_DELIVERIES,
  FAST_SHIPPING_SHARE,
  FAST_SHIPPING_WINDOW_DAYS,
  HIGH_RATING_FLOOR,
  HIGH_RATING_MIN_REVIEWS,
} from "@shared/inventory/vendorHealth";
import { privatePageMeta } from "@shared/seo";
import { kuwaitDay } from "@shared/kuwaitDay";
import { ArrowLeft, CircleAlert, KeyRound, LayoutGrid, LoaderCircle, PackagePlus, Save, Trash2, UserMinus, UserPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

export default function AdminVendorDetail() {
  usePageMeta(privatePageMeta("Store"));
  const [, params] = useRoute("/admin/vendors/:id");
  const id = Number(params?.id ?? 0);
  return <AdminShell need={"platform.viewAll"}>{() => <VendorDetail vendorId={id} />}</AdminShell>;
}

const STATUSES = ["pending", "approved", "suspended"] as const;

/* `missingStoreDetails` answers with field names; these are the words for them. */
const FIELD_LABEL: Record<string, MessageKey> = {
  contactEmail: "admin.contactEmail",
  contactPhone: "admin.contactPhone",
  governorate: "admin.governorate",
  addressLine: "admin.addressLine",
  licenceNumber: "admin.licenceNumber",
  payoutIban: "admin.payoutIban",
};

type Draft = {
  name: string; nameAr: string; logoUrl: string; description: string; descriptionAr: string;
  contactEmail: string; contactPhone: string; governorate: string; addressLine: string;
  licenceNumber: string; underPlatformLicence: boolean; discountLicenceNumber: string; discountLicenceExpiresAt: string;
  deliverySpeed: string; deliveryFlat: string; deliveryFreeOver: string; deliveryProvider: string;
  acceptsCod: boolean; codCeiling: string; subscriptionPercent: string; payoutIban: string;
};

const textarea = `${fieldClass} h-auto min-h-24 py-2.5 leading-6`;

function VendorDetail({ vendorId }: { vendorId: number }) {
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const vendor = trpc.inventory.vendors.get.useQuery({ vendorId }, { enabled: vendorId > 0 });

  const refresh = () => {
    void utils.inventory.vendors.get.invalidate({ vendorId });
    void utils.inventory.vendors.list.invalidate();
  };
  const done = () => { refresh(); toast.success(t("admin.saved")); };
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));

  const saveProfile = trpc.inventory.vendors.updateProfile.useMutation({ onSuccess: done, onError: fail });
  const setStatus = trpc.inventory.vendors.setStatus.useMutation({ onSuccess: done, onError: fail });
  const setCommission = trpc.inventory.vendors.setCommission.useMutation({ onSuccess: done, onError: fail });
  const setBadges = trpc.inventory.vendors.setBadges.useMutation({ onSuccess: done, onError: fail });
  const setAutoPublish = trpc.inventory.vendors.setAutoPublish.useMutation({ onSuccess: done, onError: fail });

  /* Which section's Save is in flight, so only that button spins. */
  const [saving, setSaving] = useState<string | null>(null);
  const row = vendor.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [terms, setTerms] = useState({ commissionPercent: "", commissionFixed: "" });

  useEffect(() => {
    if (!row) return;
    setDraft({
      name: row.name, nameAr: row.nameAr ?? "", logoUrl: row.logoUrl ?? "",
      description: row.description ?? "", descriptionAr: row.descriptionAr ?? "",
      contactEmail: row.contactEmail ?? "", contactPhone: row.contactPhone ?? "",
      governorate: row.governorate ?? "", addressLine: row.addressLine ?? "",
      licenceNumber: row.licenceNumber ?? "", underPlatformLicence: row.underPlatformLicence ?? false,
      discountLicenceNumber: row.discountLicenceNumber ?? "",
      // <input type="date"> speaks yyyy-mm-dd and nothing else.
      discountLicenceExpiresAt: row.discountLicenceExpiresAt ? kuwaitDay(new Date(row.discountLicenceExpiresAt)) : "",
      deliverySpeed: row.deliverySpeed ?? "", deliveryFlat: row.deliveryFlat ?? "",
      deliveryFreeOver: row.deliveryFreeOver ?? "", deliveryProvider: row.deliveryProvider ?? "",
      acceptsCod: row.acceptsCod ?? true, codCeiling: row.codCeiling ?? "",
      subscriptionPercent: row.subscriptionPercent ?? "", payoutIban: row.payoutIban ?? "",
    });
    setTerms({ commissionPercent: row.commissionPercent, commissionFixed: row.commissionFixed ?? "" });
  }, [row]);

  if (vendor.isLoading || vendor.isError) return <QueryGate queries={[vendor]}>{() => null}</QueryGate>;
  if (!row || !draft) return <p className="text-sm font-bold">{t("admin.noVendors")}</p>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => (current ? { ...current, [key]: value } : current));
  const blank = (value: string) => (value.trim() === "" ? null : value.trim());

  const phoneProblem = draft.contactPhone.trim() && !isValidKuwaitPhone(draft.contactPhone) ? t("admin.invalidPhone") : undefined;
  const ibanProblem = draft.payoutIban.trim() && !isValidIban(draft.payoutIban) ? t("admin.invalidIban") : undefined;
  const ibanRead = ibanProblem ? null : ibanReadAs(draft.payoutIban);

  /* One section's fields and nothing else: an absent key writes nothing. */
  const save = (section: string, patch: Omit<Parameters<typeof saveProfile.mutate>[0], "vendorId">) => {
    setSaving(section);
    saveProfile.mutate({ vendorId, ...patch }, { onSettled: () => setSaving(null) });
  };
  const saveButton = (section: string, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled || saving !== null} className={buttonClass.primary}>
      {saving === section ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {t(saving === section ? "admin.saving" : "admin.save")}
    </button>
  );

  const missing = missingStoreDetails(row);
  const held = awardedBadges(row.badges);
  const permit = discountAllowed({ number: row.discountLicenceNumber, expiresAt: row.discountLicenceExpiresAt });
  const permitLine = !permit.allowed
    ? permit.reason === "expired" && row.discountLicenceExpiresAt
      ? { text: t("admin.permitExpired", { date: formatDate(row.discountLicenceExpiresAt) }), tone: "bg-[#fdeceb] text-[#8c2f22]" }
      : { text: t("admin.permitMissing"), tone: "bg-[#eef1f5] text-[#536b8c]" }
    : row.discountLicenceExpiresAt
      ? { text: t("admin.permitValid", { date: formatDate(row.discountLicenceExpiresAt) }), tone: "bg-[#d4edda] text-[#155724]" }
      : { text: t("admin.permitNoExpiry"), tone: "bg-[#d4edda] text-[#155724]" };

  const sections: { id: string; label: MessageKey }[] = [
    { id: "profile", label: "admin.sectionProfile" },
    { id: "contact", label: "admin.sectionContact" },
    { id: "licences", label: "admin.sectionLicences" },
    { id: "delivery", label: "admin.sectionDelivery" },
    { id: "payments", label: "admin.sectionPayments" },
    { id: "terms", label: "admin.commercialTerms" },
    { id: "badges", label: "admin.badges" },
    { id: "team", label: "admin.storeTeam" },
  ];

  return (
    <>
      <PageHeader
        title={row.name}
        leading={<StoreAvatar name={row.name} logoUrl={row.logoUrl} size="lg" />}
        meta={
          <>
            <StoreStatusPill status={row.status} />
            {row.autoPublish ? (
              <span className="rounded-full bg-[#e7edf5] px-2.5 py-1 text-[12px] leading-none font-semibold text-[#0a285a]">{t("admin.autoPublish")}</span>
            ) : null}
            <span className="ink-muted"><bdi dir="ltr">/{row.slug}</bdi></span>
          </>
        }
        actions={
          <>
            <Link href={`/admin/products?vendor=${vendorId}`} className={buttonClass.secondary}>
              <LayoutGrid className="size-4" aria-hidden />{t("admin.viewStoreProducts")}
            </Link>
            <Link href={`/admin/products/new?vendor=${vendorId}`} className={buttonClass.primary}>
              <PackagePlus className="size-4" aria-hidden />{t("admin.addProductToStore")}
            </Link>
          </>
        }
      >
        <Link href="/admin/vendors" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.backToVendors")}
        </Link>
      </PageHeader>

      {/* The figures the page opens on. Each one is what somebody would
          otherwise have to count by opening another page. */}
      <ul className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("admin.statProducts")} value={row.stats.products} note={t("admin.statLive", { count: row.stats.live })} href={`/admin/products?vendor=${vendorId}`} />
        <Stat label={t("admin.statInReview")} value={row.stats.inReview} note={t("admin.statDrafts", { count: row.stats.drafts })} href={row.stats.inReview > 0 ? "/admin/review" : undefined} />
        <Stat label={t("admin.statTeam")} value={row.stats.members} href="#team" />
        <Stat
          label={t("admin.statCommission")}
          value={<bdi dir="ltr">{`${Number(row.commissionPercent)}%`}</bdi>}
          note={row.commissionFixed && Number(row.commissionFixed) > 0 ? t("admin.statCommissionFixed", { amount: money({ amount: row.commissionFixed, currencyCode: "KWD" }) }) : undefined}
          href="#terms"
        />
      </ul>

      {missing.length ? (
        <p role="note" className="mb-5 flex items-start gap-2.5 rounded-xl border border-[#ecd49a] bg-[#fff8e6] px-4 py-3 text-[14px] leading-6 text-[#5c3f0c]">
          <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden />
          {t("admin.missingList", { fields: missing.map(field => t(FIELD_LABEL[field])).join(isArabic ? "، " : ", ") })}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[200px_minmax(0,1fr)] xl:items-start">
        <nav aria-label={t("admin.onThisPage")} className="min-w-0 xl:sticky xl:top-24">
          <p className="hidden text-[12px] font-semibold ink-muted xl:block">{t("admin.onThisPage")}</p>
          <ul className="hide-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 xl:mx-0 xl:mt-2 xl:flex-col xl:overflow-visible xl:px-0">
            {sections.map(section => (
              <li key={section.id} className="shrink-0">
                <a href={`#${section.id}`} className="block rounded-lg px-3 py-2 text-[13px] font-semibold whitespace-nowrap text-[#536b8c] transition hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]">
                  {t(section.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          <Card
            id="profile"
            title={t("admin.sectionProfile")}
            description={t("admin.sectionProfileNote")}
            footer={saveButton("profile", () => save("profile", {
              name: draft.name.trim(),
              nameAr: blank(draft.nameAr),
              logoUrl: blank(draft.logoUrl),
              description: blank(draft.description),
              descriptionAr: blank(draft.descriptionAr),
            }), draft.name.trim() === "")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.storeName")}>
                <input dir="auto" value={draft.name} onChange={e => set("name", e.target.value)} aria-invalid={draft.name.trim() === ""} className={fieldClass} />
              </Field>
              <Field label={t("admin.storeNameAr")} optional>
                <input dir="rtl" lang="ar" value={draft.nameAr} onChange={e => set("nameAr", e.target.value)} className={fieldClass} />
              </Field>
              <div className="flex items-end gap-3 sm:col-span-2">
                <Field label={t("admin.logoUrl")} optional className="min-w-0 flex-1">
                  <input dir="ltr" type="url" inputMode="url" placeholder="https://" value={draft.logoUrl} onChange={e => set("logoUrl", e.target.value)} className={fieldClass} />
                </Field>
                <div aria-label={t("admin.logoPreview")} role="img">
                  <StoreAvatar name={draft.name || row.name} logoUrl={blank(draft.logoUrl)} />
                </div>
              </div>
              <Field label={t("admin.storeDescription")} optional className="sm:col-span-2">
                <textarea dir="auto" value={draft.description} onChange={e => set("description", e.target.value)} rows={4} className={textarea} />
              </Field>
              <Field label={t("admin.storeDescriptionAr")} optional className="sm:col-span-2">
                <textarea dir="rtl" lang="ar" value={draft.descriptionAr} onChange={e => set("descriptionAr", e.target.value)} rows={4} className={textarea} />
              </Field>
            </div>
          </Card>

          <Card
            id="contact"
            title={t("admin.sectionContact")}
            description={t("admin.sectionContactNote")}
            footer={saveButton("contact", () => save("contact", {
              contactEmail: blank(draft.contactEmail),
              contactPhone: blank(draft.contactPhone),
              governorate: blank(draft.governorate),
              addressLine: blank(draft.addressLine),
            }), Boolean(phoneProblem))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.contactEmail")}>
                <input dir="ltr" type="email" value={draft.contactEmail} onChange={e => set("contactEmail", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.contactPhone")} error={phoneProblem}>
                <input dir="ltr" inputMode="tel" value={draft.contactPhone} onChange={e => set("contactPhone", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.governorate")}>
                <Select value={draft.governorate} onChange={e => set("governorate", e.target.value)} className={fieldClass}>
                  <option value="">{t("admin.notSet")}</option>
                  {kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                </Select>
              </Field>
              <Field label={t("admin.addressLine")}>
                <input dir="auto" value={draft.addressLine} onChange={e => set("addressLine", e.target.value)} className={fieldClass} />
              </Field>
            </div>
          </Card>

          {/* The Ministry of Commerce discount permit. Without a valid one the
              storefront stops showing this store's savings — on read, because
              a permit expires with nobody saving anything. Its state is said at
              the top of the card, so nobody works it out from two boxes. */}
          <Card
            id="licences"
            title={t("admin.sectionLicences")}
            description={t("admin.discountLicenceHint")}
            footer={saveButton("licences", () => save("licences", {
              licenceNumber: blank(draft.licenceNumber),
              underPlatformLicence: draft.underPlatformLicence,
              discountLicenceNumber: blank(draft.discountLicenceNumber),
              discountLicenceExpiresAt: draft.discountLicenceExpiresAt ? new Date(draft.discountLicenceExpiresAt) : null,
            }))}
          >
            <p className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold text-[#0a285a]">{t("admin.permitState")}</span>
              <span className={`rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold ${permitLine.tone}`}>{permitLine.text}</span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.licenceNumber")}>
                <input dir="ltr" value={draft.licenceNumber} onChange={e => set("licenceNumber", e.target.value)} className={fieldClass} />
              </Field>
              {/* Recorded rather than inferred from a blank licence number
                  (3.3.16): a seller who has not handed their paperwork in is not
                  the same as one trading under ours. */}
              <Toggle
                checked={draft.underPlatformLicence}
                onChange={value => set("underPlatformLicence", value)}
                label={t("admin.underPlatformLicence")}
                hint={t("admin.underPlatformLicenceHint")}
              />
              <Field label={t("admin.discountLicence")}>
                <input dir="ltr" value={draft.discountLicenceNumber} onChange={e => set("discountLicenceNumber", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.discountLicenceExpires")}>
                <input type="date" value={draft.discountLicenceExpiresAt} onChange={e => set("discountLicenceExpiresAt", e.target.value)} className={fieldClass} />
              </Field>
            </div>
          </Card>

          {/* What this store charges to deliver (3.2.4), how fast (3.2.5), and
              who carries it (3.4.13). Blank is free and blank says nothing —
              a default would be NetLet promising or charging for a seller. */}
          <Card
            id="delivery"
            title={t("admin.sectionDelivery")}
            description={t("admin.sectionDeliveryNote")}
            footer={saveButton("delivery", () => save("delivery", {
              /* The select only offers the listed bands, and the server checks
                 the same list — this cast narrows a plain string to it. */
              deliverySpeed: blank(draft.deliverySpeed) as DeliverySpeed | null,
              deliveryFlat: blank(draft.deliveryFlat),
              deliveryFreeOver: blank(draft.deliveryFreeOver),
              deliveryProvider: blank(draft.deliveryProvider),
            }))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.fieldDeliverySpeed")} className="sm:col-span-2">
                <Select value={draft.deliverySpeed} onChange={e => set("deliverySpeed", e.target.value)} className={fieldClass}>
                  <option value="">{t("admin.speedUnset")}</option>
                  {DELIVERY_SPEEDS.map(speed => <option key={speed} value={speed}>{t(`speed.${speed}` as MessageKey)}</option>)}
                </Select>
              </Field>
              <Field label={t("admin.fieldDeliveryFlat")} hint={t("admin.fieldDeliveryFlatHint")}>
                <input dir="ltr" inputMode="decimal" placeholder="0.000" value={draft.deliveryFlat} onChange={e => set("deliveryFlat", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.fieldDeliveryFreeOver")} hint={t("admin.fieldDeliveryFreeOverHint")}>
                <input dir="ltr" inputMode="decimal" placeholder="0.000" value={draft.deliveryFreeOver} onChange={e => set("deliveryFreeOver", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.fieldDeliveryProvider")} hint={t("admin.fieldDeliveryProviderHint")} className="sm:col-span-2">
                <input dir="auto" value={draft.deliveryProvider} onChange={e => set("deliveryProvider", e.target.value)} className={fieldClass} />
              </Field>
            </div>
          </Card>

          {/* Cash on delivery (3.2.2) is on by default — a seller opts out — and
              the ceiling is their own risk appetite. The IBAN is checked by the
              mod-97 rule the server applies, so a transposed pair is caught here. */}
          <Card
            id="payments"
            title={t("admin.sectionPayments")}
            description={t("admin.sectionPaymentsNote")}
            footer={saveButton("payments", () => save("payments", {
              acceptsCod: draft.acceptsCod,
              codCeiling: blank(draft.codCeiling),
              subscriptionPercent: blank(draft.subscriptionPercent),
              payoutIban: blank(draft.payoutIban),
            }), Boolean(ibanProblem))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle
                checked={draft.acceptsCod}
                onChange={value => set("acceptsCod", value)}
                label={t("admin.acceptsCod")}
                hint={t("admin.acceptsCodHint")}
                className="sm:col-span-2"
              />
              <Field label={t("admin.codCeiling")} optional>
                <input dir="ltr" inputMode="decimal" placeholder="0.000" value={draft.codCeiling} disabled={!draft.acceptsCod} onChange={e => set("codCeiling", e.target.value)} className={fieldClass} />
              </Field>
              <Field label={t("admin.subscriptionPercent")} hint={t("admin.subscriptionPercentHint")}>
                <input dir="ltr" inputMode="decimal" value={draft.subscriptionPercent} onChange={e => set("subscriptionPercent", e.target.value)} className={fieldClass} />
              </Field>
              <Field
                label={t("admin.payoutIban")}
                error={ibanProblem}
                hint={ibanRead ? t("admin.ibanReadAs", { iban: ibanRead }) : undefined}
                className="sm:col-span-2"
              >
                <input dir="ltr" autoComplete="off" spellCheck={false} value={draft.payoutIban} onChange={e => set("payoutIban", e.target.value)} className={fieldClass} />
              </Field>
            </div>
          </Card>

          <Card
            id="terms"
            title={t("admin.commercialTerms")}
            description={t("admin.sectionTermsNote")}
            footer={
              <button
                type="button"
                onClick={() => setCommission.mutate({ vendorId, percent: terms.commissionPercent, fixed: terms.commissionFixed.trim() || null })}
                disabled={setCommission.isPending}
                className={buttonClass.primary}
              >
                {setCommission.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {t("admin.save")}
              </button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.vendorStatus")} hint={t("admin.statusHint")}>
                <Select
                  value={row.status}
                  disabled={setStatus.isPending}
                  onChange={e => setStatus.mutate({ vendorId, status: e.target.value as (typeof STATUSES)[number] })}
                  className={fieldClass}
                >
                  {STATUSES.map(status => <option key={status} value={status}>{t(`vendorStatus.${status}` as MessageKey)}</option>)}
                </Select>
              </Field>
              <Toggle
                checked={row.autoPublish}
                disabled={setAutoPublish.isPending}
                onChange={value => setAutoPublish.mutate({ vendorId, autoPublish: value })}
                label={t("admin.autoPublishLabel")}
                hint={t("admin.autoPublishHint")}
              />
              <Field label={t("admin.commissionPercent")} hint={t("admin.commissionPercentHint")}>
                <input dir="ltr" inputMode="decimal" value={terms.commissionPercent} onChange={e => setTerms({ ...terms, commissionPercent: e.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("admin.commissionFixed")} optional>
                <input dir="ltr" inputMode="decimal" placeholder="0.000" value={terms.commissionFixed} onChange={e => setTerms({ ...terms, commissionFixed: e.target.value })} className={fieldClass} />
              </Field>
            </div>
          </Card>

          <Card
            id="badges"
            title={t("admin.badges")}
            /* The other two are measured, never ticked: a "High Rating" typed
               onto a store nobody has reviewed is a claim with nothing behind
               it. Said here with the thresholds, so nobody looks for a switch. */
            description={t("admin.badgesEarned", {
              rating: HIGH_RATING_FLOOR,
              reviews: HIGH_RATING_MIN_REVIEWS,
              share: Math.round(FAST_SHIPPING_SHARE * 100),
              hours: FAST_SHIPPING_HOURS,
              days: FAST_SHIPPING_WINDOW_DAYS,
              deliveries: FAST_SHIPPING_MIN_DELIVERIES,
            })}
          >
            <div className="flex flex-wrap gap-2">
              {AWARDED_BADGES.map(badge => {
                const on = held.includes(badge);
                return (
                  <button
                    key={badge}
                    type="button"
                    aria-pressed={on}
                    disabled={setBadges.isPending}
                    onClick={() => setBadges.mutate({ vendorId, badges: on ? held.filter(one => one !== badge) : [...held, badge] })}
                    className={`inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold transition disabled:opacity-60 ${
                      on ? "bg-[#0a285a] text-white" : "border border-[#cfd9e6] bg-white text-[#536b8c] hover:border-[#0a285a] hover:bg-[#f0f2f5] hover:text-[#0a285a]"
                    }`}
                  >
                    {t(`badge.${badge}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          </Card>

          <VendorTeam vendorId={vendorId} />
        </div>
      </div>
    </>
  );
}

/** One figure the page opens on, linking to where it is acted on. */
const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaff",
  manager: "admin.roleManager",
  owner: "admin.roleOwner",
};

const ROLE_WHAT: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaffWhat",
  manager: "admin.roleManagerWhat",
  owner: "admin.roleOwnerWhat",
};

/**
 * Who can sign in for this store, and the two ways to add one.
 *
 * Both ways exist because both cases are real. "Add someone who already has a
 * NetLet account" is the seller who registered on the storefront and then
 * asked for access. "Create a new login" is the ordinary case an administrator
 * is actually in — onboarding a shop whose staff have never visited the site —
 * and without it a store that already existed could never gain a login at all,
 * since the only other path made the store and its owner together.
 *
 * Each row says what the rank actually permits rather than only naming it: a
 * dropdown reading "Staff / Manager / Owner" asks whoever is choosing to
 * already know the permission model.
 */
function VendorTeam({ vendorId }: { vendorId: number }) {
  const { t, locale } = useTranslation();
  const utils = trpc.useUtils();
  const members = trpc.inventory.vendors.members.useQuery({ vendorId });

  const refresh = () => {
    void utils.inventory.vendors.members.invalidate({ vendorId });
    void utils.inventory.vendors.get.invalidate({ vendorId });
  };
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.forbidden"));

  const addExisting = trpc.inventory.people.addToVendor.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.memberAdded")); setExisting({ email: "", role: "manager" }); },
    onError: fail,
  });
  const addNew = trpc.inventory.vendors.addNewMember.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.loginCreated")); setFresh({ name: "", email: "", password: "", role: "manager" }); },
    onError: fail,
  });
  const setRole = trpc.inventory.vendors.setMemberRole.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const [removing, setRemoving] = useState<{ userId: number; email: string } | null>(null);
  const remove = trpc.inventory.vendors.removeMember.useMutation({
    onSuccess: () => { setRemoving(null); refresh(); toast.success(t("admin.saved")); },
    onError: error => { setRemoving(null); fail(error); },
  });
  const sendReset = trpc.inventory.vendors.sendPasswordReset.useMutation({
    // Says which of the two happened. "Sent" when nothing could be sent is
    // how somebody ends up waiting for an email that was never coming.
    onSuccess: result => toast[result.sent ? "success" : "error"](
      result.sent ? t("admin.resetSentTo", { email: result.email }) : t("admin.resetNotConfigured"),
    ),
    onError: fail,
  });

  const [existing, setExisting] = useState<{ email: string; role: VendorRole }>({ email: "", role: "manager" });
  const [fresh, setFresh] = useState<{ name: string; email: string; password: string; role: VendorRole }>(
    { name: "", email: "", password: "", role: "manager" },
  );

  const rows = members.data ?? [];

  return (
    <Card id="team" title={t("admin.storeTeam")} description={t("admin.storeTeamNote")}>
      <QueryGate queries={[members]}>{() => rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-6 text-center text-[13px] ink-muted">
          {t("admin.noStoreMembers")}
        </p>
      ) : (
        <ul className="divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
          {rows.map(member => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-[14px] font-semibold text-[#0a285a]"><bdi dir="ltr">{member.email}</bdi></p>
                <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t(ROLE_WHAT[member.role as VendorRole])}</p>
              </div>
              <Select
                aria-label={t("admin.memberRole")}
                value={member.role}
                onChange={event => setRole.mutate({ vendorId, userId: member.userId, role: event.target.value as VendorRole })}
                className={`${fieldClass} w-auto`}
              >
                {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
              </Select>
              <button type="button" onClick={() => sendReset.mutate({ userId: member.userId, locale })} disabled={sendReset.isPending} className={buttonClass.secondary}>
                <KeyRound className="size-4" aria-hidden />{t("admin.sendReset")}
              </button>
              <button type="button" onClick={() => setRemoving({ userId: member.userId, email: member.email })} disabled={remove.isPending} className={buttonClass.quietDanger}>
                <Trash2 className="size-4" aria-hidden />{t("admin.removeMember")}
              </button>
            </li>
          ))}
        </ul>
      )}</QueryGate>

      <div className="mt-5 grid gap-5 border-t border-[#eef1f5] pt-5 lg:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={event => { event.preventDefault(); addNew.mutate({ vendorId, ...fresh, name: fresh.name.trim() || null }); }}
        >
          <h3 className="text-[14px] font-bold text-[#0a285a]">{t("admin.createLogin")}</h3>
          <Field label={t("admin.ownerName")} optional>
            <input dir="auto" value={fresh.name} onChange={e => setFresh({ ...fresh, name: e.target.value })} className={fieldClass} />
          </Field>
          <Field label={t("admin.emailAddress")}>
            <input dir="ltr" type="email" value={fresh.email} onChange={e => setFresh({ ...fresh, email: e.target.value })} className={fieldClass} />
          </Field>
          <Field label={t("admin.ownerPassword")} hint={t("admin.ownerPasswordHint")}>
            <PasswordBox value={fresh.password} onChange={password => setFresh({ ...fresh, password })} />
          </Field>
          <Field label={t("admin.memberRole")}>
            <Select value={fresh.role} onChange={e => setFresh({ ...fresh, role: e.target.value as VendorRole })} className={fieldClass}>
              {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])} — {t(ROLE_WHAT[role])}</option>)}
            </Select>
          </Field>
          <button type="submit" disabled={addNew.isPending || fresh.email.trim() === "" || fresh.password.length < 10} className={buttonClass.primary}>
            {addNew.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {t("admin.createLogin")}
          </button>
        </form>

        <form
          className="space-y-3"
          onSubmit={event => { event.preventDefault(); addExisting.mutate({ vendorId, email: existing.email.trim(), role: existing.role }); }}
        >
          <h3 className="text-[14px] font-bold text-[#0a285a]">{t("admin.addExisting")}</h3>
          <Field label={t("admin.emailAddress")}>
            <input dir="ltr" type="email" value={existing.email} onChange={e => setExisting({ ...existing, email: e.target.value })} className={fieldClass} />
          </Field>
          <Field label={t("admin.memberRole")}>
            <Select value={existing.role} onChange={e => setExisting({ ...existing, role: e.target.value as VendorRole })} className={fieldClass}>
              {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])} — {t(ROLE_WHAT[role])}</option>)}
            </Select>
          </Field>
          <button type="submit" disabled={addExisting.isPending || existing.email.trim() === ""} className={buttonClass.secondary}>
            {addExisting.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {t("admin.addMember")}
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={t("admin.removeMemberTitle", { name: isolate(removing?.email ?? "") })}
        body={t("admin.removeMemberBody")}
        confirmLabel={t("admin.removeMember")}
        tone="danger"
        icon={<UserMinus className="size-5" aria-hidden />}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ vendorId, userId: removing.userId })}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}
