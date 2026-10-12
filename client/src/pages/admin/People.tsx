/**
 * Who reaches the admin panel, and what they reach when they do.
 *
 * Two separate grants, deliberately not merged into one control:
 *
 * - **Administrator** is NetLet-wide. It clears every vendor, every product,
 *   commission, and this page.
 * - **Vendor membership** is one company, at one rank. A vendor owner runs
 *   their own team from Team; this page exists so an administrator can put
 *   the first person in a vendor, before there is an owner to do it.
 *
 * Everything here needs `platform.manageUsers`, which no vendor rank reaches
 * at any level — otherwise a vendor owner could promote themselves.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, PageHeader, Pill, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { Search, ShieldCheck, ShieldOff, UserMinus, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

export default function AdminPeople() {
  usePageMeta(privatePageMeta("People"));
  return <AdminShell need={"platform.manageUsers"}>{actor => <People selfId={actor.userId} />}</AdminShell>;
}

const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaff",
  manager: "admin.roleManager",
  owner: "admin.roleOwner",
};

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/* The two moves on this page that change who runs NetLet, or who may act for
   a store, each ask first: one press used to make somebody an administrator,
   which reaches every store, every payout and this page. */
type Pending =
  | { kind: "grant" | "revoke"; userId: number; name: string }
  | { kind: "remove"; userId: number; name: string; vendorId: number; vendor: string };

