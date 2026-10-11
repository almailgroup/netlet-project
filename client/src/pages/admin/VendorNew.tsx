/**
 * Opening a store, and its owner's login, in one page.
 *
 * Before this, onboarding a seller meant inserting a vendor row by hand in
 * the database, asking the person to register on the storefront, then finding
 * them in People and attaching them — three systems, one of which was a SQL
 * console. That is the whole reason this page exists, so it asks for
 * everything in one pass rather than sending an admin round a loop.
 *
 * Three groups, in the order an admin actually has the information: who the
 * store is, who signs in for it, and what NetLet charges it. The owner group
 * is optional on purpose — a store recorded today whose owner is attached
 * next week is a real case, and refusing it would send them back to the
 * database client this replaces.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, Field, PageHeader, buttonClass, fieldClass } from "@/components/admin/ui";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { isValidIban, isValidKuwaitPhone, storeSlug } from "@shared/inventory/storeProfile";
import { DEFAULT_COMMISSION_PERCENT } from "@shared/inventory/commission";
import { kuwaitDeliveryZones } from "@shared/customer";
import { ArrowLeft, LoaderCircle, Store } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function AdminVendorNew() {
  usePageMeta(privatePageMeta("New store"));
  return <AdminShell need={"platform.manageUsers"}>{() => <NewStore />}</AdminShell>;
}

const textarea = `${fieldClass} h-auto min-h-24 py-2.5 leading-6`;

const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaff",
  manager: "admin.roleManager",
  owner: "admin.roleOwner",
};

const STATUSES = ["pending", "approved", "suspended"] as const;

type Draft = {
  name: string; nameAr: string; slug: string;
  contactEmail: string; contactPhone: string;
  governorate: string; addressLine: string;
  licenceNumber: string; payoutIban: string;
  description: string; descriptionAr: string; logoUrl: string;
  ownerName: string; ownerEmail: string; ownerPassword: string; ownerRole: VendorRole;
  status: (typeof STATUSES)[number]; commissionPercent: string; commissionFixed: string; autoPublish: boolean;
};

const EMPTY: Draft = {
  name: "", nameAr: "", slug: "",
  contactEmail: "", contactPhone: "",
  governorate: "", addressLine: "",
  licenceNumber: "", payoutIban: "",
  description: "", descriptionAr: "", logoUrl: "",
  ownerName: "", ownerEmail: "", ownerPassword: "", ownerRole: "owner",
  /* The one constant `/sell` quotes and a new store is charged, so this page
     cannot open a store at a rate the rest of NetLet does not know. */
  status: "approved", commissionPercent: DEFAULT_COMMISSION_PERCENT, commissionFixed: "", autoPublish: false,
};

