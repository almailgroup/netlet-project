/**
 * NetLet points, on the account page (3.1.14, 3.1.15): the balance with the
 * coin and converting it to money (`PointsWallet`), the two ways to earn, and
 * the history behind the number.
 *
 * **The ways to earn are two cards, and affiliate marketing leads**, on the
 * owner's word — sharing a product and earning on the sale is the one a
 * shopper does again and again. Inviting a friend follows, with the code: the
 * only thing on this page somebody can hand to somebody else.
 *
 * **It says how many arrived and never who.** A code is meant to be pasted
 * into a group chat, so anybody may be holding it — and a list of names would
 * turn that into a way of asking which strangers have registered. The server
 * does not send them either; this is not the only place that rule lives.
 */
import { useState } from "react";
import { appPath } from "@/lib/basePath";
import { ChevronRight, Copy, Megaphone, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { spendValue } from "@shared/commerce/referral";
import type { MessageKey } from "@shared/i18n/dictionary";
import { PointsWallet } from "@/components/account/PointsWallet";
import { PANEL } from "@/components/account/profileParts";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { isolate } from "@/lib/isolate";
import { QueryGate } from "@/components/admin/QueryGate";

const REASON_LABEL: Record<string, MessageKey> = {
  referrer_bonus: "rewards.reasonReferrerBonus",
  referred_welcome: "rewards.reasonReferredWelcome",
  spent_on_order: "rewards.reasonSpentOnOrder",
  cashed_out: "rewards.reasonCashedOut",
  admin_adjustment: "rewards.reasonAdminAdjustment",
  order_cancelled: "rewards.reasonOrderCancelled",
  product_referral: "rewards.reasonProductReferral",
  invite_commission: "rewards.reasonInviteCommission",
  product_referral_reversal: "rewards.reasonProductReferralReversal",
  invite_commission_reversal: "rewards.reasonInviteCommissionReversal",
};

export function AccountRewards() {
  const { t, locale } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const rewards = trpc.rewards.mine.useQuery();
  const affiliatesOn = useFeature("affiliates");
  const affiliate = trpc.affiliates.mine.useQuery(undefined, { staleTime: 60_000 });
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <QueryGate audience="shopper" queries={[rewards]}>
      {() => {
        const view = rewards.data;
        if (!view) return null;
        /* Joined is a row; earning is an active one. A suspended member is
           told so here, never offered "Join" again. */
        const joined = Boolean(affiliate.data);
        const member = affiliate.data?.status === "active";

        return (
          <div className="space-y-3">
            <PointsWallet view={view} />

            <section aria-labelledby="ways-to-earn" className="space-y-3">
              <h3 id="ways-to-earn" className="px-1 pt-2 text-[15px] font-bold text-[#0a285a]">{t("rewards.waysToEarn")}</h3>

              {affiliatesOn || affiliate.data ? (
                <Link href="/account/affiliate" className={`${PANEL} flex items-center gap-3.5 p-4 hover:bg-[#f0f2f5] sm:p-5`}>
                  <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-[#fff1e8] text-[#a44a2b]">
                    <Megaphone className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-[#0a285a]">{t("affiliate.section")}</span>
                    <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{t(joined ? "rewards.earnAffiliateMember" : "rewards.earnAffiliate")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#f1f2f6] px-3 py-1.5 text-[13px] font-bold text-[#0a285a]">
                    {member ? t("affiliate.statusActive") : joined ? t("affiliate.statusSuspended") : t("affiliate.promoJoin")}
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-[#1f2a44] rtl:-scale-x-100" aria-hidden />
                </Link>
              ) : null}

              <InviteCard code={view.code} invited={view.invited} qualified={view.qualified} />
            </section>

            <section aria-labelledby="points-history" className={`${PANEL} p-4 sm:p-5`}>
              <h3 id="points-history" className="text-[15px] font-bold text-[#0a285a]">{t("rewards.ledger")}</h3>
              {view.entries.length === 0 ? (
                <p className="mt-2 text-sm leading-6 ink-muted">{t("rewards.empty")}</p>
              ) : (
                <ul className="mt-2 divide-y divide-dashed divide-[#e3e6ec]">
                  {view.entries.map(entry => (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <PointsCoin size={22} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-[#1f2a44]">
                          {t(REASON_LABEL[entry.reason] ?? "rewards.reasonAdminAdjustment")}
                        </span>
                        <span className="block text-[12px] leading-5 ink-muted">
                          {formatDate(entry.createdAt)}
                          {entry.orderReference ? <> · {t("rewards.onOrder", { reference: isolate(entry.orderReference) })}</> : null}
                          {entry.reason === "cashed_out" ? (
                            <> · {entry.settledAt ? t("rewards.paidOn", { date: formatDate(entry.settledAt) }) : t("rewards.awaitingPayment")}</>
                          ) : null}
                          {entry.reason === "spent_on_order" && !entry.orderReference
                            ? <> · {amount(spendValue(-entry.points))}</>
                            : null}
                          {entry.availableAt ? <> · {t("rewards.availableFrom", { date: formatDate(entry.availableAt) })}</> : null}
                        </span>
                      </span>
                      <span className={`shrink-0 text-[15px] font-extrabold ${entry.points < 0 ? "text-[#536b8c]" : "text-[#2f5d33]"}`}>
                        <bdi dir="ltr">{entry.points > 0 ? "+" : "−"}{formatCount(Math.abs(entry.points), locale)}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        );
      }}
    </QueryGate>
  );
}

/** Inviting a friend: the code, the link, and how many arrived through it. */
function InviteCard({ code, invited, qualified }: { code: string; invited: number; qualified: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  /* The link a friend actually opens. Built from where the page is being read
     rather than from a configured origin, so it is right on a preview
     deployment and on a laptop — the rule `SITE_URL` follows. */
  const link = `${window.location.origin}${appPath("/")}?ref=${code}`;

  return (
    <div className={`${PANEL} p-4 sm:p-5`}>
      <div className="flex items-center gap-3.5">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eef2f8] text-[#0a285a]">
          <UserPlus className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-[#0a285a]">{t("rewards.title")}</span>
          <span className="mt-0.5 block text-[13px] leading-5 ink-muted">{t("rewards.codeHelp")}</span>
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-[12px] font-semibold ink-muted">{t("rewards.codeLabel")}</p>
        {/* Latin characters inside an Arabic line: `bdi` keeps the code
            reading left to right without throwing the line to the far edge,
            which is what `dir` on the block around it would do. */}
        <bdi dir="ltr" className="rounded-xl bg-[#f3f2ed] px-4 py-2 font-mono text-lg font-bold tracking-[.2em] text-[#0a285a]">
          {code}
        </bdi>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              toast.success(t("rewards.copied"));
            } catch {
              toast.error(t("affiliate.copyFailed"));
            }
          }}
          className="glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2"
        >
          <Copy className="size-4" aria-hidden /> {copied ? t("rewards.copied") : t("rewards.copy")}
        </button>
      </div>

      <p className="mt-3 text-[13px] text-[#536b8c]">
        {t("rewards.invited", { count: invited })} · {t("rewards.qualified", { count: qualified })}
      </p>
      <p className="mt-1 text-[12px] leading-5 text-[#536b8c]">{t("rewards.privacy")}</p>
    </div>
  );
}