function People({ selfId }: { selfId: number }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState<Pending | null>(null);
  /*
   * This list is everyone with an account, shoppers included, so it is the one
   * that outgrew its old ceiling of a hundred first — and choosing who
   * administers NetLet from the hundred newest registrations is not a choice.
   */
  const people = trpc.inventory.people.list.useQuery(
    { query: query.trim() || undefined, page },
    { placeholderData: previous => previous },
  );
  // The picker wants every store, not a page of them.
  const vendors = trpc.inventory.vendors.list.useQuery({ pageSize: 200 });

  const refresh = () => void utils.inventory.people.list.invalidate();
  /*
   * The server sends a message key for the refusals a person can act on —
   * "no such account", "you cannot demote yourself", "this is the last
   * administrator", "the store's only owner". Anything else is a fault, and
   * gets the generic line rather than a raw error string in front of a user.
   */
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));
  const settle = { onSuccess: () => { setAsking(null); refresh(); toast.success(t("admin.saved")); }, onError: (error: { message: string }) => { setAsking(null); fail(error); } };

  const setAdmin = trpc.inventory.people.setAdmin.useMutation(settle);
  const addToVendor = trpc.inventory.people.addToVendor.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const removeFromVendor = trpc.inventory.people.removeFromVendor.useMutation(settle);

  const rows = people.data?.rows ?? [];
  const vendorRows = vendors.data?.rows ?? [];
  const busy = setAdmin.isPending || removeFromVendor.isPending;

  return (
    <>
      <PageHeader
        title={t("admin.people")}
        description={t("admin.adminNote")}
        meta={people.data ? <span className="font-semibold text-[#3d5376]">{t("admin.peopleCount", { count: people.data.total })}</span> : null}
      />

      <AddToVendor
        vendors={vendorRows}
        pending={addToVendor.isPending}
        onAdd={(vendorId, email, role) => addToVendor.mutate({ vendorId, email, role })}
      />

      <div className="relative mt-6 max-w-md">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#536b8c]" aria-hidden />
        <input
          type="search"
          dir="auto"
          value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }}
          aria-label={t("admin.searchPeople")}
          placeholder={t("admin.searchPeople")}
          className={`${fieldClass} ps-10`}
        />
      </div>

      <div className="mt-4">
        {people.isLoading ? (
          <SkeletonRows label={t("admin.loading")} />
        ) : people.isError ? (
          <QueryGate queries={[people]}>{() => null}</QueryGate>
        ) : rows.length === 0 ? (
          <EmptyState title={t("admin.noPeople")} />
        ) : (
          <>
            <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
              {rows.map(person => {
                const name = person.name || person.email;
                const self = person.id === selfId;
                return (
                  <li key={person.id} className="p-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0a285a]">
                          <bdi>{name}</bdi>
                          {person.role === "admin" ? <Pill tone="navy">{t("admin.isAdmin")}</Pill> : null}
                          {self ? <span className="text-[12px] font-semibold ink-muted">{t("admin.you")}</span> : null}
                        </p>
                        {/* An address is an address in any language — isolated so it
                            reads left-to-right, inside a line that still takes the
                            page's side. */}
                        <p className="mt-0.5 truncate text-[13px] ink-muted"><bdi dir="ltr">{person.email}</bdi></p>
                        {/* When an account appeared, and whether it is in use. An
                            administrator granting access wants to know they are looking
                            at the colleague who just registered, not a dormant account
                            with a similar name. */}
                        <p className="mt-1 flex flex-wrap gap-x-4 text-[12px] ink-muted">
                          <span>{t("admin.joined")} <time dateTime={asIso(person.createdAt)}>{formatDate(person.createdAt)}</time></span>
                          <span>{t("admin.lastSeen")} <time dateTime={asIso(person.lastSignedIn)}>{formatDate(person.lastSignedIn)}</time></span>
                        </p>
                      </div>

                      {person.role === "admin" ? (
                        <button
                          type="button"
                          onClick={() => setAsking({ kind: "revoke", userId: person.id, name })}
                          disabled={busy}
                          className={smallButtonClass.quietDanger}
                        >
                          <ShieldOff className="size-4" aria-hidden />{t("admin.revokeAdmin")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAsking({ kind: "grant", userId: person.id, name })}
                          disabled={busy}
                          className={smallButtonClass.secondary}
                        >
                          <ShieldCheck className="size-4" aria-hidden />{t("admin.makeAdmin")}
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-[#536b8c]">{t("admin.memberOf")}</span>
                      {person.vendors.length === 0 ? (
                        <span className="text-[13px] ink-muted">{t("admin.noVendorMemberships")}</span>
                      ) : (
                        person.vendors.map(membership => (
                          <span
                            key={`${membership.vendorId}-${person.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1e7ef] bg-[#f7f9fc] py-1 ps-2.5 pe-1 text-[13px] text-[#0a285a]"
                          >
                            <bdi className="font-semibold">{membership.vendorName}</bdi>
                            <span className="text-[#536b8c]">· {t(ROLE_LABEL[membership.role as VendorRole])}</span>
                            <button
                              type="button"
                              onClick={() => setAsking({ kind: "remove", userId: person.id, name, vendorId: membership.vendorId, vendor: membership.vendorName })}
                              aria-label={t("admin.removeFrom", { vendor: isolate(membership.vendorName) })}
                              disabled={busy}
                              className="grid size-7 place-items-center rounded-md text-[#536b8c] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
                            >
                              <X className="size-3.5" aria-hidden />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {people.data ? <Pager page={people.data} onPage={setPage} /> : null}
          </>
        )}
      </div>

      <ConfirmDialog
        open={asking !== null}
        title={
          asking?.kind === "grant" ? t("admin.makeAdminTitle", { name: isolate(asking.name) })
            : asking?.kind === "revoke" ? t("admin.revokeAdminTitle", { name: isolate(asking.name) })
            : asking?.kind === "remove" ? t("admin.removeFromTitle", { name: isolate(asking.name), vendor: isolate(asking.vendor) })
            : ""
        }
        body={
          asking?.kind === "grant" ? t("admin.makeAdminBody")
            : asking?.kind === "revoke" ? t("admin.revokeAdminBody")
            : t("admin.removeMemberBody")
        }
        confirmLabel={
          asking?.kind === "grant" ? t("admin.makeAdmin")
            : asking?.kind === "revoke" ? t("admin.revokeAdmin")
            : t("admin.removeMember")
        }
        tone={asking?.kind === "grant" ? "normal" : "danger"}
        icon={asking?.kind === "grant" ? <ShieldCheck className="size-5" aria-hidden /> : asking?.kind === "revoke" ? <ShieldOff className="size-5" aria-hidden /> : <UserMinus className="size-5" aria-hidden />}
        pending={busy}
        onConfirm={() => {
          if (!asking) return;
          if (asking.kind === "remove") removeFromVendor.mutate({ vendorId: asking.vendorId, userId: asking.userId });
          else setAdmin.mutate({ userId: asking.userId, isAdmin: asking.kind === "grant" });
        }}
        onClose={() => setAsking(null)}
      />
    </>
  );
}

/**
 * Add by email rather than by picking from the list above.
 *
 * The person you are adding is usually somebody who just registered and whom
 * you have not scrolled to — you know their address because they gave it to
 * you. An unknown address is refused rather than creating an account, since
 * an account with no password is one nobody can sign in to.
 */
function AddToVendor({ vendors, pending, onAdd }: {
  vendors: { id: number; name: string }[];
  pending: boolean;
  onAdd: (vendorId: number, email: string, role: VendorRole) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [role, setRole] = useState<VendorRole>("staff");

  if (!vendors.length) return null;

  return (
    <form onSubmit={event => { event.preventDefault(); if (vendorId && email.trim()) onAdd(Number(vendorId), email.trim(), role); }}>
      <Card
        title={t("admin.addToVendor")}
        footer={
          <button type="submit" disabled={pending || !vendorId || !email.trim()} className={buttonClass.primary}>
            <UserPlus className="size-4" aria-hidden />{t("admin.addMember")}
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <Field label={t("admin.emailAddress")}>
            <input dir="ltr" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder={t("admin.emailPlaceholder")} className={fieldClass} />
          </Field>
          <Field label={t("admin.newStore")}>
            <Select value={vendorId} onChange={event => setVendorId(event.target.value)} className={fieldClass}>
              <option value="" disabled>{t("admin.chooseStore")}</option>
              {vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </Select>
          </Field>
          <Field label={t("admin.memberRole")}>
            <Select value={role} onChange={event => setRole(event.target.value as VendorRole)} className={fieldClass}>
              {VENDOR_ROLES.map(entry => <option key={entry} value={entry}>{t(ROLE_LABEL[entry])}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
    </form>
  );
}
