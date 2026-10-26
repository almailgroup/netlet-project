/**
 * A store's warnings (3.3.18), on its page in the portal and on its own
 * overview.
 *
 * NetLet's people issue and withdraw them here; a store's own people read
 * them, each with its reason, the product it names and the day it stops
 * counting, under "1 of 3 standing" — the number nobody used to be told until
 * the third rejection had already suspended them. Issuing asks first and says
 * when this one would suspend the store, because it does so at once.
 */
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Card, Field, Pill, isolate, smallButtonClass, textareaClass, buttonClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { MAX_WARNING_REASON, SUSPEND_AT_WARNINGS, WARNING_DAYS, warningReasonProblem, type WarningState } from "@shared/inventory/warnings";

const STATE: Record<WarningState, { label: MessageKey; tone: "danger" | "neutral" | "navy" }> = {
  standing: { label: "warnings.stateStanding", tone: "danger" },
  lapsed: { label: "warnings.stateLapsed", tone: "neutral" },
  withdrawn: { label: "warnings.stateWithdrawn", tone: "neutral" },
  cleared: { label: "warnings.stateCleared", tone: "navy" },
};

export function StoreWarnings({ vendorId, storeName, manage }: { vendorId?: number; storeName?: string; manage: boolean }) {
  const { t, tError, isArabic } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const list = trpc.warnings.list.useQuery(vendorId ? { vendorId } : undefined);
  const [reason, setReason] = useState("");
  const [productId, setProductId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const products = trpc.inventory.products.list.useQuery({ vendorId, pageSize: 200 }, { enabled: manage && vendorId !== undefined });
  const refresh = () => {
    void utils.warnings.list.invalidate();
    void utils.inventory.vendors.get.invalidate();
  };
  const issue = trpc.warnings.issue.useMutation({
    onSuccess: result => {
      toast.success(t(result.suspended ? "warnings.issuedSuspended" : "warnings.issued"));
      setReason("");
      setProductId("");
      setTried(false);
      setConfirming(false);
      refresh();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const withdraw = trpc.warnings.withdraw.useMutation({
    onSuccess: () => { toast.success(t("warnings.withdrawn")); setWithdrawing(null); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });

  const problem = warningReasonProblem(reason);
  const standing = list.data?.standing ?? 0;
  const next = standing + 1;

  /* A store with nothing on its record sees nothing on its overview. */
  if (!manage && list.data && list.data.rows.length === 0) return null;

  return (
    <Card
      id="warnings"
      title={t("warnings.title")}
      description={t(manage ? "warnings.noteAdmin" : "warnings.noteStore", { suspendAt: SUSPEND_AT_WARNINGS, days: WARNING_DAYS })}
    >
      <QueryGate queries={[list]}>
        {() => (
          <>
            <p className="flex items-center gap-2 text-[14px] font-semibold text-[#0a285a]">
              <AlertTriangle className={`size-4 ${standing > 0 ? "text-[#8c2f22]" : "text-[#536b8c]"}`} aria-hidden />
              {t("warnings.standing", { count: standing, suspendAt: SUSPEND_AT_WARNINGS })}
            </p>
            {list.data?.rows.length ? (
              <ul className="mt-3 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                {list.data.rows.map(row => (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <p dir="auto" className="text-[14px] leading-6 text-[#0a285a]">{row.reason}</p>
                      <p className="mt-0.5 text-[13px] ink-muted">
                        {formatDate(row.createdAt)}
                        {row.productTitle ? <> · {t("warnings.aboutProduct", { product: isolate((isArabic ? row.productTitleAr : null) || row.productTitle) })}</> : null}
                        {row.state === "standing" ? <> · {t("warnings.until", { date: formatDate(row.expiresAt) })}</> : null}
                        {row.issuedBy ? <> · {t("warnings.issuedBy", { email: isolate(row.issuedBy) })}</> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill tone={STATE[row.state].tone}>{t(STATE[row.state].label)}</Pill>
                      {manage && row.state === "standing" ? (
                        <button type="button" onClick={() => setWithdrawing(row.id)} className={smallButtonClass.secondary}>{t("warnings.withdraw")}</button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[14px] ink-muted">{t("warnings.none")}</p>
            )}
          </>
        )}
      </QueryGate>

      {manage ? (
        <form
          className="mt-5 space-y-3 border-t border-[#eef1f5] pt-4"
          onSubmit={event => {
            event.preventDefault();
            setTried(true);
            if (!problem) setConfirming(true);
          }}
        >
          <h3 className="text-[14px] font-bold text-[#0a285a]">{t("warnings.issue")}</h3>
          <Field label={t("warnings.reason")} error={tried && problem ? t(problem) : undefined}>
            <textarea dir="auto" value={reason} maxLength={MAX_WARNING_REASON} onChange={event => setReason(event.target.value)} className={textareaClass} />
          </Field>
          <Field label={t("warnings.product")} optional>
            <Select value={productId} onChange={event => setProductId(event.target.value)}>
              <option value="">{t("warnings.noProduct")}</option>
              {(products.data?.rows ?? []).map(product => (
                <option key={product.id} value={String(product.id)}>{(isArabic ? product.titleAr : null) || product.title}</option>
              ))}
            </Select>
          </Field>
          <button type="submit" disabled={issue.isPending} className={buttonClass.secondary}>
            {issue.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
            {t("warnings.issue")}
          </button>
        </form>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t("warnings.issueTitle", { store: isolate(storeName ?? "") })}
        body={t(next >= SUSPEND_AT_WARNINGS ? "warnings.issueBodySuspends" : "warnings.issueBody", { count: next, suspendAt: SUSPEND_AT_WARNINGS })}
        confirmLabel={t("warnings.issue")}
        tone="danger"
        pending={issue.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => vendorId && issue.mutate({ vendorId, productId: productId ? Number(productId) : null, reason: reason.trim() })}
      />
      <ConfirmDialog
        open={withdrawing !== null}
        title={t("warnings.withdrawTitle")}
        body={t("warnings.withdrawBody")}
        confirmLabel={t("warnings.withdraw")}
        pending={withdraw.isPending}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => withdrawing !== null && withdraw.mutate({ warningId: withdrawing })}
      />
    </Card>
  );
}
