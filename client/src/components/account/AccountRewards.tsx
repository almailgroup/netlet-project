/**
 * Invitations and points, on the account page.
 *
 * Requirements 3.1.14 and 3.1.15. Three things are shown and each earns its
 * place: the code, because it is the only thing here somebody can act on; the
 * balance in *both* of its values, because "spend it or cash it out" is a
 * choice and a page showing one figure has made it for them; and the ledger,
 * because a number that went up is not something a shopper can check.
 *
 * **It says how many arrived and never who.** A code is meant to be pasted
 * into a group chat, so anybody may be holding it — and a list of names would
 * turn that into a way of asking which strangers have registered. The server
 * does not send them either; this is not the only place that rule lives.
 */
import { useState } from "react";
import { Copy, Gift } from "lucide-react";
import { toast } from "sonner";
import { spendValue } from "@shared/commerce/referral";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isolate } from "@/lib/isolate";
import { QueryGate } from "@/components/admin/QueryGate";

const REASON_LABEL: Record<string, MessageKey> = {
  referrer_bonus: "rewards.reasonReferrerBonus",
  referred_welcome: "rewards.reasonReferredWelcome",
  spent_on_order: "rewards.reasonSpentOnOrder",
  cashed_out: "rewards.reasonCashedOut",
  admin_adjustment: "rewards.reasonAdminAdjustment",
};

export function AccountRewards() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const rewards = trpc.rewards.mine.useQuery();
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);

  const cashOut = trpc.rewards.cashOut.useMutation({
    onSuccess: () => {
      toast.success(t("rewards.cashOutRequested"));
      void utils.rewards.mine.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <QueryGate audience="shopper" queries={[rewards]}>
      {() => {
        const view = rewards.data;
        if (!view) return null;
        /* The link a friend actually opens. Built from where the page is being
           read rather than from a configured origin, so it is right on a
           preview deployment and on a laptop — the rule `SITE_URL` follows. */
        const link = `${window.location.origin}/?ref=${view.code}`;

        return (
          <div className="space-y-5">
            <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-[#f3f2ed] p-5 sm:p-6">
              <p className="flex items-center gap-2 font-extrabold text-[#0a285a]">
                <Gift className="size-5 shrink-0 ink-accent" aria-hidden /> {t("rewards.title")}
              </p>
              <p className="mt-2 max-w-prose text-sm leading-6 text-[#536b8c]">{t("rewards.codeHelp")}</p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="type-label ink-muted">{t("rewards.codeLabel")}</p>
                {/* Latin characters inside an Arabic line: `bdi` keeps the code
                    reading left to right without throwing the line to the far
                    edge, which is what `dir` on the block around it would do. */}
                <bdi dir="ltr" className="rounded-xl bg-white px-4 py-2 font-mono text-lg font-bold tracking-[.2em] text-[#0a285a]">
                  {view.code}
                </bdi>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                    toast.success(t("rewards.copied"));
                  }}
                  className="glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2"
                >
                  <Copy className="size-4" aria-hidden /> {copied ? t("rewards.copied") : t("rewards.copy")}
                </button>
              </div>

              <p className="mt-4 text-sm text-[#536b8c]">
                {t("rewards.invited", { count: view.invited })} · {t("rewards.qualified", { count: view.qualified })}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#536b8c]">{t("rewards.privacy")}</p>
            </div>

            <div className="rounded-[1.35rem] border border-[#e6e9ef] bg-white p-5 sm:p-6">
              <p className="text-2xl font-extrabold text-[#0a285a]">{t("rewards.balance", { points: view.balance })}</p>
              {/* Both values, never one. "Spend it or cash it out" is a choice,
                  and a page showing a single figure has made it for them. */}
              <p className="mt-1 text-sm text-[#536b8c]">
                {t("rewards.worthInShop", { value: amount(view.spendValue) })} ·{" "}
                {t("rewards.worthInCash", { value: amount(view.cashOutValue) })}
              </p>
              <p className="mt-2 max-w-prose text-xs leading-5 text-[#536b8c]">{t("rewards.rateNote")}</p>

              {view.cashOut.ok ? (
                <button
                  type="button"
                  disabled={cashOut.isPending}
                  onClick={() => cashOut.mutate()}
                  className="glass-navy type-control pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 disabled:opacity-60"
                >
                  {t("rewards.cashOut", { points: view.balance, value: amount(view.cashOutValue) })}
                </button>
              ) : (
                /* The refusal names the figure and the shortfall, the way the
                   password meter names the unmet rule rather than going red. */
                <p className="mt-4 text-sm text-[#536b8c]">
                  {t("rewards.cashOutFloor", { minimum: view.minimumCashOut, short: view.cashOut.shortBy })}
                </p>
              )}
            </div>

            <div>
              <h3 className="type-label ink-muted">{t("rewards.ledger")}</h3>
              {view.entries.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("rewards.empty")}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {view.entries.map(entry => (
                    <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border border-[#e6e9ef] bg-white px-4 py-3">
                      <span className="text-sm font-bold text-[#0a285a]">
                        {t(REASON_LABEL[entry.reason] ?? "rewards.reasonAdminAdjustment")}
                      </span>
                      <span className={`text-sm font-extrabold ${entry.points < 0 ? "text-[#536b8c]" : "text-[#2f5d33]"}`}>
                        {entry.points > 0 ? "+" : ""}{entry.points}
                      </span>
                      <span className="w-full text-xs text-[#536b8c]">
                        {formatDate(entry.createdAt)}
                        {entry.orderReference ? <> · {t("rewards.onOrder", { reference: isolate(entry.orderReference) })}</> : null}
                        {entry.reason === "cashed_out" ? (
                          <> · {entry.settledAt ? t("rewards.paidOn", { date: formatDate(entry.settledAt) }) : t("rewards.awaitingPayment")}</>
                        ) : null}
                        {entry.reason === "spent_on_order" && !entry.orderReference
                          ? <> · {amount(spendValue(-entry.points))}</>
                          : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      }}
    </QueryGate>
  );
}
