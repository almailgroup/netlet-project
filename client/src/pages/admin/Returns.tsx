/**
 * The returns desk (3.2.8): what a store has to collect, receive and pay back.
 *
 * Most requests arrive already decided (3.5.2) — the desk is mostly the
 * operations after the decision, which is where returns go wrong in practice:
 * a parcel nobody collected, an item received and never refunded. Open work
 * sorts first, then refunds still owed in cash, then history.
 *
 * Each button comes from `returnActions`, the same function the server
 * refuses with, so the desk cannot offer a step the API would reject. Deciding
 * and receiving are a manager's (`returns.handle`); an administrator sees every
 * store's and may overrule an approval, because a refusal a seller can be
 * argued out of needs somebody above both parties.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Row = inferRouterOutputs<AppRouter>["returns"]["list"][number];

const REASON_LABEL: Record<string, MessageKey> = {
  damaged: "returns.reasonDamaged",
  defective: "returns.reasonDefective",
  wrongItem: "returns.reasonWrongItem",
  notAsDescribed: "returns.reasonNotAsDescribed",
  tooSmall: "returns.reasonTooSmall",
  tooLarge: "returns.reasonTooLarge",
  changedMind: "returns.reasonChangedMind",
  other: "returns.reasonOther",
};

const STATUS_LABEL: Record<string, MessageKey> = {
  requested: "returns.statusRequested",
  approved: "returns.statusApproved",
  declined: "returns.statusDeclined",
  collected: "returns.statusCollected",
  refunded: "returns.statusRefunded",
  exchanged: "returns.statusExchanged",
  cancelled: "returns.statusCancelled",
};

export default function AdminReturns() {
  usePageMeta(privatePageMeta("Returns"));
  return <AdminShell need="returns.handle">{actor => <Returns actor={actor} />}</AdminShell>;
}

function Returns({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [openOnly, setOpenOnly] = useState(true);
  const list = trpc.returns.list.useQuery({ open: openOnly });

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.returns")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.returnsNote")}</p>

      <div role="tablist" aria-label={t("admin.returns")} className="mt-5 inline-flex gap-1 rounded-2xl bg-[#eef1f6] p-1">
        {([true, false] as const).map(value => (
          <button
            key={String(value)}
            role="tab"
            type="button"
            aria-selected={openOnly === value}
            onClick={() => setOpenOnly(value)}
            className={`rounded-xl px-4 py-2 text-[12px] font-extrabold ${openOnly === value ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c]"}`}
          >
            {t(value ? "admin.returnsTabOpen" : "admin.returnsTabAll")}
          </button>
        ))}
      </div>

      <QueryGate queries={[list]}>
        {() => {
          const rows = list.data ?? [];
          if (rows.length === 0) {
            return <p className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t("admin.returnsNone")}</p>;
          }
          return <ul className="mt-5 space-y-3">{rows.map(row => <ReturnCard key={row.id} row={row} actor={actor} />)}</ul>;
        }}
      </QueryGate>
    </>
  );
}

function ReturnCard({ row, actor }: { row: Row; actor: Actor }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [restock, setRestock] = useState(true);

  const refresh = () => {
    void utils.returns.list.invalidate();
    void utils.returns.waiting.invalidate();
  };
  const done = (key: MessageKey) => () => { toast.success(t(key)); refresh(); };
  const fail = (error: { message: string }) => toast.error(tError(error.message));
  const decide = trpc.returns.decide.useMutation({ onSuccess: done("admin.returnsSaved"), onError: fail });
  const collect = trpc.returns.collect.useMutation({ onSuccess: done("admin.returnsSaved"), onError: fail });
  const receive = trpc.returns.receive.useMutation({
    onSuccess: reply => {
      setReceiving(false);
      toast.success(reply.outcome === "exchanged"
        ? t("admin.returnsExchanged", { reference: reply.replacementReference ?? "" })
        : t("admin.returnsRefunded", { amount: money(reply.refundAmount ?? "0", "KWD") }));
      refresh();
    },
    onError: fail,
  });
  const paid = trpc.returns.refundPaid.useMutation({ onSuccess: done("admin.returnsSaved"), onError: fail });

  const where = row.destination?.addressLine ?? row.addressLine;
  const pending = decide.isPending || collect.isPending || receive.isPending || paid.isPending;

  return (
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-extrabold">
          <bdi dir="ltr">{row.reference}</bdi>
          <span dir="auto" className="ms-2 text-[13px] font-bold">{row.productTitle}</span>
          {row.quantity > 1 ? <span className="text-[12px] text-[#536b8c]"> ×{row.quantity}</span> : null}
        </p>
        <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">{t(STATUS_LABEL[row.status] ?? "returns.statusRequested")}</span>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        {t(row.kind === "exchange" ? "returns.kindExchange" : "returns.kindRefund")} · {t(REASON_LABEL[row.reason] ?? "returns.reasonOther")}
        {actor.kind === "admin" && row.vendorName ? <> · <span dir="auto">{row.vendorName}</span></> : null}
        {" · "}{formatDate(row.createdAt)}
        {row.decidedBy === "auto" ? <> · {t("returns.decidedAutomatically")}</> : null}
      </p>
      {row.note ? <p dir="auto" className="mt-2 text-[13px] leading-6">“{row.note}”</p> : null}
      {row.declineReason ? <p dir="auto" className="mt-1 text-[12px] text-[#536b8c]">{isMessageKey(row.declineReason) ? t(row.declineReason) : row.declineReason}</p> : null}

      {/* Where to collect it, while there is something to collect. */}
      {row.status === "approved" ? (
        <p className="mt-2 text-[12px] leading-5 text-[#536b8c]" dir="auto">
          {t("admin.returnsCollectFrom")} {[row.contactName, row.contactPhone, where].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {row.status === "refunded" ? (
        <p className="mt-2 text-[13px] font-extrabold">
          {row.refundPaidAt
            ? t("returns.refundPaid", { amount: money(row.refundAmount ?? "0", "KWD") })
            : t("admin.returnsRefundOwed", { amount: money(row.refundAmount ?? "0", "KWD") })}
        </p>
      ) : null}
      {row.status === "exchanged" && row.replacementReference ? (
        <p className="mt-2 text-[12px] text-[#536b8c]">{t("returns.replacementSent")} <bdi dir="ltr">{row.replacementReference}</bdi></p>
      ) : null}

      {row.actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {row.actions.includes("approve") ? (
            <button type="button" disabled={pending} onClick={() => decide.mutate({ requestId: row.id, approve: true })} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
              {t("admin.returnsApprove")}
            </button>
          ) : null}
          {row.actions.includes("decline") ? (
            <button type="button" disabled={pending} onClick={() => setDeclining(!declining)} className="glass type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
              {t("admin.returnsDecline")}
            </button>
          ) : null}
          {row.actions.includes("collect") ? (
            <button type="button" disabled={pending} onClick={() => collect.mutate({ requestId: row.id })} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
              {t("admin.returnsCollected")}
            </button>
          ) : null}
          {row.actions.includes("receive") ? (
            <>
              {/* The one question only the person holding the item can answer,
                  asked before the press rather than inside the dialog. */}
              <label className="flex items-center gap-2 text-[12px] font-bold text-[#0a285a]">
                <input type="checkbox" checked={restock} onChange={event => setRestock(event.target.checked)} className="size-4 accent-[#0a285a]" />
                {t("admin.returnsRestock")}
              </label>
              <button type="button" disabled={pending} onClick={() => setReceiving(true)} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
                {t(row.kind === "exchange" ? "admin.returnsReceiveExchange" : "admin.returnsReceiveRefund")}
              </button>
            </>
          ) : null}
          {row.actions.includes("markRefundPaid") ? (
            <button type="button" disabled={pending} onClick={() => paid.mutate({ requestId: row.id })} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
              {t("admin.returnsMarkPaid")}
            </button>
          ) : null}
        </div>
      ) : null}

      {declining ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={event => { event.preventDefault(); decide.mutate({ requestId: row.id, approve: false, reason }); }}
        >
          <label className="block min-w-[220px] flex-1">
            <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.returnsDeclineWhy")}</span>
            <input value={reason} onChange={event => setReason(event.target.value)} maxLength={400} dir="auto" required className="glass-field mt-1 w-full rounded-full px-4 py-2 text-sm" />
          </label>
          <button type="submit" disabled={pending} className="glass type-control pressable rounded-full px-4 py-2 disabled:opacity-60">{t("admin.returnsDecline")}</button>
        </form>
      ) : null}

      {/* Receiving is the refund or the exchange, so it asks first. */}
      <ConfirmDialog
        open={receiving}
        title={t(row.kind === "exchange" ? "admin.returnsConfirmExchange" : "admin.returnsConfirmRefund", { amount: money(row.lineTotal, "KWD") })}
        body={`${t("admin.returnsConfirmBody")} ${t(restock ? "admin.returnsWillRestock" : "admin.returnsWillNotRestock")}`}
        confirmLabel={t(row.kind === "exchange" ? "admin.returnsReceiveExchange" : "admin.returnsReceiveRefund")}
        pending={receive.isPending}
        onClose={() => setReceiving(false)}
        onConfirm={() => receive.mutate({ requestId: row.id, restock })}
      />
    </li>
  );
}
