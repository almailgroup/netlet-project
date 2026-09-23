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
import { QueryGate } from "@/components/admin/QueryGate";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { DELIVERY_SPEEDS, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { TRUST_BADGES, visibleBadges, type TrustBadge } from "@shared/inventory/vendorHealth";
import { isValidIban, isValidKuwaitPhone, missingStoreDetails } from "@shared/inventory/storeProfile";
import { kuwaitDeliveryZones } from "@shared/customer";
import { ArrowLeft, LoaderCircle, Save, UserPlus } from "lucide-react";
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
    discountLicenceNumber: "", discountLicenceExpiresAt: "",
    deliveryFlat: "", deliveryFreeOver: "", deliverySpeed: "", deliveryProvider: "",
    underPlatformLicence: false, acceptsCod: true, codCeiling: "",
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
      discountLicenceNumber: row.discountLicenceNumber ?? "",
      deliveryFlat: row.deliveryFlat ?? "",
      deliveryFreeOver: row.deliveryFreeOver ?? "",
      deliverySpeed: row.deliverySpeed ?? "",
      deliveryProvider: row.deliveryProvider ?? "",
      underPlatformLicence: row.underPlatformLicence ?? false,
      acceptsCod: row.acceptsCod ?? true,
      codCeiling: row.codCeiling ?? "",
      // <input type="date"> speaks yyyy-mm-dd and nothing else.
      discountLicenceExpiresAt: row.discountLicenceExpiresAt
        ? new Date(row.discountLicenceExpiresAt).toISOString().slice(0, 10)
        : "",
      description: row.description ?? "", descriptionAr: row.descriptionAr ?? "",
      logoUrl: row.logoUrl ?? "",
    });
    setTerms({ commissionPercent: row.commissionPercent, commissionFixed: row.commissionFixed ?? "" });
  }, [row]);

  if (vendor.isLoading || vendor.isError) return <QueryGate queries={[vendor]}>{() => null}</QueryGate>;
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
          <p className="mt-0.5 text-[11px] ink-muted"><bdi dir="ltr">/{row.slug}</bdi></p>
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
          {/* The Ministry of Commerce discount permit. Without a valid one the
              storefront stops showing this store's savings — on read, because
              a permit expires with nobody saving anything. */}
          <Labelled label={t("admin.discountLicence")}>
            <input dir="ltr" value={draft.discountLicenceNumber} onChange={e => set("discountLicenceNumber", e.target.value)} className={field} />
          </Labelled>
          <Labelled label={t("admin.discountLicenceExpires")}>
            <input type="date" value={draft.discountLicenceExpiresAt} onChange={e => set("discountLicenceExpiresAt", e.target.value)} className={field} />
          </Labelled>
          {/* The store's usual band (3.2.5). Blank states nothing, and nothing
              is what the storefront shows — a default would be NetLet
              promising on the seller's behalf. */}
          <Labelled label={t("admin.fieldDeliverySpeed")} className="sm:col-span-2">
            <select value={draft.deliverySpeed} onChange={e => set("deliverySpeed", e.target.value)} className={field}>
              <option value="">{t("admin.speedUnset")}</option>
              {DELIVERY_SPEEDS.map(speed => (
                <option key={speed} value={speed}>{t(`speed.${speed}` as MessageKey)}</option>
              ))}
            </select>
          </Labelled>
          <p className="text-[11px] ink-muted sm:col-span-2">{t("admin.discountLicenceHint")}</p>
          {/* What this store charges to deliver (3.2.4). Blank is free, which
              errs toward the shopper: charging a number the seller never typed
              would be inventing a price. The threshold is measured against
              this store's own goods, never the whole basket — otherwise one
              seller's money pays for another seller's sale. */}
          <Labelled label={t("admin.fieldDeliveryFlat")}>
            <input dir="ltr" inputMode="decimal" value={draft.deliveryFlat} onChange={e => set("deliveryFlat", e.target.value)} className={field} />
          </Labelled>
          <Labelled label={t("admin.fieldDeliveryFreeOver")}>
            <input dir="ltr" inputMode="decimal" value={draft.deliveryFreeOver} onChange={e => set("deliveryFreeOver", e.target.value)} className={field} />
          </Labelled>
          {/* Who this store ships with (3.4.13). Free text on purpose: NetLet
              integrates with no carrier, and a fixed list would be this
              codebase asserting which companies exist in Kuwait. */}
          <Labelled label={t("admin.fieldDeliveryProvider")} className="sm:col-span-2">
            <input dir="auto" value={draft.deliveryProvider} onChange={e => set("deliveryProvider", e.target.value)} className={field} />
          </Labelled>
          <p className="text-[11px] ink-muted sm:col-span-2">
            {t("admin.fieldDeliveryFlatHint")} {t("admin.fieldDeliveryFreeOverHint")} {t("admin.fieldDeliveryProviderHint")}
          </p>
          {/* Recorded rather than inferred from a blank licence number (3.3.16):
              a seller who has not handed their paperwork in is not the same as
              one trading under ours, and collapsing the two would put NetLet's
              name behind somebody who never asked for it. */}
          <label className="flex items-start gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.underPlatformLicence}
              onChange={e => setDraft(d => ({ ...d, underPlatformLicence: e.target.checked }))}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="block text-[11px] font-extrabold text-[#0a285a]">{t("admin.underPlatformLicence")}</span>
              <span className="block text-[11px] leading-5 ink-muted">{t("admin.underPlatformLicenceHint")}</span>
            </span>
          </label>
          {/* Cash on delivery (3.2.2). On by default — a seller opts out — so a
              new store that has recorded nothing is still buyable from. The
              ceiling is their own risk appetite: a driver carrying a thousand
              dinars is a different proposition from one carrying twenty. */}
          <label className="flex items-start gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.acceptsCod}
              onChange={e => setDraft(d => ({ ...d, acceptsCod: e.target.checked }))}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="block text-[11px] font-extrabold text-[#0a285a]">{t("admin.acceptsCod")}</span>
              <span className="block text-[11px] leading-5 ink-muted">{t("admin.acceptsCodHint")}</span>
            </span>
          </label>
          <Labelled label={t("admin.codCeiling")}>
            <input dir="ltr" inputMode="decimal" value={draft.codCeiling} onChange={e => set("codCeiling", e.target.value)} className={field} />
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
            discountLicenceNumber: blank(draft.discountLicenceNumber),
            discountLicenceExpiresAt: draft.discountLicenceExpiresAt ? new Date(draft.discountLicenceExpiresAt) : null,
            deliveryFlat: blank(draft.deliveryFlat),
            deliveryFreeOver: blank(draft.deliveryFreeOver),
            /* The select only ever offers the listed bands, and the server
               validates against the same list — this cast reconciles the draft's
               plain string with that, it does not widen what is accepted. */
            deliverySpeed: (blank(draft.deliverySpeed) as DeliverySpeed | null),
            deliveryProvider: blank(draft.deliveryProvider),
            underPlatformLicence: draft.underPlatformLicence,
            acceptsCod: draft.acceptsCod,
            codCeiling: blank(draft.codCeiling),
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

  const refresh = () => void utils.inventory.vendors.members.invalidate({ vendorId });
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
  const remove = trpc.inventory.vendors.removeMember.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
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
    <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h2 className="text-sm font-extrabold">{t("admin.storeTeam")}</h2>
      <p className="mt-1 max-w-prose text-[12px] leading-5 text-[#536b8c]">{t("admin.storeTeamNote")}</p>

      <QueryGate queries={[members]}>{() => rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#b8c9dc] px-4 py-6 text-center text-[12px] text-[#536b8c]">
          {t("admin.noStoreMembers")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map(member => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e6e9ef] p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-[#0a285a]"><bdi dir="ltr">{member.email}</bdi></p>
                <p className="mt-0.5 text-[10px] ink-muted">{t(ROLE_WHAT[member.role as VendorRole])}</p>
              </div>
              <select
                aria-label={t("admin.memberRole")}
                value={member.role}
                onChange={event => setRole.mutate({ vendorId, userId: member.userId, role: event.target.value as VendorRole })}
                className="type-body h-9 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] outline-none focus:border-[#f2683a]"
              >
                {VENDOR_ROLES.map(role => (
                  <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>
                ))}
              </select>
              <button
                onClick={() => sendReset.mutate({ userId: member.userId, locale })}
                disabled={sendReset.isPending}
                className="pressable rounded-full border border-[#d5dfeb] px-3 py-1.5 text-[11px] font-extrabold text-[#536b8c] hover:border-[#0a285a] hover:text-[#0a285a] disabled:opacity-60"
              >
                {t("admin.sendReset")}
              </button>
              <button
                onClick={() => remove.mutate({ vendorId, userId: member.userId })}
                disabled={remove.isPending}
                className="pressable rounded-full border border-[#f2b69e] px-3 py-1.5 text-[11px] font-extrabold text-[#8c2f22] disabled:opacity-60"
              >
                {t("admin.removeMember")}
              </button>
            </li>
          ))}
        </ul>
      )}</QueryGate>

      <div className="mt-5 grid gap-4 border-t border-[#e6e9ef] pt-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-extrabold text-[#0a285a]">{t("admin.createLogin")}</p>
          <div className="mt-2 space-y-2">
            <input
              dir="auto"
              placeholder={t("admin.ownerName")}
              value={fresh.name}
              onChange={e => setFresh({ ...fresh, name: e.target.value })}
              className={field}
            />
            <input
              dir="ltr"
              type="email"
              placeholder={t("admin.emailAddress")}
              value={fresh.email}
              onChange={e => setFresh({ ...fresh, email: e.target.value })}
              className={field}
            />
            <input
              dir="ltr"
              type="password"
              autoComplete="new-password"
              placeholder={t("admin.ownerPassword")}
              value={fresh.password}
              onChange={e => setFresh({ ...fresh, password: e.target.value })}
              className={field}
            />
            <select
              aria-label={t("admin.memberRole")}
              value={fresh.role}
              onChange={e => setFresh({ ...fresh, role: e.target.value as VendorRole })}
              className={field}
            >
              {VENDOR_ROLES.map(role => (
                <option key={role} value={role}>{t(ROLE_LABEL[role])} — {t(ROLE_WHAT[role])}</option>
              ))}
            </select>
            <p className="text-[10px] ink-muted">{t("admin.ownerPasswordHint")}</p>
            <button
              onClick={() => addNew.mutate({ vendorId, ...fresh, name: fresh.name.trim() || null })}
              disabled={addNew.isPending || fresh.email.trim() === "" || fresh.password.length < 10}
              className="glass glass-navy pressable inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold disabled:opacity-60"
            >
              {addNew.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {t("admin.createLogin")}
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-extrabold text-[#0a285a]">{t("admin.addExisting")}</p>
          <div className="mt-2 space-y-2">
            <input
              dir="ltr"
              type="email"
              placeholder={t("admin.emailAddress")}
              value={existing.email}
              onChange={e => setExisting({ ...existing, email: e.target.value })}
              className={field}
            />
            <select
              aria-label={t("admin.memberRole")}
              value={existing.role}
              onChange={e => setExisting({ ...existing, role: e.target.value as VendorRole })}
              className={field}
            >
              {VENDOR_ROLES.map(role => (
                <option key={role} value={role}>{t(ROLE_LABEL[role])} — {t(ROLE_WHAT[role])}</option>
              ))}
            </select>
            <button
              onClick={() => addExisting.mutate({ vendorId, email: existing.email.trim(), role: existing.role })}
              disabled={addExisting.isPending || existing.email.trim() === ""}
              className="glass pressable inline-flex h-10 items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 text-xs font-extrabold disabled:opacity-60"
            >
              {addExisting.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {t("admin.addMember")}
            </button>
          </div>
        </div>
      </div>
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
