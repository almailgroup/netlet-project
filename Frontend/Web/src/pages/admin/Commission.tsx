/**
 * The commission desk (3.3.2, 3.3.9): stores' proposals waiting for an
 * answer, and every store's rate.
 *
 * Open to an administrator, and to an employee an administrator granted
 * `vendor.setCommission` and nothing else — which is why it is its own page
 * rather than a section of a store's: that employee sees each store's rate and
 * not its IBAN, contacts or team. Every change goes through the audited door
 * any commission edit takes, and the trail names who granted the employee the
 * right to make it.
 */
import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, fieldClass, isolate, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass, tableClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_DECISION_NOTE } from "@shared/inventory/commissionProposals";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

const STATUS: Record<string, { label: MessageKey; tone: "warning" | "good" | "danger" | "neutral" }> = {
  pending: { label: "commission.statusPending", tone: "warning" },
  accepted: { label: "commission.statusAccepted", tone: "good" },
  declined: { label: "commission.statusDeclined", tone: "danger" },
  withdrawn: { label: "commission.statusWithdrawn", tone: "neutral" },
};

export default function AdminCommission() {
  usePageMeta(privatePageMeta("Commission"));
  return <AdminShell need="vendor.setCommission">{() => <Desk />}</AdminShell>;
}

function Desk() {
  const { t } = useTranslation();
  const [view, setView] = useState<"waiting" | "decided">("waiting");
  return (
    <>
      <PageHeader title={t("commission.deskTitle")} description={t("commission.deskNote")} />
      <Segmented
        label={t("commission.deskTitle")}
        value={view}
        onChange={setView}
        options={[{ value: "waiting", label: t("commission.viewWaiting") }, { value: "decided", label: t("commission.viewDecided") }]}
      />
      <div className="mt-4"><Proposals waiting={view === "waiting"} /></div>
      <div className="mt-8"><StoreRates /></div>
    </>
  );
}

