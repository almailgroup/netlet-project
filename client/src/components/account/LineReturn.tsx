/**
 * Returning or exchanging one line, from the shopper's order (3.2.8).
 *
 * It replaces an email address. The window was always computed; what could be
 * done inside it was "reply to your confirmation", which a shopper had to find,
 * write and then wait on. Now the request is a row, and most requests are
 * decided the moment they are made (3.5.2): the reply says "approved" while the
 * shopper is still looking at the order.
 *
 * Nothing here decides. Whether the line is returnable comes from the server's
 * clock, the automatic decision comes back in the reply, and a refusal names
 * its reason — "perishable groceries can't be returned for a change of mind" is
 * an answer, and a missing button is not.
 */
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { isOpenReturn, MAX_RETURN_NOTE, RETURN_REASONS, type ReturnKind, type ReturnReason } from "@shared/commerce/returnRequests";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";
import { Select } from "@/components/ui/Select";

type Detail = NonNullable<inferRouterOutputs<AppRouter>["orders"]["get"]>;
type Line = Detail["lines"][number];
type Request = Detail["returns"][number];

const REASON_LABEL: Record<ReturnReason, MessageKey> = {
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

export function LineReturn({ reference, currency, line, requests }: { reference: string; currency: string; line: Line; requests: Request[] }) {
  const { t, tError, locale } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReturnKind>("refund");
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");
  /* Switched off (2.3): no new requests. One already made carries on — the
     status, the withdraw button and the seller's side all keep working. */
  const on = useFeature("returns");

  const latest = requests.find(request => request.orderItemId === line.id) ?? null;
  const refresh = () => void utils.orders.get.invalidate({ reference });

  const ask = trpc.orders.requestReturn.useMutation({
    onSuccess: reply => {
      setOpen(false);
      toast.success(t(reply.status === "approved" ? "returns.toastApproved" : reply.status === "declined" ? "returns.toastDeclined" : "returns.toastRequested"));
      refresh();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const cancel = trpc.orders.cancelReturn.useMutation({
    onSuccess: () => { toast.success(t("returns.toastCancelled")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });

  const money = (amount: string) => formatMoney(amount, { currencyCode: currency, locale });
  /* The latest request's state, whatever it is — withdrawn ones say nothing. */
  const status = latest && latest.status !== "cancelled" ? (
    <div className="mt-2 rounded-xl border border-[#e6e9ef] bg-[#fbfcfe] px-3 py-2">
      <p className="text-[12px] font-extrabold text-[#0a285a]">
        {t(latest.kind === "exchange" ? "returns.kindExchange" : "returns.kindRefund")} · {t(STATUS_LABEL[latest.status] ?? "returns.statusRequested")}
        {latest.decidedBy === "auto" && latest.status !== "requested" ? <span className="font-semibold ink-muted"> · {t("returns.decidedAutomatically")}</span> : null}
      </p>
      <p className="mt-0.5 text-[11px] leading-5 ink-muted">
        {latest.status === "approved" ? t("returns.nextApproved") : null}
        {latest.status === "requested" ? t("returns.nextRequested") : null}
        {latest.status === "collected" ? t("returns.nextCollected") : null}
        {latest.status === "refunded"
          ? (latest.refundPaidAt ? t("returns.refundPaid", { amount: money(latest.refundAmount ?? "0") }) : t("returns.refundDue", { amount: money(latest.refundAmount ?? "0") }))
          : null}
        {latest.status === "exchanged" && latest.replacementReference ? <>{t("returns.replacementSent")} <bdi dir="ltr">{latest.replacementReference}</bdi></> : null}
        {latest.declineReason ? <span dir="auto"> {isMessageKey(latest.declineReason) ? t(latest.declineReason) : latest.declineReason}</span> : null}
        {" "}<span>{formatDate(latest.createdAt)}</span>
      </p>
      {latest.status === "requested" || latest.status === "approved" ? (
        <button
          type="button"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ requestId: latest.id })}
          className="pressable mt-1 text-[11px] font-extrabold text-[#8c2f22] underline disabled:opacity-60"
        >
          {t("returns.withdraw")}
        </button>
      ) : null}
    </div>
  ) : null;

  /* Another request only when the window is open, nothing is in motion, and
     the line has not already been refunded or swapped — the rule the server
     holds too. */
  const mayAsk = on && line.returnState.returnable && !requests.some(request =>
    request.orderItemId === line.id && (isOpenReturn(request.status) || request.status === "refunded" || request.status === "exchanged"));
  if (!mayAsk) return status;

  if (!open) {
    return (
      <>
      {status}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass type-control pressable mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
      >
        <RotateCcw className="size-3.5 rtl:-scale-x-100" aria-hidden />{t("returns.start")}
      </button>
      </>
    );
  }

  return (
    <form
      className="mt-3 rounded-xl border border-[#d5dfeb] bg-white p-3"
      onSubmit={event => {
        event.preventDefault();
        ask.mutate({ reference, orderItemId: line.id, kind, reason, note: note.trim() || null });
      }}
    >
      <fieldset>
        <legend className="text-[11px] font-extrabold ink-muted">{t("returns.whatInstead")}</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {(["refund", "exchange"] as const).map(option => (
            <label key={option} className="flex items-center gap-1.5 text-[13px] text-[#0a285a]">
              <input type="radio" name={`kind-${line.id}`} checked={kind === option} onChange={() => setKind(option)} className="accent-[#0a285a]" />
              {t(option === "refund" ? "returns.kindRefund" : "returns.kindExchange")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold ink-muted">{t("returns.why")}</span>
        <Select
          value={reason}
          onChange={event => setReason(event.target.value as ReturnReason)}
          className="mt-1 h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a]"
        >
          {RETURN_REASONS.map(option => <option key={option} value={option}>{t(REASON_LABEL[option])}</option>)}
        </Select>
      </label>
      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold ink-muted">{t(reason === "other" ? "returns.noteRequired" : "returns.noteOptional")}</span>
        <textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          maxLength={MAX_RETURN_NOTE}
          rows={2}
          dir="auto"
          required={reason === "other"}
          className="glass-field mt-1 w-full rounded-2xl px-3 py-2 text-sm"
        />
      </label>
      <p className="mt-2 text-[11px] leading-5 ink-muted">{t("returns.howItWorks")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={ask.isPending} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
          {t("returns.submit")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="glass type-control pressable rounded-full px-4 py-2">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}
