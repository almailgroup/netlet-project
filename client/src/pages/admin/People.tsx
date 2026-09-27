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
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { VENDOR_ROLES, type VendorRole } from "@shared/inventory/permissions";
import { ShieldCheck, ShieldOff, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AdminPeople() {
  usePageMeta(privatePageMeta("People"));
  return <AdminShell need={"platform.manageUsers"}>{() => <People />}</AdminShell>;
}

const field = "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

const ROLE_LABEL: Record<VendorRole, MessageKey> = {
  staff: "admin.roleStaff",
  manager: "admin.roleManager",
  owner: "admin.roleOwner",
};

/**
 * A date the way an administrator reads one.
 *
 * Day precision: the question is "recently or long ago", and a timestamp to
 * the second is noise on that question. `ar-KW-u-ca-gregory-nu-latn` keeps the
 * Gregorian calendar and Western digits, matching how prices are rendered —
 * Hijri dates on an audit line would be a different reading of "when".
 */
const DATE_LOCALE = { en: "en-GB", ar: "ar-KW-u-ca-gregory-nu-latn" } as const;

function onDay(value: Date | string, locale: "en" | "ar"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function People() {
  const { t, locale } = useTranslation();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
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
   * The server sends a message key for the three refusals a person can act on
   * — "no such account", "you cannot demote yourself", "this is the last
   * administrator". Anything else is a fault, and gets the generic line
   * rather than a raw error string in front of a user.
   */
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));

  const setAdmin = trpc.inventory.people.setAdmin.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const addToVendor = trpc.inventory.people.addToVendor.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const removeFromVendor = trpc.inventory.people.removeFromVendor.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });

  const rows = people.data?.rows ?? [];
  const vendorRows = vendors.data?.rows ?? [];

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.people")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.adminNote")}</p>

      <AddToVendor
        vendors={vendorRows}
        pending={addToVendor.isPending}
        onAdd={(vendorId, email, role) => addToVendor.mutate({ vendorId, email, role })}
      />

      <label className="mt-6 block">
        <span className="sr-only">{t("admin.searchPeople")}</span>
        <input
          dir="auto"
          value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }}
          placeholder={t("admin.searchPeople")}
          className={`${field} max-w-md`}
        />
      </label>

      {people.isLoading || people.isError ? (
        <div className="mt-5"><QueryGate queries={[people]}>{() => null}</QueryGate></div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.noPeople")}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map(person => (
            <article key={person.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[#0a285a]"><bdi>{person.name || person.email}</bdi></p>
                  {/* An address is an address in any language — isolated so it
                      reads left-to-right, inside a line that still takes the
                      page's side. */}
                  <p className="mt-0.5 truncate text-[11px] ink-muted"><bdi dir="ltr">{person.email}</bdi></p>
                </div>

                {person.role === "admin" ? (
                  <button
                    onClick={() => setAdmin.mutate({ userId: person.id, isAdmin: false })}
                    disabled={setAdmin.isPending}
                    className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    <ShieldOff className="size-3.5" />{t("admin.revokeAdmin")}
                  </button>
                ) : (
                  <button
                    onClick={() => setAdmin.mutate({ userId: person.id, isAdmin: true })}
                    disabled={setAdmin.isPending}
                    className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    <ShieldCheck className="size-3.5" />{t("admin.makeAdmin")}
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e6e9ef] pt-3">
                {person.role === "admin" ? (
                  <span className="rounded-full bg-[#0a285a] px-2.5 py-1 text-[10px] font-extrabold text-white">
                    {t("admin.isAdmin")}
                  </span>
                ) : null}

                <span className="text-[11px] font-extrabold text-[#536b8c]">{t("admin.memberOf")}</span>
                {person.vendors.length === 0 ? (
                  <span className="text-[11px] ink-muted">{t("admin.noVendorMemberships")}</span>
                ) : (
                  person.vendors.map(membership => (
                    <span
                      key={`${membership.vendorId}-${person.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#e7edf5] px-2.5 py-1 text-[10px] font-extrabold text-[#0a285a]"
                    >
                      <span dir="auto">{membership.vendorName}</span>
                      <span className="text-[#536b8c]">{t(ROLE_LABEL[membership.role as VendorRole])}</span>
                      <button
                        onClick={() => removeFromVendor.mutate({ vendorId: membership.vendorId, userId: person.id })}
                        aria-label={t("admin.removeFrom", { vendor: membership.vendorName })}
                        className="tap-target ink-muted hover:text-[#a44a2b]"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* When an account appeared, and whether it is in use. An
                  administrator granting access wants to know they are looking
                  at the colleague who just registered, not a dormant account
                  with a similar name. */}
              <p className="mt-2 flex flex-wrap gap-x-4 text-[10px] ink-muted">
                <span>{t("admin.joined")} <time dir="ltr" dateTime={asIso(person.createdAt)}>{onDay(person.createdAt, locale)}</time></span>
                <span>{t("admin.lastSeen")} <time dir="ltr" dateTime={asIso(person.lastSignedIn)}>{onDay(person.lastSignedIn, locale)}</time></span>
              </p>
            </article>
          ))}
          {people.data ? <Pager page={people.data} onPage={setPage} /> : null}
        </div>
      )}
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
    <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h2 className="text-sm font-extrabold">{t("admin.addToVendor")}</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
        <input
          dir="ltr"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder={t("admin.emailPlaceholder")}
          className={field}
        />
        {/* Both carry a name of their own, because neither sits in a label:
            this row is four controls side by side under one heading, and a
            heading names a section rather than a field. Without these the
            store and the rank are two unnamed comboboxes — nothing for a
            screen reader to read out, and nothing to say by voice. */}
        <select
          aria-label={t("admin.productVendor")}
          value={vendorId}
          onChange={event => setVendorId(event.target.value)}
          className={`${field} sm:w-44`}
        >
          <option value="">{t("admin.fieldNoCategory")}</option>
          {vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
        <select
          aria-label={t("admin.memberRole")}
          value={role}
          onChange={event => setRole(event.target.value as VendorRole)}
          className={`${field} sm:w-36`}
        >
          {VENDOR_ROLES.map(entry => <option key={entry} value={entry}>{t(ROLE_LABEL[entry])}</option>)}
        </select>
        <button
          onClick={() => { if (vendorId && email.trim()) onAdd(Number(vendorId), email.trim(), role); }}
          disabled={pending || !vendorId || !email.trim()}
          className="glass glass-accent pressable inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-xs font-extrabold disabled:opacity-50"
        >
          <UserPlus className="size-4" />{t("admin.addMember")}
        </button>
      </div>
    </section>
  );
}
