/**
 * Fraud watch (3.6.5): reviews and referrals that do not look like a
 * shopper's own, beside the order flags the orders page already carries.
 *
 * The judgements are `Shared/commerce/fraudSignals.ts` and are pure; this page
 * shows the newest hundred of each with what was noticed and the counts behind
 * it. **Nothing here acts by itself**: a review is hidden by a person's press,
 * with a reason, and shown again the same way; a referral is something to look
 * at before its cash-out is paid. A high-risk one is also a notice to every
 * administrator as it happens (`alertIfRiskyReview`, `alertIfRiskyReferral`),
 * and opening this page reads those.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, fieldClass, isolate, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { useAlertsRead } from "@/hooks/useAlertsRead";
import { trpc } from "@/lib/trpc";
import type { ReferralSignal, ReviewSignal, RiskLevel } from "@shared/commerce/fraudSignals";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

const SIGNAL_LABEL: Record<ReviewSignal | ReferralSignal, MessageKey> = {
  reviewerIsSeller: "fraud.reviewerIsSeller",
  reviewersShareAddress: "fraud.reviewersShareAddress",
  reviewBurst: "fraud.reviewBurst",
  newAccountReview: "fraud.newAccountReview",
  sameRatingEveryTime: "fraud.sameRatingEveryTime",
  sharedAddress: "fraud.sharedAddress",
  sharedPhone: "fraud.sharedPhone",
  similarEmail: "fraud.similarEmail",
  qualifyingRefunded: "fraud.qualifyingRefunded",
  referralBurst: "fraud.referralBurst",
};

type Flagged = { signal: ReviewSignal | ReferralSignal; serious: boolean; detail: Record<string, number | string> };

export default function AdminFraud() {
  usePageMeta(privatePageMeta("Fraud watch"));
  return <AdminShell need="platform.viewAll">{() => <FraudWatch />}</AdminShell>;
}

function FraudWatch() {
  const { t } = useTranslation();
  useAlertsRead("watch");
  const [view, setView] = useState<"reviews" | "referrals">("reviews");
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  return (
    <>
      <PageHeader title={t("fraud.title")} description={t("fraud.intro")} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label={t("fraud.title")}
          value={view}
          onChange={setView}
          options={[{ value: "reviews", label: t("fraud.tabReviews") }, { value: "referrals", label: t("fraud.tabReferrals") }]}
        />
        <label className="flex items-center gap-2 text-[14px] font-semibold text-[#0a285a]">
          <input type="checkbox" checked={onlyFlagged} onChange={event => setOnlyFlagged(event.target.checked)} className="size-4 accent-[#0a285a]" />
          {t("fraud.onlyFlagged")}
        </label>
      </div>
      {view === "reviews" ? <Reviews onlyFlagged={onlyFlagged} /> : <Referrals onlyFlagged={onlyFlagged} />}
    </>
  );
}

function RiskPill({ risk }: { risk: RiskLevel }) {
  const { t } = useTranslation();
  if (risk === "low") return null;
  return <Pill tone={risk === "high" ? "danger" : "warning"}>{t(risk === "high" ? "admin.riskHigh" : "admin.riskWatch")}</Pill>;
}

function Flags({ flags }: { flags: Flagged[] }) {
  const { t } = useTranslation();
  if (!flags.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-[13px] text-[#3d5376]">
      {flags.map(flag => (
        <li key={flag.signal} className={flag.serious ? "font-semibold text-[#8c2f22]" : undefined}>
          · {t(SIGNAL_LABEL[flag.signal], flag.detail)}
        </li>
      ))}
    </ul>
  );
}

function Reviews({ onlyFlagged }: { onlyFlagged: boolean }) {
  const { t, tError } = useTranslation();
  const when = useDateTimeFormat();
  const utils = trpc.useUtils();
  const watch = trpc.orders.reviewWatch.useQuery(undefined, { staleTime: 30_000 });
  const [hiding, setHiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const setHidden = trpc.reviews.setHidden.useMutation({
    onSuccess: (_reply, input) => {
      toast.success(t(input.hidden ? "fraud.hiddenDone" : "fraud.shownDone"));
      setHiding(null);
      setReason("");
      void utils.orders.reviewWatch.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  if (watch.isLoading) return <SkeletonRows rows={4} label={t("admin.loading")} />;
  return (
    <QueryGate queries={[watch]}>
      {() => {
        const all = watch.data ?? [];
        const rows = onlyFlagged ? all.filter(row => row.flags.length > 0) : all;
        if (!rows.length) return <EmptyState title={t(onlyFlagged ? "fraud.noneFlagged" : "fraud.noReviews", { count: all.length })} />;
        return (
          <>
            <ul className="space-y-3">
              {rows.map(row => (
                <li key={row.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#0a285a]"><span dir="auto">{row.productTitle}</span> · {t("fraud.stars", { rating: row.rating })}</p>
                      <p className="mt-0.5 text-[13px] text-[#536b8c]">
                        {t("fraud.reviewBy", { email: isolate(row.reviewerEmail ?? "") })} · {when(row.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.hidden ? <Pill>{t("fraud.hiddenPill")}</Pill> : null}
                      <RiskPill risk={row.risk} />
                    </div>
                  </div>
                  {row.title || row.body ? (
                    <p dir="auto" className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#0a285a]">
                      {row.title ? <strong>{row.title} </strong> : null}{row.body}
                    </p>
                  ) : null}
                  <Flags flags={row.flags} />
                  {row.hidden && row.hiddenReason ? <p className="mt-2 text-[13px] ink-muted">{t("fraud.hiddenBecause", { reason: row.hiddenReason })}</p> : null}
                  <div className="mt-3">
                    {row.hidden ? (
                      <button type="button" disabled={setHidden.isPending} onClick={() => setHidden.mutate({ reviewId: row.id, hidden: false })} className={smallButtonClass.secondary}>
                        {t("fraud.show")}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setHiding(row.id)} className={smallButtonClass.quietDanger}>
                        {t("fraud.hide")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <ConfirmDialog
              open={hiding !== null}
              title={t("fraud.hideTitle")}
              body={t("fraud.hideBody")}
              confirmLabel={t("fraud.hide")}
              tone="danger"
              pending={setHidden.isPending}
              onClose={() => { setHiding(null); setReason(""); }}
              onConfirm={() => hiding !== null && setHidden.mutate({ reviewId: hiding, hidden: true, reason: reason.trim() || undefined })}
            >
              <label className="mt-3 block text-[13px] font-semibold text-[#0a285a]">
                {t("fraud.hideReason")}
                <input dir="auto" value={reason} maxLength={200} onChange={event => setReason(event.target.value)} className={`${fieldClass} mt-1.5`} />
              </label>
            </ConfirmDialog>
          </>
        );
      }}
    </QueryGate>
  );
}

function Referrals({ onlyFlagged }: { onlyFlagged: boolean }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const watch = trpc.orders.referralWatch.useQuery(undefined, { staleTime: 30_000 });

  if (watch.isLoading) return <SkeletonRows rows={4} label={t("admin.loading")} />;
  return (
    <QueryGate queries={[watch]}>
      {() => {
        const all = watch.data ?? [];
        const rows = onlyFlagged ? all.filter(row => row.flags.length > 0) : all;
        if (!rows.length) return <EmptyState title={t(onlyFlagged ? "fraud.noneFlagged" : "fraud.noReferrals", { count: all.length })} />;
        return (
          <ul className="space-y-3">
            {rows.map(row => (
              <li key={row.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-[#0a285a]">
                      {t("fraud.referralLine", { referrer: isolate(row.referrerEmail ?? ""), referred: isolate(row.referredEmail ?? "") })}
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#536b8c]">
                      {when(row.createdAt)} · {row.qualifiedAt ? t("fraud.qualifiedOn", { date: when(row.qualifiedAt) }) : t("fraud.notQualified")}
                    </p>
                  </div>
                  <RiskPill risk={row.risk} />
                </div>
                <Flags flags={row.flags} />
              </li>
            ))}
          </ul>
        );
      }}
    </QueryGate>
  );
}
