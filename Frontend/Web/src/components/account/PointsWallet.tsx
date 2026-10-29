/**
 * The NetLet points balance as a card: the coin, the number, what it is worth,
 * what is still held, and converting it to money (3.1.15). One card for the
 * two pages that show a balance — the points page and the affiliate page — so
 * the figure and the button cannot say two things.
 *
 * **A point is a fil, and the card says so** (`FILS_PER_POINT`): "1 point =
 * 1 fils" is the sentence that turns a number of points into money somebody
 * can weigh, on the owner's word. Both values are on it, spent in the shop and
 * converted, because "spend it or convert it" is a choice and a card showing
 * one figure has made it for them.
 *
 * **Converting asks first**: it takes the whole balance and is the one press
 * here that moves money, so it names the figure in a confirmation whose
 * button carries the verb, the rule every money act on the site follows.
 */
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

export type RewardsView = inferRouterOutputs<AppRouter>["rewards"]["mine"];

export function PointsWallet({ view }: { view: RewardsView }) {
  const { t, tError, locale } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [asking, setAsking] = useState(false);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const convert = trpc.rewards.cashOut.useMutation({
    onSuccess: () => {
      toast.success(t("rewards.cashOutRequested"));
      setAsking(false);
      void utils.rewards.mine.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <section aria-labelledby="points-wallet" className="overflow-hidden rounded-[1.35rem] bg-[#0a285a] p-5 text-white shadow-[0_10px_30px_-18px_rgba(10,40,90,.8)] sm:p-6">
      <div className="flex items-center gap-3.5">
        <PointsCoin size={48} />
        <div className="min-w-0">
          <h3 id="points-wallet" className="text-[13px] font-semibold text-[#c9d3e3]">{t("rewards.yourPoints")}</h3>
          <p className="text-[32px] font-extrabold leading-tight tracking-tight">
            <bdi>{formatCount(view.balance, locale)}</bdi>
          </p>
        </div>
      </div>

      {/* Both values, never one: spending it and converting it are a choice. */}
      <p className="mt-3 text-[14px] leading-6 text-[#e3e8f0]">
        {t("rewards.worthInShop", { value: amount(view.spendValue) })} {t("rewards.worthInCash", { value: amount(view.cashOutValue) })}
      </p>
      <p className="text-[13px] leading-6 text-[#c9d3e3]">{t("rewards.pointValue", { value: amount("1.000") })}</p>

      {/* Earned and not yet spendable: a sale that may still come back. */}
      {view.held > 0 ? (
        <p className="mt-3 rounded-xl bg-white/10 px-3.5 py-2.5 text-[13px] leading-5 text-[#e3e8f0]">
          {t("rewards.held", { points: formatCount(view.held, locale) })}
          {view.nextRelease ? <> {t("rewards.nextRelease", { date: formatDate(view.nextRelease) })}</> : null}
        </p>
      ) : null}

      <div className="mt-4 border-t border-white/15 pt-4">
        {view.cashOut.ok ? (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5] sm:w-auto"
          >
            <ArrowRightLeft className="size-4" aria-hidden />
            {t("rewards.convert")}
          </button>
        ) : (
          /* The refusal names the figure and the shortfall, the way the
             password checklist names the unmet rule rather than going red. */
          <p className="text-[13px] leading-5 text-[#c9d3e3]">
            {t("rewards.cashOutFloor", { minimum: formatCount(view.minimumCashOut, locale), short: formatCount(view.cashOut.shortBy, locale) })}
          </p>
        )}
        <p className="mt-2 text-[12px] leading-5 text-[#c9d3e3]">{t("rewards.rateNote")}</p>
      </div>

      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t("rewards.convertTitle")}
        body={t("rewards.convertBody", { points: formatCount(view.balance, locale), value: amount(view.cashOutValue) })}
        confirmLabel={t("rewards.convert")}
        icon={<PointsCoin size={28} />}
        pending={convert.isPending}
        onConfirm={() => convert.mutate()}
      />
    </section>
  );
}