function Proposals({ waiting }: { waiting: boolean }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const list = trpc.commission.list.useQuery({ status: waiting ? "pending" : undefined, page }, { placeholderData: previous => previous });
  const [declining, setDeclining] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const decide = trpc.commission.decide.useMutation({
    onSuccess: row => {
      toast.success(t(row.status === "accepted" ? "commission.acceptedDone" : "commission.declinedDone"));
      setDeclining(null);
      setNote("");
      void utils.commission.list.invalidate();
      void utils.commission.stores.invalidate();
      void utils.commission.waiting.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const figure = (row: { percent: string | null; fixed: string | null }) =>
    row.percent !== null ? t("commission.figurePercent", { rate: String(Number(row.percent)) }) : t("commission.figureFixed", { amount: money({ amount: row.fixed ?? "0", currencyCode: "KWD" }) });
  const current = (row: { percent: string | null; fixed: string | null }) =>
    [row.percent !== null && Number(row.percent) > 0 ? t("commission.figurePercent", { rate: String(Number(row.percent)) }) : null,
      row.fixed !== null ? t("commission.figureFixed", { amount: money({ amount: row.fixed, currencyCode: "KWD" }) }) : null]
      .filter(Boolean).join(" + ") || t("commission.figurePercent", { rate: "0" });

  if (list.isLoading) return <SkeletonRows rows={3} label={t("admin.loading")} />;
  return (
    <QueryGate queries={[list]}>
      {() => {
        const rows = (list.data?.rows ?? []).filter(row => (waiting ? row.status === "pending" : row.status !== "pending"));
        if (!rows.length) return <EmptyState title={t(waiting ? "commission.noneWaiting" : "commission.noneDecided")} />;
        return (
          <>
            <ul className="space-y-3">
              {rows.map(row => (
                <li key={row.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-[#0a285a]">
                        {row.productTitle ? t("commission.forProduct", { product: isolate(row.productTitle), store: isolate(row.vendorName) }) : t("commission.forStore", { store: isolate(row.vendorName) })}
                      </p>
                      <p className="mt-0.5 text-[13px] ink-muted">{formatDate(row.createdAt)}</p>
                    </div>
                    <Pill tone={STATUS[row.status]?.tone ?? "neutral"}>{t(STATUS[row.status]?.label ?? "commission.statusPending")}</Pill>
                  </div>
                  <p className="mt-2 text-[14px] text-[#0a285a]">
                    {t("commission.asks", { figure: figure(row) })} <span className="ink-muted">· {t("commission.chargedNow", { figure: current(row.current) })}</span>
                  </p>
                  {row.reason ? <p dir="auto" className="mt-1 text-[13px] leading-5 text-[#3d5376]">“{row.reason}”</p> : null}
                  {row.decisionNote ? <p dir="auto" className="mt-1 text-[13px] ink-muted">{t("commission.noteWas", { note: row.decisionNote })}</p> : null}
                  {row.status === "pending" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ proposalId: row.id, accept: true })} className={smallButtonClass.primary}>
                        {decide.isPending && decide.variables?.proposalId === row.id && decide.variables.accept ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                        {t("commission.accept")}
                      </button>
                      <button type="button" disabled={decide.isPending} onClick={() => { setDeclining(row.id); setNote(""); }} className={smallButtonClass.quietDanger}>
                        <X className="size-4" aria-hidden />{t("commission.decline")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {list.data ? <Pager page={list.data} onPage={setPage} /> : null}
            <ConfirmDialog
              open={declining !== null}
              title={t("commission.declineTitle")}
              body={t("commission.declineBody")}
              confirmLabel={t("commission.decline")}
              tone="danger"
              pending={decide.isPending}
              confirmDisabled={!note.trim()}
              onClose={() => { setDeclining(null); setNote(""); }}
              onConfirm={() => declining !== null && decide.mutate({ proposalId: declining, accept: false, note: note.trim() })}
            >
              <label className="mt-3 block text-[13px] font-semibold text-[#0a285a]">
                {t("commission.declineNote")}
                <input dir="auto" value={note} maxLength={MAX_DECISION_NOTE} onChange={event => setNote(event.target.value)} className={`${fieldClass} mt-1.5`} />
              </label>
            </ConfirmDialog>
          </>
        );
      }}
    </QueryGate>
  );
}

/** Every store's rate, searched by name, each saved on its own. */
function StoreRates() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const stores = trpc.commission.stores.useQuery({ query: query.trim() || undefined, page }, { placeholderData: previous => previous });
  const [drafts, setDrafts] = useState<Record<number, { percent: string; fixed: string }>>({});
  const save = trpc.inventory.vendors.setCommission.useMutation({
    onSuccess: (_reply, input) => {
      toast.success(t("admin.saved"));
      setDrafts(current => { const next = { ...current }; delete next[input.vendorId]; return next; });
      void utils.commission.stores.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <Card title={t("commission.storesTitle")} description={t("commission.storesNote")}>
      <label className="block max-w-sm">
        <span className="sr-only">{t("commission.searchStores")}</span>
        <input dir="auto" value={query} placeholder={t("commission.searchStores")} onChange={event => { setQuery(event.target.value); setPage(1); }} className={fieldClass} />
      </label>
      <div className="mt-4">
        <QueryGate queries={[stores]}>
          {() => {
            const rows = stores.data?.rows ?? [];
            if (!rows.length) return <EmptyState title={t("admin.noVendors")} />;
            return (
              <>
                <div className={tableClass.wrap} role="region" aria-label={t("admin.vendors")} tabIndex={0}>
                  <table className={tableClass.table}>
                    <thead className={tableClass.head}>
                      <tr>
                        <th className={tableClass.th}>{t("admin.vendors")}</th>
                        <th className={tableClass.th}>{t("admin.commissionPercent")}</th>
                        <th className={tableClass.th}>{t("admin.commissionFixed")}</th>
                        <th className={tableClass.th}><span className="sr-only">{t("admin.save")}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => {
                        const draft = drafts[row.id] ?? { percent: String(Number(row.commissionPercent)), fixed: row.commissionFixed ?? "" };
                        const changed = Boolean(drafts[row.id]);
                        const set = (patch: Partial<typeof draft>) => setDrafts(current => ({ ...current, [row.id]: { ...draft, ...patch } }));
                        return (
                          <tr key={row.id} className="border-t border-[#eef1f5]">
                            <td className="px-4 py-2.5"><bdi className="font-semibold text-[#0a285a]">{row.name}</bdi></td>
                            <td className="px-4 py-2.5">
                              <input dir="ltr" inputMode="decimal" aria-label={`${t("admin.commissionPercent")}: ${row.name}`} value={draft.percent} onChange={event => set({ percent: event.target.value })} className={`${fieldClass} h-9 w-24`} />
                            </td>
                            <td className="px-4 py-2.5">
                              <input dir="ltr" inputMode="decimal" placeholder="0.000" aria-label={`${t("admin.commissionFixed")}: ${row.name}`} value={draft.fixed} onChange={event => set({ fixed: event.target.value })} className={`${fieldClass} h-9 w-28`} />
                            </td>
                            <td className="px-4 py-2.5 text-end">
                              <button
                                type="button"
                                disabled={!changed || save.isPending}
                                onClick={() => save.mutate({ vendorId: row.id, percent: draft.percent.trim() || "0", fixed: draft.fixed.trim() || null })}
                                className={buttonClass.secondary}
                              >
                                {t("admin.save")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {stores.data ? <Pager page={stores.data} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      </div>
    </Card>
  );
}
