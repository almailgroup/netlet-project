/**
 * Affiliate marketing on the account page (3.7): join, share, see what came
 * of it, and ask to be paid.
 *
 * Beside the referral rewards because it is the same ledger, and apart from
 * them because it is a different thing: an invitation is a favour between
 * friends paid in points, an affiliate link is promotion paid in money.
 *
 * Joining asks the affiliate to agree, in words, to say their links are paid.
 * The shopper who arrives is told too, at checkout; the two halves together
 * are what keeps paid promotion from passing itself off as a recommendation.
 */
import { useState } from "react";
import { Copy, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { QueryGate } from "@/components/admin/QueryGate";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { ATTRIBUTION_DAYS, MIN_AFFILIATE_PAYOUT_FILS } from "@shared/commerce/affiliate";
import type { MessageKey } from "@shared/i18n/dictionary";
import { fromFils } from "@shared/money";
import type { AppRouter } from "../../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";

const REASON: Record<string, MessageKey> = {
  affiliate_commission: "affiliate.reasonCommission",
  affiliate_reversal: "affiliate.reasonReversal",
  cashed_out: "affiliate.reasonPayout",
};

const STATUS: Record<string, MessageKey> = {
  pending: "affiliate.statusPending",
  active: "affiliate.statusActive",
  suspended: "affiliate.statusSuspended",
};

export function AccountAffiliate() {
  const { t } = useTranslation();
  const mine = trpc.affiliates.mine.useQuery();
  const on = useFeature("affiliates");

  return (
    <QueryGate audience="shopper" queries={[mine]}>
      {() => (mine.data ? <Dashboard view={mine.data} /> : on ? <Join /> : <p className="text-sm ink-muted">{t("affiliate.switchedOff")}</p>)}
    </QueryGate>
  );
}

function Join() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [displayName, setDisplayName] = useState("");
  const [channel, setChannel] = useState("");
  const [agreed, setAgreed] = useState(false);
  const join = trpc.affiliates.join.useMutation({
    onSuccess: () => { toast.success(t("affiliate.applied")); void utils.affiliates.mine.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <form
      className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:p-6"
      onSubmit={event => { event.preventDefault(); join.mutate({ displayName: displayName.trim(), channel: channel.trim() || null, acceptDisclosure: agreed }); }}
    >
      <p className="flex items-center gap-2 font-extrabold text-[#0a285a]"><Megaphone className="size-5 shrink-0 ink-accent" aria-hidden />{t("affiliate.title")}</p>
      <p className="mt-2 max-w-prose text-sm leading-6 text-[#536b8c]">{t("affiliate.pitch", { days: String(ATTRIBUTION_DAYS) })}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[12px] font-extrabold ink-muted">{t("affiliate.displayName")}</span>
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} required dir="auto" className="glass-field mt-1 h-10 w-full rounded-full px-4 text-sm" />
        </label>
        <label className="block">
          <span className="block text-[12px] font-extrabold ink-muted">{t("affiliate.channel")}</span>
          <input value={channel} onChange={event => setChannel(event.target.value)} maxLength={300} dir="ltr" className="glass-field mt-1 h-10 w-full rounded-full px-4 text-sm" />
        </label>
      </div>
      <label className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-[#0a285a]">
        <input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#0a285a]" />
        {t("affiliate.disclosure")}
      </label>
      <button type="submit" disabled={!agreed || !displayName.trim() || join.isPending} className="glass-navy type-control pressable mt-4 rounded-full px-5 py-2 disabled:opacity-60">
        {t("affiliate.join")}
      </button>
    </form>
  );
}

function Dashboard({ view }: { view: NonNullable<inferRouterOutputs<AppRouter>["affiliates"]["mine"]> }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const link = `${window.location.origin}/?aff=${view.code}`;
  const payout = trpc.affiliates.payout.useMutation({
    onSuccess: reply => { toast.success(t("affiliate.payoutRequested", { amount: amount(reply.amount) })); void utils.affiliates.mine.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-[#f3f2ed] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-extrabold text-[#0a285a]"><Megaphone className="size-5 shrink-0 ink-accent" aria-hidden />{t("affiliate.title")}</p>
          <span className="rounded-full bg-white px-3 py-1 text-[12px] font-extrabold text-[#0a285a]">{t(STATUS[view.status] ?? "affiliate.statusPending")}</span>
        </div>
        {view.status === "pending" ? <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("affiliate.pendingNote")}</p> : null}
        {view.status === "suspended" ? <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("affiliate.suspendedNote")}</p> : null}
        {view.status === "active" ? (
          <>
            <p className="mt-2 max-w-prose text-sm leading-6 text-[#536b8c]">{t("affiliate.howToShare", { rate: view.ratePercent, days: String(ATTRIBUTION_DAYS) })}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <bdi dir="ltr" className="rounded-xl bg-white px-4 py-2 font-mono text-lg font-bold tracking-[.2em] text-[#0a285a]">{view.code}</bdi>
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(link); toast.success(t("affiliate.copied")); } catch { toast.error(t("affiliate.copyFailed")); }
                }}
                className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2"
              >
                <Copy className="size-4" aria-hidden />{t("affiliate.copyLink")}
              </button>
            </div>
            <p className="mt-2 text-[12px] ink-muted">{t("affiliate.anyPage")} <bdi dir="ltr" className="font-mono">?aff={view.code}</bdi></p>
          </>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["affiliate.paidOrders", String(view.paidOrders)],
          ["affiliate.waitingOrders", String(view.waitingOrders)],
          ["affiliate.earned", amount(view.earned)],
          ["affiliate.balance", amount(view.balance)],
        ] as [MessageKey, string][]).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
            <dt className="text-[12px] font-extrabold ink-muted">{t(label)}</dt>
            <dd className="mt-1 text-lg font-extrabold text-[#0a285a]">{value}</dd>
          </div>
        ))}
      </dl>
      {Number(view.reversed) > 0 ? <p className="text-[12px] ink-muted">{t("affiliate.reversedNote", { amount: amount(view.reversed) })}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!view.payout.ok || payout.isPending}
          onClick={() => payout.mutate()}
          className="glass-navy type-control pressable rounded-full px-5 py-2 disabled:opacity-60"
        >
          {t("affiliate.requestPayout")}
        </button>
        <p className="text-[12px] ink-muted">
          {view.payout.ok
            ? t("affiliate.payoutNote")
            : t("affiliate.payoutShort", { minimum: amount(fromFils(MIN_AFFILIATE_PAYOUT_FILS)), short: amount(view.payout.shortBy) })}
        </p>
      </div>

      {view.entries.length > 0 ? (
        <ul className="divide-y divide-[#eef1f6] rounded-2xl border border-[#e6e9ef] bg-white">
          {view.entries.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-[13px]">
              <span className="text-[#0a285a]">
                {t(REASON[entry.reason] ?? "affiliate.reasonCommission")}
                {entry.orderReference ? <> · <bdi dir="ltr">{entry.orderReference}</bdi></> : null}
                {entry.reason === "cashed_out" ? <span className="ink-muted"> · {t(entry.settledAt ? "affiliate.paid" : "affiliate.notYetPaid")}</span> : null}
              </span>
              <span className="font-extrabold text-[#0a285a]"><bdi dir="ltr">{amount(entry.amount)}</bdi> <span className="font-normal ink-muted">{formatDate(entry.createdAt)}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
