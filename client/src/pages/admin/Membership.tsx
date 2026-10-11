/**
 * NetLet membership (4.1), NetLet's desk.
 *
 * What the programme is costing this month, its one setting, and the grants.
 * Until payments exist granting is the only way in, and the page says so
 * rather than looking like a shop with no customers.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, PageHeader, Pill, Segmented, smallButtonClass, Stat, StatGrid } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_GRANT_MONTHS, MAX_GRANT_NOTE } from "@shared/commerce/membership";
import { privatePageMeta } from "@shared/seo";

const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

export default function AdminMembership() {
  usePageMeta(privatePageMeta("Membership"));
  return <AdminShell need="membership.manage">{() => <Desk />}</AdminShell>;
}

function Desk() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("membership.title")} description={t("membership.adminNote")} />
      <div className="space-y-5">
        <Report />
        <div className="grid gap-5 lg:grid-cols-2">
          <Grant />
          <Terms />
        </div>
        <Grants />
      </div>
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
        <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
          <Stat label={t("membership.reportMembers")} value={<bdi>{report.data!.members}</bdi>} />
          <Stat label={t("membership.reportOrders")} value={<bdi>{report.data!.orders}</bdi>} />
          <Stat label={t("membership.reportWaived")} value={<bdi>{money(report.data!.waived)}</bdi>} />
        </StatGrid>
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
  const value = draft ?? terms.data?.freeDeliveryOver ?? "";
  const ok = value.trim() === "" || AMOUNT.test(value.trim());
  return (
    <form onSubmit={event => { event.preventDefault(); if (ok) save.mutate({ freeDeliveryOver: value.trim() || null }); }}>
      <Card
        title={t("membership.termsTitle")}
        footer={<button type="submit" disabled={!ok || save.isPending || draft === null || !terms.data} className={buttonClass.primary}>{t("admin.save")}</button>}
      >
        <QueryGate queries={[terms]}>
          {() => (
            <Field label={t("membership.freeOverLabel")} hint={t("membership.freeOverHint")} error={ok ? undefined : t("offers.badAmount")}>
              <input dir="ltr" inputMode="decimal" placeholder="0.000" value={value} onChange={event => setDraft(event.target.value)} className={`${fieldClass} max-w-xs`} />
            </Field>
          )}
        </QueryGate>
      </Card>
    </form>
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
    <form onSubmit={event => { event.preventDefault(); if (email.trim()) grant.mutate({ email, months, note: note || null }); }}>
      <Card
        title={t("membership.grantTitle")}
        description={t("membership.grantNote")}
        footer={<button type="submit" disabled={!email.trim() || grant.isPending} className={buttonClass.primary}>{t("membership.grant")}</button>}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label={t("membership.email")}>
            <input dir="ltr" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("membership.months")}>
            <select value={months} onChange={event => setMonths(Number(event.target.value))} className={fieldClass}>
              {Array.from({ length: MAX_GRANT_MONTHS }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}
            </select>
          </Field>
          <Field label={t("membership.why")} optional className="sm:col-span-2">
            <input dir="auto" maxLength={MAX_GRANT_NOTE} value={note} onChange={event => setNote(event.target.value)} className={fieldClass} />
          </Field>
        </div>
      </Card>
    </form>
  );
}

function Grants() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [current, setCurrent] = useState<"current" | "all">("current");
  const [page, setPage] = useState(1);
  const list = trpc.membership.list.useQuery({ current: current === "current", page }, { placeholderData: previous => previous });
  const [ending, setEnding] = useState<{ id: number; email: string } | null>(null);
  const end = trpc.membership.end.useMutation({
    onSuccess: () => { setEnding(null); toast.success(t("membership.ended")); void utils.membership.list.invalidate(); void utils.membership.report.invalidate(); },
    onError: error => { setEnding(null); toast.error(tError(error.message)); },
  });
  const now = new Date();
  return (
    <Card title={t("membership.grantsTitle")}>
      <Segmented
        label={t("membership.grantsTitle")}
        className="mb-4 w-fit"
        value={current}
        onChange={value => { setCurrent(value); setPage(1); }}
        options={[{ value: "current", label: t("membership.filterCurrent") }, { value: "all", label: t("support.filterAll") }]}
      />
      <QueryGate queries={[list]}>
        {() => {
          const result = list.data!;
          if (result.rows.length === 0) return <EmptyState title={t("membership.none")} />;
          return (
            <>
              <ul className="divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                {result.rows.map(row => {
                  const state = row.cancelledAt ? "ended" : row.active ? "active" : new Date(row.startsAt) > now ? "queued" : "over";
                  return (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-[#0a285a]"><bdi dir="ltr">{row.email}</bdi></p>
                        <p className="mt-0.5 text-[13px] ink-muted">{t("membership.span", { from: formatDate(row.startsAt), to: formatDate(row.endsAt) })}</p>
                        {row.note ? <p dir="auto" className="mt-0.5 text-[13px] text-[#3d5376]">{row.note}</p> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Pill tone={state === "active" ? "good" : state === "queued" ? "navy" : "neutral"}>
                          {t(state === "ended" ? "membership.statusEnded" : state === "active" ? "membership.statusActive" : state === "queued" ? "membership.statusQueued" : "membership.statusOver")}
                        </Pill>
                        {!row.cancelledAt && new Date(row.endsAt) > now ? (
                          <button type="button" onClick={() => setEnding({ id: row.id, email: row.email })} className={smallButtonClass.quietDanger}>{t("membership.end")}</button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pager page={result} onPage={setPage} />
            </>
          );
        }}
      </QueryGate>
      <ConfirmDialog
        open={ending !== null}
        title={t("membership.endTitle", { email: isolate(ending?.email ?? "") })}
        body={t("membership.endBody")}
        confirmLabel={t("membership.end")}
        tone="danger"
        pending={end.isPending}
        onConfirm={() => ending && end.mutate({ id: ending.id })}
        onClose={() => setEnding(null)}
      />
    </Card>
  );
}
