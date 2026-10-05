/**
 * NetLet membership (4.1), NetLet's desk.
 *
 * What the programme is costing this month, its one setting, and the grants.
 * Until payments exist granting is the only way in, and the page says so
 * rather than looking like a shop with no customers.
 */
import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_GRANT_MONTHS, MAX_GRANT_NOTE } from "@shared/commerce/membership";
import { privatePageMeta } from "@shared/seo";

const field = "glass-field mt-1 w-full rounded-xl px-3 py-2 text-[13px] font-normal text-[#0a285a] outline-none";
const card = "rounded-2xl border border-[#e6e9ef] bg-white p-4 text-[#0a285a]";
const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

export default function AdminMembership() {
  usePageMeta(privatePageMeta("Membership"));
  return <AdminShell need="membership.manage">{() => <Desk />}</AdminShell>;
}

function Desk() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="flex items-center gap-2 text-xl font-extrabold"><BadgeCheck className="size-5" aria-hidden />{t("membership.title")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 ink-muted">{t("membership.adminNote")}</p>
      <Report />
      <Terms />
      <Grant />
      <Grants />
    </>
  );
}

function Report() {
  const { t } = useTranslation();
  const money = useMoney();
  const report = trpc.membership.report.useQuery();
  return (
    <QueryGate queries={[report]}>
      {() => (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {([
            ["membership.reportMembers", String(report.data!.members)],
            ["membership.reportOrders", String(report.data!.orders)],
            ["membership.reportWaived", money(report.data!.waived)],
          ] as const).map(([label, value]) => (
            <div key={label} className={card}>
              <dt className="text-[11px] font-extrabold ink-muted">{t(label)}</dt>
              <dd className="mt-1 text-xl font-extrabold"><bdi>{value}</bdi></dd>
            </div>
          ))}
        </dl>
      )}
    </QueryGate>
  );
}

function Terms() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const terms = trpc.membership.terms.useQuery();
  const [draft, setDraft] = useState<string | null>(null);
  const save = trpc.membership.setTerms.useMutation({
    onSuccess: () => { toast.success(t("admin.saved")); setDraft(null); void utils.membership.terms.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });
  return (
    <QueryGate queries={[terms]}>
      {() => {
        const value = draft ?? terms.data!.freeDeliveryOver ?? "";
        const ok = value.trim() === "" || AMOUNT.test(value.trim());
        return (
          <form className={`${card} mt-5`} onSubmit={event => { event.preventDefault(); if (ok) save.mutate({ freeDeliveryOver: value.trim() || null }); }}>
            <h2 className="text-[14px] font-extrabold">{t("membership.termsTitle")}</h2>
            <label className="mt-2 block max-w-xs text-[12px] font-bold ink-muted">
              {t("membership.freeOverLabel")}
              <input dir="ltr" inputMode="decimal" value={value} aria-invalid={!ok} aria-describedby="free-over-hint" onChange={event => setDraft(event.target.value)} className={field} />
            </label>
            <p id="free-over-hint" className="mt-1 text-[11px] ink-muted">{t("membership.freeOverHint")}</p>
            <button type="submit" disabled={!ok || save.isPending} className="glass-navy pressable type-control mt-3 rounded-full px-5 py-2 disabled:opacity-50">{t("admin.save")}</button>
          </form>
        );
      }}
    </QueryGate>
  );
}

