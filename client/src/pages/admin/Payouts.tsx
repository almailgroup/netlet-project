/**
 * Payouts (3.3.21): what each seller is about to be paid, when the rest comes
 * due, and what has already been sent.
 *
 * One page for NetLet and for a store's manager, scoped by the server: an
 * administrator sees every seller's batch with the full account to send to; a
 * store sees its own, with the account masked, and nothing to press — being
 * told when money is coming is the store's half.
 *
 * Nobody assembles a batch. The schedule does. What NetLet does is three
 * steps, in this order, because the order is what keeps the ledger true:
 * **prepare** (the figure is frozen and counted as paid), **send** exactly
 * that — by hand or in a bank file — and **mark it sent** with the bank's
 * reference. Marking sent changes no amount; `shared/commerce/payoutFile.ts`
 * has why it used to matter.
 */
import { useState } from "react";
import { Link } from "wouter";
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
import type { PayoutFormat } from "@shared/commerce/payoutFile";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<AppRouter>["finance"];
type Batch = Outputs["payoutBatches"][number];
type Prepared = Outputs["preparedPayouts"]["rows"][number];
type BankFile = Outputs["payoutFiles"]["rows"][number];

const empty = "mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] text-[#536b8c]";
const quiet = "glass type-control pressable rounded-full px-4 py-2 disabled:opacity-60";
const primary = "glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60";

export default function AdminPayouts() {
  usePageMeta(privatePageMeta("Payouts"));
  return <AdminShell need="payouts.view">{actor => <Payouts actor={actor} />}</AdminShell>;
}

/** Everything a payout action changes, refreshed together so no section on the page disagrees with another. */
function useRefresh() {
  const utils = trpc.useUtils();
  return () => {
    void utils.finance.payoutBatches.invalidate();
    void utils.finance.preparedPayouts.invalidate();
    void utils.finance.payoutFiles.invalidate();
    void utils.finance.payoutHistory.invalidate();
    void utils.finance.payoutsDue.invalidate();
  };
}

