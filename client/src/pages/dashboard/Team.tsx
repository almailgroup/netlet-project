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
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, VENDOR_ROLES, type Actor, type VendorRole } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "dash.roleStaff",
  manager: "dash.roleManager",
  owner: "dash.roleOwner",
};

const ROLE_NOTE: Record<VendorRole, MessageKey> = {
  staff: "dash.roleStaffNote",
  manager: "dash.roleManagerNote",
  owner: "dash.roleOwnerNote",
};

export default function DashboardTeam() {
  usePageMeta(privatePageMeta("Team"));
  return <DashboardShell need={"vendor.viewMembers"}>{actor => <Team actor={actor} />}</DashboardShell>;
}

function Team({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  // An admin has no single vendor of their own, so there is no team page for
  // them — they reach a vendor's people through the vendor list.
  const vendorId = actor.kind === "vendor" ? actor.vendorId : 0;
  const members = trpc.inventory.vendors.members.useQuery({ vendorId }, { enabled: vendorId > 0 });

  const done = () => { void utils.inventory.vendors.members.invalidate({ vendorId }); toast.success(t("dash.saved")); };
  const fail = () => toast.error(t("dash.forbidden"));
  const setRole = trpc.inventory.vendors.setMemberRole.useMutation({ onSuccess: done, onError: fail });
  const remove = trpc.inventory.vendors.removeMember.useMutation({ onSuccess: done, onError: fail });

  const mayManage = can(actor, "vendor.manageMembers", vendorId);

  if (vendorId === 0) return <p className="text-sm text-[#536b8c]">{t("dash.noAccessNote")}</p>;
  if (members.isLoading) return <p className="text-sm text-[#536b8c]">{t("dash.loading")}</p>;

  const rows = members.data ?? [];

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("dash.team")}</h1>

      <ul className="mt-5 space-y-2">
        {rows.map(member => (
          <li key={member.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4">
            <div className="min-w-0 flex-1">
              <p dir="auto" className="font-bold text-[#0a285a]">{member.name || member.email}</p>
              <p dir="ltr" className="mt-0.5 text-[11px] text-[#9ea4b5]">{member.email}</p>
            </div>
            {mayManage ? (
              <>
                <select
                  value={member.role}
                  onChange={event => setRole.mutate({ vendorId, userId: member.userId, role: event.target.value as VendorRole })}
                  aria-label={t("dash.memberRole")}
                  className="type-body h-9 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] outline-none focus:border-[#f2683a]"
                >
                  {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
                </select>
                <button
                  onClick={() => remove.mutate({ vendorId, userId: member.userId })}
                  aria-label={t("dash.remove")}
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
            {t("dash.noMembers")}
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
