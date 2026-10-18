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
import { EmptyState, fieldClass, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../../Backend/src/routes";
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

const STATUS_TONE: Record<string, "warning" | "navy" | "good" | "neutral" | "danger"> = {
  requested: "warning",
  approved: "navy",
  collected: "navy",
  refunded: "good",
  exchanged: "good",
  declined: "danger",
  cancelled: "neutral",
};

export default function AdminReturns() {
  usePageMeta(privatePageMeta("Returns"));
  return <AdminShell need="returns.handle">{actor => <Returns actor={actor} />}</AdminShell>;
}

function Returns({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [openOnly, setOpenOnly] = useState<"open" | "all">("open");
  const list = trpc.returns.list.useQuery({ open: openOnly === "open" });

  return (
    <>
      <PageHeader title={t("admin.returns")} description={t("admin.returnsNote")} />
      <Segmented
        label={t("admin.returns")}
        className="mb-4 w-fit"
        value={openOnly}
        onChange={setOpenOnly}
        options={[{ value: "open", label: t("admin.returnsTabOpen") }, { value: "all", label: t("admin.returnsTabAll") }]}
      />

      {list.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const rows = list.data ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.returnsNone")} />;
            return <ul className="space-y-3">{rows.map(row => <ReturnCard key={row.id} row={row} actor={actor} />)}</ul>;
          }}
        </QueryGate>
      )}
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
    <li className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">
              {row.productTitle}
              {row.quantity > 1 ? <span className="text-[13px] font-semibold text-[#536b8c]"> ×{row.quantity}</span> : null}
            </p>
            <p className="mt-0.5 text-[13px] ink-muted">
              <bdi dir="ltr" className="font-semibold text-[#3d5376]">{row.reference}</bdi>
              {actor.kind === "admin" && row.vendorName ? <> · <bdi>{row.vendorName}</bdi></> : null}
              {" · "}{formatDate(row.createdAt)}
            </p>
          </div>
          <Pill tone={STATUS_TONE[row.status] ?? "neutral"}>{t(STATUS_LABEL[row.status] ?? "returns.statusRequested")}</Pill>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#3d5376]">
          <Pill tone="navy">{t(row.kind === "exchange" ? "returns.kindExchange" : "returns.kindRefund")}</Pill>
          <span>{t(REASON_LABEL[row.reason] ?? "returns.reasonOther")}</span>
          {row.decidedBy === "auto" ? <span className="ink-muted">· {t("returns.decidedAutomatically")}</span> : null}
        </p>
        {row.note ? <p dir="auto" className="mt-3 rounded-xl bg-[#f4f6f9] px-3.5 py-2.5 text-[14px] leading-6 text-[#3d5376]">{row.note}</p> : null}
        {row.declineReason ? <p dir="auto" className="mt-2 text-[13px] text-[#8c2f22]">{isMessageKey(row.declineReason) ? t(row.declineReason) : row.declineReason}</p> : null}

        {/* Where to collect it, while there is something to collect. */}
        {row.status === "approved" ? (
          <p className="mt-3 text-[13px] leading-5 text-[#3d5376]">
            <span className="font-semibold text-[#0a285a]">{t("admin.returnsCollectFrom")}</span>{" "}
            <bdi>{[row.contactName, row.contactPhone, where].filter(Boolean).join(" · ")}</bdi>
          </p>
        ) : null}
        {row.status === "refunded" ? (
          <p className={`mt-3 text-[14px] font-bold ${row.refundPaidAt ? "text-[#2f5d33]" : "text-[#8c2f22]"}`}>
            {row.refundPaidAt
              ? t("returns.refundPaid", { amount: money(row.refundAmount ?? "0", "KWD") })
              : t("admin.returnsRefundOwed", { amount: money(row.refundAmount ?? "0", "KWD") })}
          </p>
        ) : null}
        {row.status === "exchanged" && row.replacementReference ? (
          <p className="mt-3 text-[13px] text-[#3d5376]">{t("returns.replacementSent")} <bdi dir="ltr" className="font-semibold">{row.replacementReference}</bdi></p>
        ) : null}
      </div>

      {row.actions.length > 0 ? (
        <div className="border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {row.actions.includes("receive") ? (
              /* The one question only the person holding the item can answer,
                 asked before the press rather than inside the dialog. */
              <label className="me-auto flex items-center gap-2 text-[13px] font-semibold text-[#0a285a]">
                <input type="checkbox" checked={restock} onChange={event => setRestock(event.target.checked)} className="size-4 accent-[#0a285a]" />
                {t("admin.returnsRestock")}
              </label>
            ) : null}
            {row.actions.includes("decline") ? (
              <button type="button" disabled={pending} aria-expanded={declining} onClick={() => setDeclining(!declining)} className={smallButtonClass.quietDanger}>
                {t("admin.returnsDecline")}
              </button>
            ) : null}
            {row.actions.includes("approve") ? (
              <button type="button" disabled={pending} onClick={() => decide.mutate({ requestId: row.id, approve: true })} className={smallButtonClass.primary}>
                {t("admin.returnsApprove")}
              </button>
            ) : null}
            {row.actions.includes("collect") ? (
              <button type="button" disabled={pending} onClick={() => collect.mutate({ requestId: row.id })} className={smallButtonClass.primary}>
                {t("admin.returnsCollected")}
              </button>
            ) : null}
            {row.actions.includes("receive") ? (
              <button type="button" disabled={pending} onClick={() => setReceiving(true)} className={smallButtonClass.primary}>
                {t(row.kind === "exchange" ? "admin.returnsReceiveExchange" : "admin.returnsReceiveRefund")}
              </button>
            ) : null}
            {row.actions.includes("markRefundPaid") ? (
              <button type="button" disabled={pending} onClick={() => paid.mutate({ requestId: row.id })} className={smallButtonClass.primary}>
                {t("admin.returnsMarkPaid")}
              </button>
            ) : null}
          </div>

          {declining ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={event => { event.preventDefault(); decide.mutate({ requestId: row.id, approve: false, reason }); }}
            >
              <div className="min-w-[220px] flex-1">
                <label htmlFor={`decline-${row.id}`} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.returnsDeclineWhy")}</label>
                <input id={`decline-${row.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={400} dir="auto" required className={`${fieldClass} mt-1.5`} />
              </div>
              <button type="submit" disabled={pending || !reason.trim()} className={`${smallButtonClass.danger} h-11`}>{t("admin.returnsDecline")}</button>
            </form>
          ) : null}
        </div>
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