function Grant() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [months, setMonths] = useState(3);
  const [note, setNote] = useState("");
  const grant = trpc.membership.grant.useMutation({
    onSuccess: row => {
      toast.success(t("membership.granted", { until: formatDate(row.endsAt) }));
      setEmail(""); setNote("");
      void utils.membership.list.invalidate(); void utils.membership.report.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  return (
    <form className={`${card} mt-5`} onSubmit={event => { event.preventDefault(); if (email.trim()) grant.mutate({ email, months, note: note || null }); }}>
      <h2 className="text-[14px] font-extrabold">{t("membership.grantTitle")}</h2>
      <p className="mt-1 text-[12px] leading-5 ink-muted">{t("membership.grantNote")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] font-bold ink-muted">{t("membership.email")}<input dir="ltr" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} className={field} /></label>
        <label className="text-[12px] font-bold ink-muted">
          {t("membership.months")}
          <select value={months} onChange={event => setMonths(Number(event.target.value))} className={field}>
            {Array.from({ length: MAX_GRANT_MONTHS }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <label className="text-[12px] font-bold ink-muted">{t("membership.why")}<input dir="auto" maxLength={MAX_GRANT_NOTE} value={note} onChange={event => setNote(event.target.value)} className={field} /></label>
      </div>
      <button type="submit" disabled={!email.trim() || grant.isPending} className="glass-navy pressable type-control mt-3 rounded-full px-5 py-2 disabled:opacity-50">{t("membership.grant")}</button>
    </form>
  );
}

function Grants() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [current, setCurrent] = useState(true);
  const [page, setPage] = useState(1);
  const list = trpc.membership.list.useQuery({ current, page }, { placeholderData: previous => previous });
  const [ending, setEnding] = useState<{ id: number; email: string } | null>(null);
  const end = trpc.membership.end.useMutation({
    onSuccess: () => { setEnding(null); toast.success(t("membership.ended")); void utils.membership.list.invalidate(); void utils.membership.report.invalidate(); },
    onError: error => { setEnding(null); toast.error(tError(error.message)); },
  });
  return (
    <section className={`${card} mt-5`} aria-labelledby="grants-title">
      <h2 id="grants-title" className="text-[14px] font-extrabold">{t("membership.grantsTitle")}</h2>
      <div role="tablist" aria-label={t("membership.grantsTitle")} className="mt-3 inline-flex gap-1 rounded-2xl bg-[#eef1f6] p-1">
        {([true, false] as const).map(entry => (
          <button key={String(entry)} type="button" role="tab" aria-selected={current === entry} onClick={() => { setCurrent(entry); setPage(1); }} className={`rounded-xl px-3 py-1.5 text-[12px] font-extrabold ${current === entry ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c]"}`}>
            {t(entry ? "membership.filterCurrent" : "support.filterAll")}
          </button>
        ))}
      </div>
      <QueryGate queries={[list]}>
        {() => {
          const result = list.data!;
          if (result.rows.length === 0) return <p className="mt-3 text-[12px] ink-muted">{t("membership.none")}</p>;
          return (
            <>
              <ul className="mt-3 space-y-2">
                {result.rows.map(row => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
                    <span className="min-w-0">
                      <bdi dir="ltr" className="font-bold">{row.email}</bdi>
                      <span className="ink-muted"> · {t("membership.span", { from: formatDate(row.startsAt), to: formatDate(row.endsAt) })}</span>
                      {row.note ? <span dir="auto" className="block ink-muted">{row.note}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold">
                        {t(row.cancelledAt ? "membership.statusEnded" : row.active ? "membership.statusActive" : new Date(row.startsAt) > new Date() ? "membership.statusQueued" : "membership.statusOver")}
                      </span>
                      {!row.cancelledAt && new Date(row.endsAt) > new Date() ? (
                        <button type="button" onClick={() => setEnding({ id: row.id, email: row.email })} className="glass pressable type-control rounded-full px-3 py-1.5">{t("membership.end")}</button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Pager page={result} onPage={setPage} /></div>
            </>
          );
        }}
      </QueryGate>
      <ConfirmDialog
        open={ending !== null}
        title={t("membership.endTitle", { email: ending?.email ?? "" })}
        body={t("membership.endBody")}
        confirmLabel={t("membership.end")}
        tone="danger"
        pending={end.isPending}
        onConfirm={() => ending && end.mutate({ id: ending.id })}
        onClose={() => setEnding(null)}
      />
    </section>
  );
}
