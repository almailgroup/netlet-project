/**
 * Who works for this vendor, and at what rank.
 *
 * Each role carries its own one-line description, because "staff" and
 * "manager" mean whatever a given company assumes they mean — and the whole
 * point of these ranks is that they do something specific. Saying it next to
 * the control is what stops an owner handing out publish rights by accident.
 *
 * Staff and managers see this list read-only: knowing who else is in the
 * vendor is reasonable, changing it is not.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Link } from "wouter";
import { QueryGate } from "@/components/admin/QueryGate";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, VENDOR_ROLES, type Actor, type VendorRole } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaff",
  manager: "admin.roleManager",
  owner: "admin.roleOwner",
};

const ROLE_NOTE: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaffNote",
  manager: "admin.roleManagerNote",
  owner: "admin.roleOwnerNote",
};

export default function AdminTeam() {
  usePageMeta(privatePageMeta("Team"));
  return <AdminShell need={"vendor.viewMembers"}>{actor => <Team actor={actor} />}</AdminShell>;
}

function Team({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  // An admin has no single vendor of their own, so there is no team page for
  // them — they reach a vendor's people through the vendor list.
  const vendorId = actor.kind === "vendor" ? actor.vendorId : 0;
  const members = trpc.inventory.vendors.members.useQuery({ vendorId }, { enabled: vendorId > 0 });

  const done = () => { void utils.inventory.vendors.members.invalidate({ vendorId }); toast.success(t("admin.saved")); };
  const fail = () => toast.error(t("admin.forbidden"));
  const setRole = trpc.inventory.vendors.setMemberRole.useMutation({ onSuccess: done, onError: fail });
  const remove = trpc.inventory.vendors.removeMember.useMutation({ onSuccess: done, onError: fail });

  const mayManage = can(actor, "vendor.manageMembers", vendorId);

  /* An administrator belongs to no store, so this page has nobody to list for
     them. It used to say so with the sentence meant for a shopper who has not
     been added anywhere — and with no heading at all. Each store's people are
     on its own page, so that is where this points. */
  if (vendorId === 0) {
    return (
      <>
        <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.team")}</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-[#536b8c]">{t("admin.teamAdminNote")}</p>
        <Link href="/admin/vendors" className="glass pressable mt-4 inline-flex rounded-full px-4 py-2 text-xs font-extrabold">{t("admin.vendors")}</Link>
      </>
    );
  }
  if (members.isLoading || members.isError) return <QueryGate queries={[members]}>{() => null}</QueryGate>;

  const rows = members.data ?? [];

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.team")}</h1>

      <ul className="mt-5 space-y-2">
        {rows.map(member => (
          <li key={member.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[#0a285a]"><bdi>{member.name || member.email}</bdi></p>
              <p className="mt-0.5 text-[11px] ink-muted"><bdi dir="ltr">{member.email}</bdi></p>
            </div>
            {mayManage ? (
              <>
                <select
                  value={member.role}
                  onChange={event => setRole.mutate({ vendorId, userId: member.userId, role: event.target.value as VendorRole })}
                  aria-label={t("admin.memberRole")}
                  className="type-body h-9 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] outline-none focus:border-[#0a285a]"
                >
                  {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
                </select>
                <button
                  onClick={() => remove.mutate({ vendorId, userId: member.userId })}
                  aria-label={t("admin.remove")}
                  className="glass pressable grid size-9 place-items-center rounded-full text-[#8c2f22]"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            ) : (
              <span className="rounded-full bg-[#e7edf5] px-2.5 py-1 text-[10px] font-extrabold">{t(ROLE_LABEL[member.role as VendorRole])}</span>
            )}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-10 text-center text-sm font-extrabold">
            {t("admin.noMembers")}
          </li>
        ) : null}
      </ul>

      {/* What each rank actually means, next to where it is chosen. */}
      <dl className="mt-6 space-y-2 rounded-2xl border border-[#e6e9ef] bg-[#fbfcfe] p-4 text-[12px]">
        {VENDOR_ROLES.map(role => (
          <div key={role} className="flex gap-2">
            <dt className="shrink-0 font-extrabold text-[#0a285a]">{t(ROLE_LABEL[role])}</dt>
            <dd className="text-[#536b8c]">{t(ROLE_NOTE[role])}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
