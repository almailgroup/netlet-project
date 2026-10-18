/**
 * Affiliates (3.7), for an administrator: who has applied, who earns, at what
 * rate, and what they have made.
 *
 * Pending first, because the reason to open this page is usually an
 * application waiting. The channel is shown as written so whoever approves can
 * go and look at where the links will be published. Every change — approval,
 * suspension, a new rate — is on the audit trail with the chain, because it is
 * who NetLet pays and how much.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, fieldClass, PageHeader, Pill, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_AFFILIATE_PERCENT } from "@shared/commerce/affiliate";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

type Row = inferRouterOutputs<AppRouter>["affiliates"]["list"]["rows"][number];

const STATUS: Record<string, { label: MessageKey; tone: "warning" | "good" | "danger" }> = {
  pending: { label: "affiliate.statusPending", tone: "warning" },
  active: { label: "affiliate.statusActive", tone: "good" },
  suspended: { label: "affiliate.statusSuspended", tone: "danger" },
};

export default function AdminAffiliates() {
  usePageMeta(privatePageMeta("Affiliates"));
  return <AdminShell need="affiliate.manage">{() => <Affiliates />}</AdminShell>;
}

function Affiliates() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const list = trpc.affiliates.list.useQuery({ page }, { placeholderData: previous => previous });
  return (
    <>
      <PageHeader title={t("admin.affiliates")} description={t("admin.affiliatesNote", { ceiling: String(MAX_AFFILIATE_PERCENT) })} />
      {list.isLoading ? (
        <SkeletonRows label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const result = list.data;
            const rows = result?.rows ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.affiliatesNone")} />;
            return (
              <>
                <ul className="space-y-3">
                  {rows.map(row => <AffiliateCard key={row.id} row={row} />)}
                </ul>
                {result ? <Pager page={result} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      )}
    </>
  );
}

function AffiliateCard({ row }: { row: Row }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [rate, setRate] = useState(row.ratePercent);
  const update = trpc.affiliates.update.useMutation({
    onSuccess: () => { toast.success(t("admin.affiliateSaved")); void utils.affiliates.list.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });
  const rateId = `affiliate-rate-${row.id}`;
  const hintId = `${rateId}-hint`;
  const status = STATUS[row.status] ?? STATUS.pending;

  return (
    <li className="rounded-2xl border border-[#e1e7ef] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-[#0a285a]">
            <bdi>{row.displayName}</bdi>
            <bdi dir="ltr" className="ms-2 rounded-md bg-[#eef1f5] px-1.5 py-0.5 text-[12px] font-semibold text-[#3d5376]">{row.code}</bdi>
          </p>
          <p className="mt-1 text-[13px] leading-5 ink-muted">
            {row.name ? <><bdi>{row.name}</bdi> · </> : null}<bdi dir="ltr">{row.email}</bdi> · {formatDate(row.createdAt)}
          </p>
        </div>
        <Pill tone={status.tone}>{t(status.label)}</Pill>
      </div>
      {row.channel ? (
        <p className="mt-2 text-[13px] leading-5 text-[#3d5376]">
          <span className="font-semibold">{t("affiliate.channel")}:</span> <bdi dir="ltr" className="break-all">{row.channel}</bdi>
        </p>
      ) : null}
      <p className="mt-1 text-[13px] leading-5 text-[#3d5376]">{t("admin.affiliateStats", { orders: String(row.paidOrders), earned: money({ amount: row.earned, currencyCode: "KWD" }) })}</p>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[#eef1f5] pt-4">
        <div>
          <label htmlFor={rateId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.affiliateRate")}</label>
          <input
            id={rateId}
            aria-describedby={hintId}
            value={rate}
            onChange={event => setRate(event.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            dir="ltr"
            maxLength={5}
            className={`${fieldClass} mt-1.5 h-9 w-24`}
          />
        </div>
        <button type="button" disabled={update.isPending || rate === row.ratePercent} onClick={() => update.mutate({ affiliateId: row.id, ratePercent: rate })} className={smallButtonClass.secondary}>
          {t("admin.affiliateSetRate")}
        </button>
        <span className="flex-1" />
        {row.status !== "active" ? (
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ affiliateId: row.id, status: "active" })} className={smallButtonClass.primary}>
            {t(row.status === "pending" ? "admin.affiliateApprove" : "admin.affiliateReinstate")}
          </button>
        ) : (
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ affiliateId: row.id, status: "suspended" })} className={smallButtonClass.quietDanger}>
            {t("admin.affiliateSuspend")}
          </button>
        )}
        <p id={hintId} className="basis-full text-[12px] ink-muted">{t("admin.affiliateRateHint", { ceiling: String(MAX_AFFILIATE_PERCENT) })}</p>
      </div>
    </li>
  );
}