function Payouts({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const admin = actor.kind === "admin";
  const batches = trpc.finance.payoutBatches.useQuery();
  const [page, setPage] = useState(1);
  const history = trpc.finance.payoutHistory.useQuery({ page }, { placeholderData: previous => previous });

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.payoutsPage")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t(admin ? "admin.payoutsNoteAdmin" : "admin.payoutsNoteStore")}</p>

      <section className="mt-6" aria-labelledby="payouts-ready">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="payouts-ready" className="text-sm font-extrabold">{t("admin.payoutsReady")}</h2>
          {admin ? <PrepareAll batches={batches.data ?? []} /> : null}
        </div>
        <QueryGate queries={[batches]}>
          {() => (batches.data ?? []).length === 0
            ? <p className={empty}>{t("admin.payoutsNothingReady")}</p>
            : <ul className="mt-3 space-y-3">{batches.data!.map(batch => <BatchCard key={batch.vendorId} batch={batch} canPrepare={admin} />)}</ul>}
        </QueryGate>
      </section>

      {admin ? <Waiting /> : null}
      {admin ? <BankFiles /> : null}

      <div className="mt-8"><PayoutsDue /></div>

      <section className="mt-8" aria-labelledby="payouts-history">
        <h2 id="payouts-history" className="text-sm font-extrabold">{t("admin.payoutsHistory")}</h2>
        <QueryGate queries={[history]}>
          {() => {
            const result = history.data;
            const rows = result?.rows ?? [];
            if (rows.length === 0) return <p className={empty}>{t("admin.payoutsNoHistory")}</p>;
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

function PrepareAll({ batches }: { batches: Batch[] }) {
  const { t, tError } = useTranslation();
  const refresh = useRefresh();
  const [confirming, setConfirming] = useState(false);
  const count = batches.filter(batch => batch.payable).length;
  const prepare = trpc.finance.prepareAllPayouts.useMutation({
    onSuccess: reply => {
      setConfirming(false);
      toast.success(t("admin.payoutPreparedAll", { count: String(reply.prepared) }));
      /* A store skipped is a store whose money did not go: say which, and leave it on screen. */
      if (reply.skipped.length) toast.error(t("admin.payoutSkipped", { names: reply.skipped.join("، ") }), { duration: 12_000 });
      refresh();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });
  if (count < 2) return null;
  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} disabled={prepare.isPending} className={primary}>
        {t("admin.payoutPrepareAll", { count: String(count) })}
      </button>
      <ConfirmDialog
        open={confirming}
        title={t("admin.payoutPrepareAllTitle", { count: String(count) })}
        body={t("admin.payoutPrepareAllBody")}
        confirmLabel={t("admin.payoutPrepare")}
        pending={prepare.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => prepare.mutate()}
      />
    </>
  );
}

function BatchCard({ batch, canPrepare }: { batch: Batch; canPrepare: boolean }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const refresh = useRefresh();
  const [confirming, setConfirming] = useState(false);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const prepare = trpc.finance.preparePayout.useMutation({
    onSuccess: reply => {
      setConfirming(false);
      toast.success(t("admin.payoutPrepared", { amount: amount(reply.total), name: batch.vendorName }));
      refresh();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });

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
      {canPrepare && batch.payable ? (
        batch.iban ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={prepare.isPending} className={`${primary} mt-3`}>{t("admin.payoutPrepare")}</button>
        ) : (
          /* Nothing to press until there is somewhere to send it — and the way there, rather than a dead button. */
          <p className="mt-3 text-[12px] text-[#536b8c]">
            {t("admin.payoutNeedsIban")} <Link href={`/admin/vendors/${batch.vendorId}`} className="font-bold underline ink-accent">{t("admin.payoutStorePage")}</Link>
          </p>
        )
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t("admin.payoutPrepareTitle", { amount: amount(batch.total), name: batch.vendorName })}
        body={t("admin.payoutPrepareBody")}
        confirmLabel={t("admin.payoutPrepare")}
        pending={prepare.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => prepare.mutate({ vendorId: batch.vendorId })}
      />
    </li>
  );
}

/** Runs frozen and not yet out of the bank. */
function Waiting() {
  const { t, tError } = useTranslation();
  const refresh = useRefresh();
  const [page, setPage] = useState(1);
  const prepared = trpc.finance.preparedPayouts.useQuery({ page }, { placeholderData: previous => previous });
  const makeFile = trpc.finance.makePayoutFile.useMutation({
    onSuccess: reply => { toast.success(t("admin.payoutFileMade", { reference: reply.reference, count: String(reply.transfers) })); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const unfiled = prepared.data?.unfiled ?? 0;

  return (
    <section className="mt-8" aria-labelledby="payouts-waiting">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="payouts-waiting" className="text-sm font-extrabold">{t("admin.payoutsWaiting")}</h2>
        {unfiled > 0 ? (
          <button type="button" onClick={() => makeFile.mutate()} disabled={makeFile.isPending} className={primary}>
            {t("admin.payoutMakeFile", { count: String(unfiled) })}
          </button>
        ) : null}
      </div>
      <p className="mt-1 max-w-2xl text-[12px] leading-5 ink-muted">{t("admin.payoutsWaitingNote")}</p>
      <QueryGate queries={[prepared]}>
        {() => {
          const result = prepared.data;
          const rows = result?.rows ?? [];
          if (rows.length === 0) return <p className={empty}>{t("admin.payoutsNoneWaiting")}</p>;
          return (
            <div className="mt-3">
              <ul className="space-y-3">{rows.map(run => <PreparedCard key={run.id} run={run} onChange={refresh} />)}</ul>
              {result ? <Pager page={result} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </section>
  );
}

function PreparedCard({ run, onChange }: { run: Prepared; onChange: () => void }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const [cancelling, setCancelling] = useState(false);
  const amount = money({ amount: run.total, currencyCode: "KWD" });
  const cancel = trpc.finance.cancelPayout.useMutation({
    onSuccess: () => { setCancelling(false); toast.success(t("admin.payoutCancelled")); onChange(); },
    onError: error => { setCancelling(false); toast.error(tError(error.message)); },
  });

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-extrabold"><bdi>{run.vendorName}</bdi></p>
        <p className="text-base font-extrabold text-[#0a285a]"><bdi dir="ltr">{amount}</bdi></p>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        {t("admin.payoutTo")} <bdi dir="ltr" className="font-mono">{run.iban ?? "—"}</bdi>
        {" · "}
        {run.fileReference ? t("admin.payoutInFile", { reference: run.fileReference }) : t("admin.payoutNotInFile")}
        {run.preparedAt ? <> · {t("admin.payoutPreparedOn", { date: formatDate(run.preparedAt) })}</> : null}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <SendForm
          id={`payout-run-${run.id}`}
          title={() => t("admin.payoutMarkSentTitle", { amount, name: run.vendorName })}
          body={reference => t("admin.payoutMarkSentBody", { reference })}
          target={{ runId: run.id }}
          onDone={onChange}
        />
        <button type="button" onClick={() => setCancelling(true)} disabled={cancel.isPending} className={quiet}>{t("admin.payoutCancel")}</button>
      </div>
      <ConfirmDialog
        open={cancelling}
        tone="danger"
        title={t("admin.payoutCancelTitle", { amount, name: run.vendorName })}
        body={t("admin.payoutCancelBody")}
        confirmLabel={t("admin.payoutCancel")}
        pending={cancel.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={() => cancel.mutate({ runId: run.id })}
      />
    </li>
  );
}

/**
 * The bank's reference, then a confirmation — for one run or a whole file.
 * Asks first because it is a statement that money left the bank.
 */
function SendForm({ id, title, body, target, onDone }: {
  id: string;
  title: (reference: string) => string;
  body: (reference: string) => string;
  target: { runId: number } | { fileId: number };
  onDone: () => void;
}) {
  const { t, tError } = useTranslation();
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const mark = trpc.finance.markPayoutSent.useMutation({
    onSuccess: reply => {
      setConfirming(false);
      setReference("");
      toast.success(t("admin.payoutMarkedSent", { count: String(reply.runs) }));
      onDone();
    },
    onError: error => { setConfirming(false); toast.error(tError(error.message)); },
  });
  const trimmed = reference.trim();
  return (
    <form className="flex min-w-0 flex-1 flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (trimmed) setConfirming(true); }}>
      <label htmlFor={id} className="block min-w-[180px] flex-1">
        <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.payoutReference")}</span>
        <input id={id} value={reference} onChange={event => setReference(event.target.value)} maxLength={80} required dir="ltr" className="glass-field mt-1 h-10 w-full rounded-full px-4 text-sm" />
      </label>
      <button type="submit" disabled={!trimmed || mark.isPending} className={primary}>{"fileId" in target ? t("admin.payoutMarkFileSent") : t("admin.payoutMarkSent")}</button>
      <ConfirmDialog
        open={confirming}
        title={title(trimmed)}
        body={body(trimmed)}
        confirmLabel={t("admin.payoutMarkSent")}
        pending={mark.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => mark.mutate({ ...target, bankReference: trimmed })}
      />
    </form>
  );
}

/** Hand the browser a file the server wrote. */
function save(file: { filename: string; mimeType: string; content: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mimeType};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  /* Revoked after the click has been handled, not during it: Safari reads the URL late. */
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function BankFiles() {
  const { t, tError } = useTranslation();
  const [page, setPage] = useState(1);
  const files = trpc.finance.payoutFiles.useQuery({ page }, { placeholderData: previous => previous });
  const problem = files.data?.pain001 ?? null;

  return (
    <section className="mt-8" aria-labelledby="payouts-files">
      <h2 id="payouts-files" className="text-sm font-extrabold">{t("admin.payoutFiles")}</h2>
      <p className="mt-1 max-w-2xl text-[12px] leading-5 ink-muted">{t("admin.payoutFilesNote")}</p>
      {problem ? <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#8c2f22]">{t("admin.payoutXmlUnavailable")} {tError(problem)}</p> : null}
      <QueryGate queries={[files]}>
        {() => {
          const result = files.data;
          const rows = result?.rows ?? [];
          if (rows.length === 0) return <p className={empty}>{t("admin.payoutNoFiles")}</p>;
          return (
            <div className="mt-3">
              <ul className="space-y-3">{rows.map(file => <FileCard key={file.id} file={file} xmlReady={!problem} />)}</ul>
              {result ? <Pager page={result} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </section>
  );
}

function FileCard({ file, xmlReady }: { file: BankFile; xmlReady: boolean }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const refresh = useRefresh();
  const download = trpc.finance.downloadPayoutFile.useMutation({
    onSuccess: save,
    onError: error => toast.error(tError(error.message)),
  });
  const get = (format: PayoutFormat) => download.mutate({ fileId: file.id, format });
  const live = file.waiting + file.sent > 0;

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p id={`payout-file-name-${file.id}`} className="font-extrabold"><bdi dir="ltr">{file.reference}</bdi> · <span className="font-bold text-[#536b8c]">{formatDate(file.createdAt)}</span></p>
        <p className="text-base font-extrabold text-[#0a285a]"><bdi dir="ltr">{money({ amount: file.total, currencyCode: "KWD" })}</bdi></p>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        {t("admin.payoutFileCounts", { waiting: String(file.waiting), sent: String(file.sent), cancelled: String(file.cancelled) })}
      </p>
      {live ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Described by the file's name: every card has the same two buttons. */}
          <button type="button" onClick={() => get("pain001")} disabled={!xmlReady || download.isPending} aria-describedby={`payout-file-name-${file.id}`} className={quiet}>{t("admin.payoutDownloadXml")}</button>
          <button type="button" onClick={() => get("csv")} disabled={download.isPending} aria-describedby={`payout-file-name-${file.id}`} className={quiet}>{t("admin.payoutDownloadCsv")}</button>
        </div>
      ) : null}
      {file.waiting > 0 ? (
        <div className="mt-3">
          <SendForm
            id={`payout-file-${file.id}`}
            title={() => t("admin.payoutMarkFileTitle", { file: file.reference })}
            body={reference => t("admin.payoutMarkFileBody", { reference })}
            target={{ fileId: file.id }}
            onDone={refresh}
          />
        </div>
      ) : null}
    </li>
  );
}

function HistoryRow({ run }: { run: Outputs["payoutHistory"]["rows"][number] }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const when = run.paidAt ?? run.preparedAt;
  return (
    <details className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-bold">
          <bdi>{run.vendorName}</bdi>{when ? <> · {formatDate(when)}</> : null}
          {run.status === "prepared" ? <span className="ms-2 rounded-full bg-[#e7edf5] px-2 py-0.5 text-[11px] font-extrabold text-[#0a285a]">{t("admin.payoutBeingSent")}</span> : null}
        </span>
        <bdi dir="ltr" className="font-extrabold">{money({ amount: run.total, currencyCode: "KWD" })}</bdi>
      </summary>
      <p className="mt-2 text-[12px] text-[#536b8c]">
        {run.bankReference ? <>{t("admin.payoutReference")}: <bdi dir="ltr">{run.bankReference}</bdi></> : t("admin.payoutBeingSent")}
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
