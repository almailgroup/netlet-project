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
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { isValidIban, isValidKuwaitPhone, storeSlug } from "@shared/inventory/storeProfile";
import { kuwaitDeliveryZones } from "@shared/customer";
import { ArrowLeft, LoaderCircle, Store } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function AdminVendorNew() {
  usePageMeta(privatePageMeta("New store"));
  return <AdminShell need={"platform.manageUsers"}>{() => <NewStore />}</AdminShell>;
}

const field =
  "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";
const area =
  "type-body min-h-20 w-full rounded-xl border border-[#d5dfeb] bg-white p-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

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
  status: "approved", commissionPercent: "10.00", commissionFixed: "", autoPublish: false,
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
      commissionPercent: draft.commissionPercent || "10.00",
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
      <Link href="/admin/vendors" className="inline-flex items-center gap-2 text-[12px] font-bold text-[#536b8c] hover:text-[#0a285a]">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />{t("admin.backToVendors")}
      </Link>

      <h1 className="mt-3 text-xl font-extrabold">{t("admin.newStore")}</h1>
      <p className="mt-1 max-w-prose text-[13px] leading-6 text-[#536b8c]">{t("admin.newStoreIntro")}</p>

      <Group title={t("admin.storeDetails")}>
        <Labelled label={t("admin.storeName")} className="sm:col-span-2">
          <input dir="auto" value={draft.name} onChange={e => set("name", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.storeNameAr")} className="sm:col-span-2">
          <input dir="rtl" value={draft.nameAr} onChange={e => set("nameAr", e.target.value)} className={field} />
        </Labelled>

        <Labelled label={t("admin.storeSlug")} hint={t("admin.storeSlugHint")} className="sm:col-span-2">
          <input
            dir="ltr"
            value={slug}
            onChange={e => { setSlugTouched(true); set("slug", e.target.value); }}
            className={field}
          />
        </Labelled>
        <Labelled label={t("admin.logoUrl")} className="sm:col-span-2">
          <input dir="ltr" value={draft.logoUrl} onChange={e => set("logoUrl", e.target.value)} className={field} />
        </Labelled>

        <Labelled label={t("admin.contactEmail")}>
          <input dir="ltr" type="email" value={draft.contactEmail} onChange={e => set("contactEmail", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.contactPhone")} problem={problems.contactPhone}>
          <input dir="ltr" inputMode="tel" value={draft.contactPhone} onChange={e => set("contactPhone", e.target.value)} className={field} />
        </Labelled>

        <Labelled label={t("admin.governorate")}>
          <select value={draft.governorate} onChange={e => set("governorate", e.target.value)} className={field}>
            <option value="">{t("admin.notSet")}</option>
            {kuwaitDeliveryZones.map(zone => (
              <option key={zone.id} value={zone.id}>{zone.label}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t("admin.addressLine")}>
          <input dir="auto" value={draft.addressLine} onChange={e => set("addressLine", e.target.value)} className={field} />
        </Labelled>

        <Labelled label={t("admin.licenceNumber")}>
          <input dir="ltr" value={draft.licenceNumber} onChange={e => set("licenceNumber", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.payoutIban")} problem={problems.payoutIban}>
          <input dir="ltr" value={draft.payoutIban} onChange={e => set("payoutIban", e.target.value)} className={field} />
        </Labelled>

        <Labelled label={t("admin.storeDescription")} className="sm:col-span-2">
          <textarea dir="auto" value={draft.description} onChange={e => set("description", e.target.value)} className={area} />
        </Labelled>
        <Labelled label={t("admin.storeDescriptionAr")} className="sm:col-span-2">
          <textarea dir="rtl" value={draft.descriptionAr} onChange={e => set("descriptionAr", e.target.value)} className={area} />
        </Labelled>
      </Group>

      <Group title={t("admin.ownerAccount")} note={t("admin.ownerAccountNote")}>
        <Labelled label={t("admin.ownerName")}>
          <input dir="auto" value={draft.ownerName} onChange={e => set("ownerName", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.ownerRole")}>
          <select value={draft.ownerRole} onChange={e => set("ownerRole", e.target.value as VendorRole)} className={field}>
            {VENDOR_ROLES.map(role => (
              <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t("admin.ownerEmail")}>
          <input dir="ltr" type="email" value={draft.ownerEmail} onChange={e => set("ownerEmail", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.ownerPassword")} hint={t("admin.ownerPasswordHint")}>
          <input
            dir="ltr"
            type="password"
            autoComplete="new-password"
            value={draft.ownerPassword}
            onChange={e => set("ownerPassword", e.target.value)}
            className={field}
          />
        </Labelled>
      </Group>

      <Group title={t("admin.commercialTerms")}>
        <Labelled label={t("admin.vendorStatus")}>
          <select value={draft.status} onChange={e => set("status", e.target.value as Draft["status"])} className={field}>
            {STATUSES.map(status => (
              <option key={status} value={status}>{t(`vendorStatus.${status}` as MessageKey)}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t("admin.commissionPercent")}>
          <input dir="ltr" inputMode="decimal" value={draft.commissionPercent} onChange={e => set("commissionPercent", e.target.value)} className={field} />
        </Labelled>
        <Labelled label={t("admin.commissionFixed")}>
          <input dir="ltr" inputMode="decimal" value={draft.commissionFixed} onChange={e => set("commissionFixed", e.target.value)} className={field} />
        </Labelled>
        <label className="flex items-center gap-2.5 self-end pb-2.5">
          <input
            type="checkbox"
            checked={draft.autoPublish}
            onChange={e => set("autoPublish", e.target.checked)}
            className="size-4 rounded border-[#d5dfeb] accent-[#0a285a]"
          />
          <span className="text-[12px] font-bold text-[#0a285a]">{t("admin.autoPublish")}</span>
        </label>
      </Group>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={submit}
          disabled={!ready || create.isPending}
          className="glass glass-navy pressable inline-flex h-11 items-center gap-2 rounded-full px-5 text-xs font-extrabold disabled:opacity-60"
        >
          {create.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Store className="size-4" />}
          {t("admin.createStore")}
        </button>
      </div>
    </>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h2 className="text-sm font-extrabold">{title}</h2>
      {note ? <p className="mt-1 text-[12px] leading-5 text-[#536b8c]">{note}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Labelled({ label, hint, problem, className = "", children }: {
  label: string;
  hint?: string;
  problem?: MessageKey;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-extrabold text-[#0a285a]">{label}</span>
      {hint ? <span className="mt-0.5 block text-[10px] font-semibold ink-muted">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
      {problem ? <span className="mt-1 block text-[10px] font-bold text-[#8c2f22]">{t(problem)}</span> : null}
    </label>
  );
}