function NewStore() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /* The slug follows the name until an admin types one, and then stops —
     otherwise correcting the name silently undoes their chosen address. */
  const [slugTouched, setSlugTouched] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const slug = slugTouched ? draft.slug : storeSlug(draft.name);

  const create = trpc.inventory.vendors.create.useMutation({
    onSuccess: result => {
      void utils.inventory.vendors.list.invalidate();
      toast.success(t("admin.storeOpened"));
      navigate(`/admin/vendors/${result.vendor.id}`);
    },
    onError: error =>
      toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed")),
  });

  /*
   * The same rules the server applies, applied here first.
   *
   * Not instead of the server — `server/routers/inventory.ts` runs the very
   * same pure functions — but so a mistyped IBAN is caught beside the box
   * rather than as a toast after a round trip.
   */
  const problems: Partial<Record<keyof Draft, MessageKey>> = {};
  if (draft.contactPhone.trim() && !isValidKuwaitPhone(draft.contactPhone)) problems.contactPhone = "admin.invalidPhone";
  if (draft.payoutIban.trim() && !isValidIban(draft.payoutIban)) problems.payoutIban = "admin.invalidIban";

  const wantsOwner = draft.ownerEmail.trim() !== "" || draft.ownerPassword !== "";
  const ownerReady = !wantsOwner || (draft.ownerEmail.trim() !== "" && draft.ownerPassword.length >= 10);
  const ready = draft.name.trim() !== "" && slug !== "" && ownerReady && Object.keys(problems).length === 0;

  const submit = () => {
    const blank = (value: string) => (value.trim() === "" ? null : value.trim());
    create.mutate({
      name: draft.name.trim(),
      slug,
      status: draft.status,
      commissionPercent: draft.commissionPercent || DEFAULT_COMMISSION_PERCENT,
      commissionFixed: blank(draft.commissionFixed),
      autoPublish: draft.autoPublish,
      nameAr: blank(draft.nameAr),
      contactEmail: blank(draft.contactEmail),
      contactPhone: blank(draft.contactPhone),
      governorate: blank(draft.governorate),
      addressLine: blank(draft.addressLine),
      licenceNumber: blank(draft.licenceNumber),
      payoutIban: blank(draft.payoutIban),
      description: blank(draft.description),
      descriptionAr: blank(draft.descriptionAr),
      logoUrl: blank(draft.logoUrl),
      owner: wantsOwner
        ? {
            email: draft.ownerEmail.trim(),
            password: draft.ownerPassword,
            name: blank(draft.ownerName),
            role: draft.ownerRole,
          }
        : null,
    });
  };

  return (
    <>
      <PageHeader title={t("admin.openStoreButton")} description={t("admin.newStoreIntro")}>
        <Link href="/admin/vendors" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.backToVendors")}
        </Link>
      </PageHeader>

      <form
        noValidate
        onSubmit={event => { event.preventDefault(); if (ready && !create.isPending) submit(); }}
        className="max-w-4xl space-y-5"
      >
        <Card step={1} title={t("admin.storeDetails")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.storeName")}>
              <input dir="auto" value={draft.name} onChange={e => set("name", e.target.value)} required className={fieldClass} />
            </Field>
            <Field label={t("admin.storeNameAr")} optional>
              <input dir="rtl" lang="ar" value={draft.nameAr} onChange={e => set("nameAr", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.storeSlug")} hint={t("admin.storeSlugHint")}>
              <input
                dir="ltr"
                value={slug}
                onChange={e => { setSlugTouched(true); set("slug", e.target.value); }}
                autoComplete="off"
                spellCheck={false}
                className={fieldClass}
              />
            </Field>
            <Field label={t("admin.logoUrl")} optional>
              <input dir="ltr" type="url" inputMode="url" placeholder="https://" value={draft.logoUrl} onChange={e => set("logoUrl", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.contactEmail")}>
              <input dir="ltr" type="email" value={draft.contactEmail} onChange={e => set("contactEmail", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.contactPhone")} error={problems.contactPhone && t(problems.contactPhone)}>
              <input dir="ltr" inputMode="tel" value={draft.contactPhone} onChange={e => set("contactPhone", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.governorate")}>
              <select value={draft.governorate} onChange={e => set("governorate", e.target.value)} className={fieldClass}>
                <option value="">{t("admin.notSet")}</option>
                {kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
              </select>
            </Field>
            <Field label={t("admin.addressLine")}>
              <input dir="auto" value={draft.addressLine} onChange={e => set("addressLine", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.licenceNumber")}>
              <input dir="ltr" value={draft.licenceNumber} onChange={e => set("licenceNumber", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.payoutIban")} error={problems.payoutIban && t(problems.payoutIban)}>
              <input dir="ltr" autoComplete="off" spellCheck={false} value={draft.payoutIban} onChange={e => set("payoutIban", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.storeDescription")} optional className="sm:col-span-2">
              <textarea dir="auto" value={draft.description} onChange={e => set("description", e.target.value)} rows={4} className={textarea} />
            </Field>
            <Field label={t("admin.storeDescriptionAr")} optional className="sm:col-span-2">
              <textarea dir="rtl" lang="ar" value={draft.descriptionAr} onChange={e => set("descriptionAr", e.target.value)} rows={4} className={textarea} />
            </Field>
          </div>
        </Card>

        <Card step={2} title={t("admin.ownerAccount")} description={t("admin.ownerAccountNote")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.ownerName")} optional>
              <input dir="auto" value={draft.ownerName} onChange={e => set("ownerName", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.ownerRole")}>
              <select value={draft.ownerRole} onChange={e => set("ownerRole", e.target.value as VendorRole)} className={fieldClass}>
                {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
              </select>
            </Field>
            <Field label={t("admin.ownerEmail")}>
              <input dir="ltr" type="email" value={draft.ownerEmail} onChange={e => set("ownerEmail", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.ownerPassword")} hint={t("admin.ownerPasswordHint")}>
              <input dir="ltr" type="password" autoComplete="new-password" value={draft.ownerPassword} onChange={e => set("ownerPassword", e.target.value)} className={fieldClass} />
            </Field>
          </div>
        </Card>

        <Card step={3} title={t("admin.commercialTerms")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.vendorStatus")} hint={t("admin.statusHint")}>
              <select value={draft.status} onChange={e => set("status", e.target.value as Draft["status"])} className={fieldClass}>
                {STATUSES.map(status => <option key={status} value={status}>{t(`vendorStatus.${status}` as MessageKey)}</option>)}
              </select>
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3.5">
              <input
                type="checkbox"
                role="switch"
                checked={draft.autoPublish}
                onChange={e => set("autoPublish", e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-[#0a285a]"
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#0a285a]">{t("admin.autoPublishLabel")}</span>
                <span className="mt-0.5 block text-[12px] leading-5 ink-muted">{t("admin.autoPublishHint")}</span>
              </span>
            </label>
            <Field label={t("admin.commissionPercent")} hint={t("admin.commissionPercentHint")}>
              <input dir="ltr" inputMode="decimal" value={draft.commissionPercent} onChange={e => set("commissionPercent", e.target.value)} className={fieldClass} />
            </Field>
            <Field label={t("admin.commissionFixed")} optional>
              <input dir="ltr" inputMode="decimal" placeholder="0.000" value={draft.commissionFixed} onChange={e => set("commissionFixed", e.target.value)} className={fieldClass} />
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!ready || create.isPending} className={buttonClass.primary}>
            {create.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Store className="size-4" aria-hidden />}
            {t("admin.createStore")}
          </button>
          <Link href="/admin/vendors" className={buttonClass.secondary}>{t("common.cancel")}</Link>
        </div>
      </form>
    </>
  );
}
