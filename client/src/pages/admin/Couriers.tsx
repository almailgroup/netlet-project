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
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const field =
  "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

export default function AdminCouriers() {
  usePageMeta(privatePageMeta("Delivery companies"));
  return <AdminShell need="delivery.assign">{actor => <Couriers actor={actor} />}</AdminShell>;
}

function Couriers({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const list = trpc.dispatch.couriers.list.useQuery();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState({ name: "", nameAr: "", contactPhone: "", contactEmail: "" });

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
  const setStatus = trpc.dispatch.couriers.setStatus.useMutation({ onSuccess: refresh, onError: refused });

  const mayMintLogins = can(actor, "platform.manageUsers");

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.couriers")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.couriersNote")}</p>

      <QueryGate queries={[list]}>
        {() => (
          <ul className="mt-5 space-y-3">
            {(list.data ?? []).map(company => (
              <li key={company.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {/* A heading, so each company's "Members" below sits under
                      something: it went straight from the page's h1 to an h3. */}
                  <h2 className="flex items-center gap-1.5 text-base font-bold text-[#0a285a]">
                    <Building2 className="size-4 ink-accent" aria-hidden />
                    <span dir="auto">{company.name}</span>
                    {company.nameAr ? <span className="ink-muted" dir="auto"> · {company.nameAr}</span> : null}
                  </h2>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${
                      company.status === "active" ? "bg-[#e7f3e8] text-[#2f5d33]" : "bg-[#fdeceb] text-[#8c2f22]"
                    }`}
                  >
                    {t(company.status === "active" ? "dispatch.statusActive" : "dispatch.statusSuspended")}
                  </span>
                </div>

                <p className="mt-1 text-[12px] text-[#536b8c]">
                  {[company.contactPhone, company.contactEmail].filter(Boolean).map((part, index) => (
                    <span key={index}>
                      {index > 0 ? " · " : null}
                      {/* Latin values on an Arabic page: isolated, never given
                          the block a direction of their own. */}
                      <bdi dir="ltr">{part}</bdi>
                    </span>
                  ))}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ courierId: company.id, status: company.status === "active" ? "suspended" : "active" })}
                    className="glass pressable rounded-full px-4 py-2 text-[12px] font-extrabold disabled:opacity-60"
                  >
                    {t(company.status === "active" ? "dispatch.suspend" : "dispatch.restore")}
                  </button>
                </div>

                {mayMintLogins ? <Members courierId={company.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </QueryGate>

      <form
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
        className="mt-6 rounded-2xl border border-[#e6e9ef] bg-white p-5"
      >
        <h2 className="text-[13px] font-extrabold text-[#0a285a]">{t("dispatch.newCourier")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("dispatch.companyName")}
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className={`${field} mt-1 font-normal`} />
          </label>
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("dispatch.companyNameAr")}
            <input value={draft.nameAr} onChange={e => setDraft(d => ({ ...d, nameAr: e.target.value }))} className={`${field} mt-1 font-normal`} />
          </label>
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("dispatch.companyPhone")}
            <input value={draft.contactPhone} dir="ltr" inputMode="tel" onChange={e => setDraft(d => ({ ...d, contactPhone: e.target.value }))} className={`${field} mt-1 font-normal`} />
          </label>
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("dispatch.companyEmail")}
            <input value={draft.contactEmail} dir="ltr" inputMode="email" onChange={e => setDraft(d => ({ ...d, contactEmail: e.target.value }))} className={`${field} mt-1 font-normal`} />
          </label>
        </div>
        <button
          type="submit"
          disabled={!draft.name.trim() || create.isPending}
          className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden /> {t("dispatch.create")}
        </button>
      </form>
    </>
  );
}

/**
 * The logins on one company.
 *
 * Attached by account id rather than by email, and the page says where to find
 * one. Looking an account up by address from here would be a way to ask which
 * addresses are registered — the thing sign-in, password reset and the wishlist
 * lookup all refuse to answer.
 */
function Members({ courierId }: { courierId: number }) {
  const { t, tError } = useTranslation();
  const members = trpc.dispatch.couriers.members.useQuery({ courierId });
  const utils = trpc.useUtils();
  const [userId, setUserId] = useState("");

  const refresh = () => void utils.dispatch.couriers.members.invalidate({ courierId });
  const refused = (error: { message: string }) => toast.error(tError(error.message));

  const add = trpc.dispatch.couriers.addMember.useMutation({
    onSuccess: () => { toast.success(t("dispatch.memberAdded")); setUserId(""); refresh(); },
    onError: refused,
  });
  const remove = trpc.dispatch.couriers.removeMember.useMutation({
    onSuccess: () => { toast.success(t("dispatch.memberRemoved")); refresh(); },
    onError: refused,
  });

  const rows = members.data ?? [];

  return (
    <div className="mt-4 border-t border-[#eef1f6] pt-3">
      <h3 className="text-[11px] font-extrabold tracking-[.1em] text-[#536b8c] uppercase">{t("dispatch.members")}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] ink-muted">{t("dispatch.noMembers")}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {rows.map(row => (
            <li key={row.id} className="inline-flex items-center gap-2 rounded-full bg-[#eef1f6] px-3 py-1 text-[12px] font-bold text-[#0a285a]">
              <bdi dir="ltr">#{row.userId}</bdi>
              <button
                type="button"
                aria-label={t("dispatch.removeMember", { id: String(row.userId) })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ courierId, userId: row.userId })}
                className="ink-muted hover:text-[#a44a2b] disabled:opacity-60"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] ink-muted">{t("dispatch.addMemberNote")}</p>
      <form
        onSubmit={event => {
          event.preventDefault();
          const id = Number(userId);
          if (Number.isInteger(id) && id > 0) add.mutate({ courierId, userId: id });
        }}
        className="mt-2 flex flex-wrap items-end gap-2"
      >
        <label className="text-[12px] font-bold text-[#536b8c]">
          {t("dispatch.memberId")}
          <input
            value={userId}
            dir="ltr"
            inputMode="numeric"
            onChange={event => setUserId(event.target.value)}
            className={`${field} mt-1 w-32 font-normal`}
          />
        </label>
        <button
          type="submit"
          disabled={!userId.trim() || add.isPending}
          className="glass pressable h-10 rounded-full px-4 text-[12px] font-extrabold disabled:opacity-50"
        >
          {t("dispatch.addMember")}
        </button>
      </form>
    </div>
  );
}
