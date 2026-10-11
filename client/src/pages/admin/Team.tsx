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
import { useState } from "react";
import { Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Card, EmptyState, fieldClass, isolate, Notice, PageHeader, Pill, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, VENDOR_ROLES, type Actor, type VendorRole } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Link } from "wouter";

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
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  // An admin has no single vendor of their own, so there is no team page for
  // them — they reach a vendor's people through the vendor list.
  const vendorId = actor.kind === "vendor" ? actor.vendorId : 0;
  const members = trpc.inventory.vendors.members.useQuery({ vendorId }, { enabled: vendorId > 0 });
  const [removing, setRemoving] = useState<{ userId: number; name: string } | null>(null);

  const done = () => { void utils.inventory.vendors.members.invalidate({ vendorId }); toast.success(t("admin.saved")); };
  /* The server's own reason — "the only owner" is something to act on, and
     reporting every refusal as "not allowed" hid it. */
  const fail = (error: { message: string }) => toast.error(tError(error.message));
  const setRole = trpc.inventory.vendors.setMemberRole.useMutation({ onSuccess: done, onError: fail });
  const remove = trpc.inventory.vendors.removeMember.useMutation({
    onSuccess: () => { setRemoving(null); done(); },
    onError: error => { setRemoving(null); fail(error); },
  });

  const mayManage = can(actor, "vendor.manageMembers", vendorId);

  /* An administrator belongs to no store, so this page has nobody to list for
     them. It used to say so with the sentence meant for a shopper who has not
     been added anywhere — and with no heading at all. Each store's people are
     on its own page, so that is where this points. */
  if (vendorId === 0) {
    return (
      <>
        <PageHeader title={t("admin.team")} />
        <Notice action={<Link href="/admin/vendors" className={smallButtonClass.secondary}>{t("admin.vendors")}</Link>}>
          {t("admin.teamAdminNote")}
        </Notice>
      </>
    );
  }

  const rows = members.data ?? [];

  return (
    <>
      <PageHeader title={t("admin.teamTitle")} description={t("admin.teamIntro")} />

      {members.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[members]}>
          {() => rows.length === 0 ? (
            <EmptyState title={t("admin.noMembers")} />
          ) : (
            <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
              {rows.map(member => {
                const self = member.userId === actor.userId;
                return (
                  <li key={member.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-[14px] font-bold text-[#0a285a]">
                        <bdi>{member.name || member.email}</bdi>
                        {self ? <span className="ms-2 text-[12px] font-semibold ink-muted">{t("admin.you")}</span> : null}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] ink-muted"><bdi dir="ltr">{member.email}</bdi></p>
                    </div>
                    {mayManage ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={member.role}
                          onChange={event => setRole.mutate({ vendorId, userId: member.userId, role: event.target.value as VendorRole })}
                          aria-label={t("admin.memberRole")}
                          disabled={setRole.isPending}
                          className={`${fieldClass} h-9 w-auto text-[13px]`}
                        >
                          {VENDOR_ROLES.map(role => <option key={role} value={role}>{t(ROLE_LABEL[role])}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => setRemoving({ userId: member.userId, name: member.name || member.email })}
                          aria-label={`${t("admin.remove")}: ${member.name || member.email}`}
                          className={`${smallButtonClass.quietDanger} w-9 px-0`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <Pill tone="navy">{t(ROLE_LABEL[member.role as VendorRole])}</Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryGate>
      )}

      {/* What each rank actually means, next to where it is chosen. */}
      <div className="mt-6">
        <Card title={t("admin.rolesTitle")}>
          <ul className="space-y-3">
            {VENDOR_ROLES.map(role => (
              <li key={role} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="w-24 shrink-0 text-[14px] font-bold text-[#0a285a]">{t(ROLE_LABEL[role])}</span>
                <span className="text-[14px] leading-6 text-[#536b8c]">{t(ROLE_NOTE[role])}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={t("admin.removeMemberTitle", { name: isolate(removing?.name ?? "") })}
        body={t("admin.removeMemberBody")}
        confirmLabel={t("admin.removeMember")}
        tone="danger"
        icon={<UserMinus className="size-5" aria-hidden />}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ vendorId, userId: removing.userId })}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
