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
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_AFFILIATE_PERCENT } from "@shared/commerce/affiliate";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

type Row = inferRouterOutputs<AppRouter>["affiliates"]["list"]["rows"][number];

const STATUS: Record<string, MessageKey> = {
  pending: "affiliate.statusPending",
  active: "affiliate.statusActive",
  suspended: "affiliate.statusSuspended",
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
      <h1 className="text-xl font-extrabold">{t("admin.affiliates")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.affiliatesNote", { ceiling: String(MAX_AFFILIATE_PERCENT) })}</p>
      <QueryGate queries={[list]}>
        {() => {
          const result = list.data;
          const rows = result?.rows ?? [];
          if (rows.length === 0) return <p className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t("admin.affiliatesNone")}</p>;
          return (
            <div className="mt-5 space-y-3">
              {rows.map(row => <AffiliateCard key={row.id} row={row} />)}
              {result ? <Pager page={result} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
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

  return (
    <article className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-extrabold"><bdi>{row.displayName}</bdi> <bdi dir="ltr" className="ms-1 text-[12px] font-bold ink-muted">{row.code}</bdi></p>
        <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">{t(STATUS[row.status] ?? "affiliate.statusPending")}</span>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        <bdi>{row.name ?? ""}</bdi> <bdi dir="ltr">{row.email}</bdi> · {formatDate(row.createdAt)}
      </p>
      {row.channel ? <p className="mt-1 text-[12px] text-[#536b8c]">{t("affiliate.channel")}: <bdi dir="ltr">{row.channel}</bdi></p> : null}
      <p className="mt-1 text-[12px] text-[#536b8c]">{t("admin.affiliateStats", { orders: String(row.paidOrders), earned: money({ amount: row.earned, currencyCode: "KWD" }) })}</p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label htmlFor={rateId} className="block">
          <span className="block text-[11px] font-extrabold ink-muted">{t("admin.affiliateRate")}</span>
          <input id={rateId} value={rate} onChange={event => setRate(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr" maxLength={5} className="glass-field mt-1 h-9 w-24 rounded-full px-3 text-sm" />
        </label>
        <button type="button" disabled={update.isPending || rate === row.ratePercent} onClick={() => update.mutate({ affiliateId: row.id, ratePercent: rate })} className="glass type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
          {t("admin.affiliateSetRate")}
        </button>
        {row.status !== "active" ? (
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ affiliateId: row.id, status: "active" })} className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60">
            {t(row.status === "pending" ? "admin.affiliateApprove" : "admin.affiliateReinstate")}
          </button>
        ) : (
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ affiliateId: row.id, status: "suspended" })} className="pressable rounded-full px-4 py-2 text-[12px] font-extrabold text-[#8c2f22]">
            {t("admin.affiliateSuspend")}
          </button>
        )}
      </div>
    </article>
  );
}
