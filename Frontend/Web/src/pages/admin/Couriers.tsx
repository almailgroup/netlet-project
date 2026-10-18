/**
 * The delivery companies NetLet works with.
 *
 * Requirement 2.2's missing party needs two things before it has an interface
 * at all: a record of the company, and a login for its people. This page is
 * both, and it is separate from the board for the reason `/admin/vendors` is
 * separate from everything a store does — one Save across a page writes a
 * suspension somebody made while fixing a phone number.
 *
 * **This does not replace a seller's own carrier name.** `vendors.delivery_provider`
 * is free text on purpose, because a fixed list would be this codebase
 * asserting which companies exist in Kuwait. What is recorded here is the
 * separate fact that NetLet has an arrangement with a named company and has
 * given its staff accounts.
 *
 * **Attaching a login needs `platform.manageUsers` as well.** Giving somebody
 * an account that reaches a NetLet interface is administering NetLet — the same
 * line a vendor owner cannot cross when they add their own people.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, PageHeader, Pill, SkeletonCards, smallButtonClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { Building2, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AdminCouriers() {
  usePageMeta(privatePageMeta("Delivery companies"));
  return <AdminShell need="delivery.assign">{actor => <Couriers actor={actor} />}</AdminShell>;
}

function Couriers({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const list = trpc.dispatch.couriers.list.useQuery();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState({ name: "", nameAr: "", contactPhone: "", contactEmail: "" });
  const [suspending, setSuspending] = useState<{ id: number; name: string } | null>(null);

  const refresh = () => void utils.dispatch.couriers.list.invalidate();
  const refused = (error: { message: string }) => toast.error(tError(error.message));

  const create = trpc.dispatch.couriers.create.useMutation({
    onSuccess: () => {
      toast.success(t("dispatch.created"));
      setDraft({ name: "", nameAr: "", contactPhone: "", contactEmail: "" });
      refresh();
    },
    onError: refused,
  });
  const setStatus = trpc.dispatch.couriers.setStatus.useMutation({
    onSuccess: () => { setSuspending(null); refresh(); },
    onError: error => { setSuspending(null); refused(error); },
  });

  const mayMintLogins = can(actor, "platform.manageUsers");

  return (
    <>
      <PageHeader title={t("admin.couriers")} description={t("admin.couriersNote")} />

      {list.isLoading ? (
        <SkeletonCards count={2} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => (list.data ?? []).length === 0 ? (
            <EmptyState title={t("dispatch.noCompanies")} />
          ) : (
            <ul className="space-y-4">
              {(list.data ?? []).map(company => (
                <li key={company.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]"><Building2 className="size-5" aria-hidden /></span>
                      <div className="min-w-0">
                        {/* A heading, so each company's logins below sit under
                            something: it went straight from the page's h1 to an h3. */}
                        <h2 className="text-[16px] font-bold text-[#0a285a]">
                          <span dir="auto">{company.name}</span>
                          {company.nameAr ? <span className="font-semibold ink-muted" dir="auto"> · {company.nameAr}</span> : null}
                        </h2>
                        {company.contactPhone || company.contactEmail ? (
                          <p className="mt-0.5 text-[13px] text-[#536b8c]">
                            {[company.contactPhone, company.contactEmail].filter(Boolean).map((part, index) => (
                              <span key={index}>
                                {index > 0 ? " · " : null}
                                {/* Latin values on an Arabic page: isolated, never given
                                    the block a direction of their own. */}
                                <bdi dir="ltr">{part}</bdi>
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={company.status === "active" ? "good" : "danger"}>
                        {t(company.status === "active" ? "dispatch.statusActive" : "dispatch.statusSuspended")}
                      </Pill>
                      <button
                        type="button"
                        disabled={setStatus.isPending}
                        onClick={() => company.status === "active"
                          ? setSuspending({ id: company.id, name: company.name })
                          : setStatus.mutate({ courierId: company.id, status: "active" })}
                        className={company.status === "active" ? smallButtonClass.quietDanger : smallButtonClass.secondary}
                      >
                        {t(company.status === "active" ? "dispatch.suspend" : "dispatch.restore")}
                      </button>
                    </div>
                  </div>

                  {mayMintLogins ? <Members courierId={company.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </QueryGate>
      )}

      <form
        className="mt-6"
        onSubmit={event => {
          event.preventDefault();
          if (draft.name.trim()) {
            create.mutate({
              name: draft.name.trim(),
              nameAr: draft.nameAr.trim() || null,
              contactPhone: draft.contactPhone.trim() || null,
              contactEmail: draft.contactEmail.trim() || null,
            });
          }
        }}
      >
        <Card
          title={t("dispatch.newCourier")}
          footer={
            <button type="submit" disabled={!draft.name.trim() || create.isPending} className={buttonClass.primary}>
              <Plus className="size-4" aria-hidden />{t("dispatch.create")}
            </button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dispatch.companyName")}>
              <input dir="auto" value={draft.name} maxLength={200} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className={fieldClass} />
            </Field>
            <Field label={t("dispatch.companyNameAr")} optional>
              <input dir="rtl" lang="ar" value={draft.nameAr} maxLength={200} onChange={e => setDraft(d => ({ ...d, nameAr: e.target.value }))} className={fieldClass} />
            </Field>
            <Field label={t("dispatch.companyPhone")} optional>
              <input value={draft.contactPhone} dir="ltr" inputMode="tel" onChange={e => setDraft(d => ({ ...d, contactPhone: e.target.value }))} className={fieldClass} />
            </Field>
            <Field label={t("dispatch.companyEmail")} optional>
              <input value={draft.contactEmail} dir="ltr" type="email" onChange={e => setDraft(d => ({ ...d, contactEmail: e.target.value }))} className={fieldClass} />
            </Field>
          </div>
        </Card>
      </form>

      <ConfirmDialog
        open={suspending !== null}
        title={t("dispatch.suspendTitle", { name: isolate(suspending?.name ?? "") })}
        body={t("dispatch.suspendBody")}
        confirmLabel={t("dispatch.suspend")}
        tone="danger"
        pending={setStatus.isPending}
        onConfirm={() => suspending && setStatus.mutate({ courierId: suspending.id, status: "suspended" })}
        onClose={() => setSuspending(null)}
      />
    </>
  );
}

/**
 * The logins on one company, by name and address, attached by the address the
 * person registered with.
 */
function Members({ courierId }: { courierId: number }) {
  const { t, tError } = useTranslation();
  const members = trpc.dispatch.couriers.members.useQuery({ courierId });
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<{ userId: number; name: string } | null>(null);

  const refresh = () => void utils.dispatch.couriers.members.invalidate({ courierId });
  const refused = (error: { message: string }) => toast.error(tError(error.message));

  const add = trpc.dispatch.couriers.addMember.useMutation({
    onSuccess: () => { toast.success(t("dispatch.memberAdded")); setEmail(""); refresh(); },
    onError: refused,
  });
  const remove = trpc.dispatch.couriers.removeMember.useMutation({
    onSuccess: () => { setRemoving(null); toast.success(t("dispatch.memberRemoved")); refresh(); },
    onError: error => { setRemoving(null); refused(error); },
  });

  const rows = members.data ?? [];
  const inputId = `courier-${courierId}-email`;

  return (
    <div className="mt-4 border-t border-[#eef1f5] pt-4">
      <h3 className="text-[14px] font-bold text-[#0a285a]">{t("dispatch.members")}</h3>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-[13px] ink-muted">{t("dispatch.noMembers")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
          {rows.map(row => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                {row.name ? <p dir="auto" className="truncate text-[14px] font-semibold text-[#0a285a]">{row.name}</p> : null}
                <p className="truncate text-[13px] ink-muted"><bdi dir="ltr">{row.email}</bdi></p>
              </div>
              <button
                type="button"
                aria-label={t("dispatch.removeMember", { id: isolate(row.name || row.email) })}
                disabled={remove.isPending}
                onClick={() => setRemoving({ userId: row.userId, name: row.name || row.email })}
                className={`${smallButtonClass.quietDanger} w-9 px-0`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={event => {
          event.preventDefault();
          if (email.trim()) add.mutate({ courierId, email: email.trim() });
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={inputId} className="block text-[13px] font-semibold text-[#0a285a]">{t("dispatch.memberId")}</label>
          <input id={inputId} type="email" value={email} dir="ltr" aria-describedby={`${inputId}-hint`} onChange={event => setEmail(event.target.value)} className={`${fieldClass} mt-1.5`} />
        </div>
        <button type="submit" disabled={!email.trim() || add.isPending} className={buttonClass.secondary}>
          <UserPlus className="size-4" aria-hidden />{t("dispatch.addMember")}
        </button>
        <p id={`${inputId}-hint`} className="basis-full text-[12px] ink-muted">{t("dispatch.addMemberNote")}</p>
      </form>

      <ConfirmDialog
        open={removing !== null}
        title={t("dispatch.removeMemberTitle", { name: isolate(removing?.name ?? "") })}
        body={t("dispatch.removeMemberBody")}
        confirmLabel={t("admin.removeMember")}
        tone="danger"
        icon={<UserMinus className="size-5" aria-hidden />}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ courierId, userId: removing.userId })}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
