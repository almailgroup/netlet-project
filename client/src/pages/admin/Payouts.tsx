/**
 * Payouts (3.3.21): what each seller is about to be paid, when the rest comes
 * due, and what has already been sent.
 *
 * One page for NetLet and for a store's manager, scoped by the server: an
 * administrator sees every seller's batch with the full account to send to and
 * records the transfer; a store sees its own, with the account masked, and
 * nothing to press — being told when money is coming is the store's half.
 *
 * Nobody assembles a batch. The schedule does: everything that has come due
 * and not been paid, less anything refunded after an earlier payout. Recording
 * asks first, because it is a statement that money left the bank.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { PayoutsDue } from "@/components/admin/PayoutsDue";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Batch = inferRouterOutputs<AppRouter>["finance"]["payoutBatches"][number];

export default function AdminPayouts() {
  usePageMeta(privatePageMeta("Payouts"));
  return <AdminShell need="payouts.view">{actor => <Payouts actor={actor} />}</AdminShell>;
}

function Payouts({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const batches = trpc.finance.payoutBatches.useQuery();
  const [page, setPage] = useState(1);
  const history = trpc.finance.payoutHistory.useQuery({ page }, { placeholderData: previous => previous });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.payoutsPage")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t(actor.kind === "admin" ? "admin.payoutsNoteAdmin" : "admin.payoutsNoteStore")}</p>

      <section className="mt-6" aria-labelledby="payouts-ready">
        <h2 id="payouts-ready" className="text-sm font-extrabold">{t("admin.payoutsReady")}</h2>
        <QueryGate queries={[batches]}>
          {() => (batches.data ?? []).length === 0
            ? <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] text-[#536b8c]">{t("admin.payoutsNothingReady")}</p>
            : <ul className="mt-3 space-y-3">{batches.data!.map(batch => <BatchCard key={batch.vendorId} batch={batch} canRecord={actor.kind === "admin"} />)}</ul>}
        </QueryGate>
      </section>

      <div className="mt-8"><PayoutsDue /></div>

      <section className="mt-8" aria-labelledby="payouts-history">
        <h2 id="payouts-history" className="text-sm font-extrabold">{t("admin.payoutsHistory")}</h2>
        <QueryGate queries={[history]}>
          {() => {
            const result = history.data;
            const rows = result?.rows ?? [];
            if (rows.length === 0) return <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] text-[#536b8c]">{t("admin.payoutsNoHistory")}</p>;
            return (
              <div className="mt-3 space-y-2">
                {rows.map(run => <HistoryRow key={run.id} run={run} />)}
                {result ? <Pager page={result} onPage={setPage} /> : null}
              </div>
            );
          }}
        </QueryGate>
      </section>
    </>
  );
}

function BatchCard({ batch, canRecord }: { batch: Batch; canRecord: boolean }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const utils = trpc.useUtils();
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const record = trpc.finance.recordPayout.useMutation({
    onSuccess: () => {
      setConfirming(false);
      setReference("");
      toast.success(t("admin.payoutRecorded", { name: batch.vendorName }));
      void utils.finance.payoutBatches.invalidate();
      void utils.finance.payoutHistory.invalidate();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });
  const fieldId = `payout-ref-${batch.vendorId}`;

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-extrabold"><bdi>{batch.vendorName}</bdi></p>
        <p className={`text-base font-extrabold ${batch.payable ? "text-[#0a285a]" : "text-[#8c2f22]"}`}><bdi dir="ltr">{amount(batch.total)}</bdi></p>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        {batch.iban ? <>{t("admin.payoutTo")} <bdi dir="ltr" className="font-mono">{batch.iban}</bdi></> : <span className="font-bold text-[#8c2f22]">{t("admin.payoutNoIban")}</span>}
      </p>
      {!batch.payable ? <p className="mt-1 text-[12px] font-bold text-[#8c2f22]">{t("admin.payoutOwedBack", { amount: amount(batch.total.replace(/^-/, "")) })}</p> : null}
      <ul className="mt-3 divide-y divide-[#f0f2f6] text-[12px]">
        {batch.lines.map(line => (
          /* By reference, which is unique within a batch: a placement fee has no
             order id to key on. */
          <li key={line.reference} className="flex justify-between gap-3 py-1.5">
            <span>
              <bdi dir="ltr">{line.reference}</bdi>
              {line.kind === "clawback" ? <span className="ms-2 font-bold text-[#8c2f22]">{t("admin.payoutClawback")}</span> : null}
              {line.kind === "fee" ? <span className="ms-2 font-bold text-[#536b8c]">{t(line.reference.startsWith("FF-") ? "fulfilment.packingFee" : "admin.payoutPlacementFee")}</span> : null}
            </span>
            <bdi dir="ltr" className="font-bold">{amount(line.amount)}</bdi>
          </li>
        ))}
      </ul>
      {canRecord && batch.payable ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setConfirming(true); }}>
          <label htmlFor={fieldId} className="block min-w-[200px] flex-1">
            <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.payoutReference")}</span>
            <input id={fieldId} value={reference} onChange={event => setReference(event.target.value)} maxLength={80} required dir="ltr" className="glass-field mt-1 h-10 w-full rounded-full px-4 text-sm" />
          </label>
          <button type="submit" disabled={!reference.trim() || record.isPending} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">{t("admin.payoutRecord")}</button>
        </form>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t("admin.payoutConfirmTitle", { amount: amount(batch.total), name: batch.vendorName })}
        body={t("admin.payoutConfirmBody", { reference: reference.trim() })}
        confirmLabel={t("admin.payoutRecord")}
        pending={record.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => record.mutate({ vendorId: batch.vendorId, bankReference: reference.trim() })}
      />
    </li>
  );
}

function HistoryRow({ run }: { run: inferRouterOutputs<AppRouter>["finance"]["payoutHistory"]["rows"][number] }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  return (
    <details className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-bold"><bdi>{run.vendorName}</bdi> · {formatDate(run.paidAt)}</span>
        <bdi dir="ltr" className="font-extrabold">{money({ amount: run.total, currencyCode: "KWD" })}</bdi>
      </summary>
      <p className="mt-2 text-[12px] text-[#536b8c]">
        {t("admin.payoutReference")}: <bdi dir="ltr">{run.bankReference}</bdi>
        {run.iban ? <> · <bdi dir="ltr" className="font-mono">{run.iban}</bdi></> : null}
      </p>
      <ul className="mt-2 text-[12px]">
        {run.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-3 py-0.5"><bdi dir="ltr">{line.reference}</bdi><bdi dir="ltr">{money({ amount: line.amount, currencyCode: "KWD" })}</bdi></li>
        ))}
      </ul>
    </details>
  );
}
