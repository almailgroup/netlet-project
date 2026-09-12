/**
 * One store: its details, its terms, its badges and its team.
 *
 * This is where everything that used to be crammed into a row of the vendor
 * list now lives. Four sections rather than one, because they are four
 * different decisions made at four different times — recording an address is
 * not the same act as changing what NetLet charges, and an audit trail that
 * says "updated" for both is worse than one that says which.
 *
 * Each section saves on its own for the same reason: one Save across the page
 * would write a commission change nobody meant, because they came to fix a
 * phone number.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { TRUST_BADGES, visibleBadges, type TrustBadge } from "@shared/inventory/vendorHealth";
import { isValidIban, isValidKuwaitPhone, missingStoreDetails } from "@shared/inventory/storeProfile";
import { kuwaitDeliveryZones } from "@shared/customer";
import { ArrowLeft, LoaderCircle, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";

export default function AdminVendorDetail() {
  usePageMeta(privatePageMeta("Store"));
  const [, params] = useRoute("/admin/vendors/:id");
  const id = Number(params?.id ?? 0);
  return <AdminShell need={"platform.viewAll"}>{() => <VendorDetail vendorId={id} />}</AdminShell>;
}

const field =
  "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";
const area =
  "type-body min-h-20 w-full rounded-xl border border-[#d5dfeb] bg-white p-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

const STATUSES = ["pending", "approved", "suspended"] as const;

function VendorDetail({ vendorId }: { vendorId: number }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const vendor = trpc.inventory.vendors.get.useQuery({ vendorId }, { enabled: vendorId > 0 });

  const refresh = () => {
    void utils.inventory.vendors.get.invalidate({ vendorId });
    void utils.inventory.vendors.list.invalidate();
  };
  const done = () => { refresh(); toast.success(t("admin.saved")); };
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.forbidden"));

  const saveProfile = trpc.inventory.vendors.updateProfile.useMutation({ onSuccess: done, onError: fail });
  const setStatus = trpc.inventory.vendors.setStatus.useMutation({ onSuccess: done, onError: fail });
  const setCommission = trpc.inventory.vendors.setCommission.useMutation({ onSuccess: done, onError: fail });
  const setBadges = trpc.inventory.vendors.setBadges.useMutation({ onSuccess: done, onError: fail });

  const row = vendor.data;
  const [draft, setDraft] = useState({
    name: "", nameAr: "", contactEmail: "", contactPhone: "",
    governorate: "", addressLine: "", licenceNumber: "", payoutIban: "",
    description: "", descriptionAr: "", logoUrl: "",
  });
  const [terms, setTerms] = useState({ commissionPercent: "", commissionFixed: "" });

  useEffect(() => {
    if (!row) return;
    setDraft({
      name: row.name, nameAr: row.nameAr ?? "",
      contactEmail: row.contactEmail ?? "", contactPhone: row.contactPhone ?? "",
      governorate: row.governorate ?? "", addressLine: row.addressLine ?? "",
      licenceNumber: row.licenceNumber ?? "", payoutIban: row.payoutIban ?? "",
      description: row.description ?? "", descriptionAr: row.descriptionAr ?? "",
      logoUrl: row.logoUrl ?? "",
    });
    setTerms({ commissionPercent: row.commissionPercent, commissionFixed: row.commissionFixed ?? "" });
  }, [row]);

  if (vendor.isLoading) return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;
  if (!row) return <p className="text-sm font-bold">{t("admin.noVendors")}</p>;

  const set = <K extends keyof typeof draft>(key: K, value: string) =>
    setDraft(current => ({ ...current, [key]: value }));

  const problems: Partial<Record<keyof typeof draft, MessageKey>> = {};
  if (draft.contactPhone.trim() && !isValidKuwaitPhone(draft.contactPhone)) problems.contactPhone = "admin.invalidPhone";
  if (draft.payoutIban.trim() && !isValidIban(draft.payoutIban)) problems.payoutIban = "admin.invalidIban";

  const held = visibleBadges(row.badges);
  const missing = missingStoreDetails(row).length;
  const blank = (value: string) => (value.trim() === "" ? null : value.trim());

  return (
    <>
      <Link href="/admin/vendors" className="inline-flex items-center gap-2 text-[12px] font-bold text-[#536b8c] hover:text-[#0a285a]">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />{t("admin.backToVendors")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 dir="auto" className="text-xl font-extrabold">{row.name}</h1>
          <p dir="ltr" className="mt-0.5 text-[11px] text-[#9ea4b5]">/{row.slug}</p>
        </div>
        <p className={`text-[12px] font-extrabold ${missing > 0 ? "text-[#8a6d3b]" : "text-[#155724]"}`}>
          {missing > 0
            ? t(missing === 1 ? "admin.incomplete" : "admin.incompletePlural", { count: missing })
            : t("admin.complete")}
        </p>
      </div>

      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.storeDetails")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Labelled label={t("admin.storeName")}>
            <input dir="auto" value={draft.name} onChange={e => set("name", e.target.value)} className={field} />
          </Labelled>
          <Labelled label={t("admin.storeNameAr")}>
            <input dir="rtl" value={draft.nameAr} onChange={e => set("nameAr", e.target.value)} className={field} />
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
          <Labelled label={t("admin.logoUrl")} className="sm:col-span-2">
            <input dir="ltr" value={draft.logoUrl} onChange={e => set("logoUrl", e.target.value)} className={field} />
          </Labelled>
          <Labelled label={t("admin.storeDescription")} className="sm:col-span-2">
            <textarea dir="auto" value={draft.description} onChange={e => set("description", e.target.value)} className={area} />
          </Labelled>
          <Labelled label={t("admin.storeDescriptionAr")} className="sm:col-span-2">
            <textarea dir="rtl" value={draft.descriptionAr} onChange={e => set("descriptionAr", e.target.value)} className={area} />
          </Labelled>
        </div>
        <button
          onClick={() => saveProfile.mutate({
            vendorId,
            name: draft.name.trim(),
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
          })}
          disabled={saveProfile.isPending || Object.keys(problems).length > 0 || draft.name.trim() === ""}
          className="glass glass-navy pressable mt-4 inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold disabled:opacity-60"
        >
          {saveProfile.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("admin.save")}
        </button>
      </section>

      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.commercialTerms")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Labelled label={t("admin.vendorStatus")}>
            <select
              value={row.status}
              onChange={e => setStatus.mutate({ vendorId, status: e.target.value as (typeof STATUSES)[number] })}
              className={field}
            >
              {STATUSES.map(status => (
                <option key={status} value={status}>{t(`vendorStatus.${status}` as MessageKey)}</option>
              ))}
            </select>
          </Labelled>
          <div className="flex items-end pb-2.5">
            {row.autoPublish ? (
              <span className="rounded-full bg-[#d4edda] px-2.5 py-1 text-[10px] font-extrabold text-[#155724]">
                {t("admin.autoPublish")}
              </span>
            ) : null}
          </div>
          <Labelled label={t("admin.commissionPercent")}>
            <input
              dir="ltr"
              inputMode="decimal"
              value={terms.commissionPercent}
              onChange={e => setTerms({ ...terms, commissionPercent: e.target.value })}
              className={field}
            />
          </Labelled>
          <Labelled label={t("admin.commissionFixed")}>
            <input
              dir="ltr"
              inputMode="decimal"
              value={terms.commissionFixed}
              onChange={e => setTerms({ ...terms, commissionFixed: e.target.value })}
              className={field}
            />
          </Labelled>
        </div>
        <button
          onClick={() => setCommission.mutate({
            vendorId,
            percent: terms.commissionPercent,
            fixed: terms.commissionFixed.trim() || null,
          })}
          disabled={setCommission.isPending}
          className="glass glass-navy pressable mt-4 inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold disabled:opacity-60"
        >
          {setCommission.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("admin.save")}
        </button>
      </section>

      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.badges")}</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {TRUST_BADGES.map(badge => {
            const on = held.includes(badge);
            return (
              <button
                key={badge}
                type="button"
                aria-pressed={on}
                disabled={setBadges.isPending}
                onClick={() => setBadges.mutate({
                  vendorId,
                  badges: on ? held.filter(one => one !== badge) : [...held, badge],
                })}
                className={`pressable rounded-full px-3 py-1.5 text-[11px] font-extrabold transition disabled:opacity-60 ${
                  on ? "bg-[#0a285a] text-white" : "border border-[#d5dfeb] bg-white text-[#536b8c] hover:border-[#0a285a]"
                }`}
              >
                {t(`badge.${badge}` as MessageKey)}
              </button>
            );
          })}
        </div>
      </section>

      <VendorTeam vendorId={vendorId} />
    </>
  );
}

/** The store's people, on the store's own page rather than a separate hunt. */
function VendorTeam({ vendorId }: { vendorId: number }) {
  const { t } = useTranslation();
  const members = trpc.inventory.vendors.members.useQuery({ vendorId });
  if (!members.data?.length) return null;

  return (
    <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h2 className="text-sm font-extrabold">{t("admin.team")}</h2>
      <ul className="mt-3 space-y-2">
        {members.data.map(member => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span dir="ltr" className="font-bold text-[#0a285a]">{member.email}</span>
            <span className="text-[#536b8c]">{t(`admin.role${member.role[0].toUpperCase()}${member.role.slice(1)}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Labelled({ label, problem, className = "", children }: {
  label: string;
  problem?: MessageKey;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-extrabold text-[#0a285a]">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {problem ? <span className="mt-1 block text-[10px] font-bold text-[#8c2f22]">{t(problem)}</span> : null}
    </label>
  );
}
