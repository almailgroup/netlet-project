/**
 * The shopper's NetLet membership (4.1), on the account page.
 *
 * A member reads what it gives and until when. **It can be bought with NetLet
 * points, on the owner's word** ("with NetLet points"): once NetLet sets a
 * price in points per month, anybody signed in is offered whole months here,
 * a member to add more. Points are already money inside NetLet, so this is a
 * real way to pay rather than a button waiting on a payment provider; with no
 * price set nothing is offered, as before. Buying asks first, saying the
 * points it spends, and the server asks again under a lock on the account.
 */
import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMembership } from "@/hooks/useMembership";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { buyProblem, membershipCost } from "@shared/commerce/membership";

const MONTH_CHOICES = [1, 3, 6, 12] as const;

export function MembershipCard() {
  const { t, tError, locale } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const { member, until, freeDeliveryOver, pointsPerMonth, points } = useMembership();
  const utils = trpc.useUtils();
  const [months, setMonths] = useState<number>(1);
  const [asking, setAsking] = useState(false);
  const buy = trpc.membership.buy.useMutation({
    onSuccess: answer => {
      setAsking(false);
      toast.success(t("membership.bought", { date: formatDate(answer.endsAt) }));
      void utils.membership.mine.invalidate();
      void utils.rewards.mine.invalidate();
    },
    onError: error => { setAsking(false); toast.error(tError(error.message)); },
  });

  const forSale = pointsPerMonth > 0;
  if (!(member && until) && !forSale) return null;
  const cost = membershipCost(pointsPerMonth, months);
  const problem = forSale ? buyProblem({ pointsPerMonth, months, balance: points }) : null;
  const count = (value: number) => formatCount(value, locale);

  return (
    <section aria-labelledby="membership-card" className="rounded-2xl border border-[#d5dfeb] bg-[#eef3fa] p-5 text-[#0a285a]">
      <h2 id="membership-card" className="flex items-center gap-2 text-[15px] font-extrabold">
        <BadgeCheck className="size-5" aria-hidden />{t(member ? "membership.cardTitle" : "membership.offerTitle")}
      </h2>
      {member && until ? <p className="mt-1 text-[12px] font-bold ink-muted">{t("membership.until", { date: formatDate(until) })}</p> : null}
      <ul className="mt-3 space-y-1.5 text-[13px] leading-6">
        <li>{freeDeliveryOver ? t("membership.benefitDeliveryOver", { amount: money(freeDeliveryOver) }) : t("membership.benefitDelivery")}</li>
        <li>{t("membership.benefitPrices")}</li>
        <li>{t("membership.benefitPriority")}</li>
      </ul>
      {forSale ? (
        <div className="mt-4 border-t border-[#d5dfeb] pt-4">
          <p className="text-[13px] font-semibold">{t("membership.pointsPerMonthLine", { points: count(pointsPerMonth) })}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label htmlFor="membership-months" className="block text-[12px] font-semibold">{t("membership.monthsLabel")}</label>
              <Select id="membership-months" value={String(months)} onChange={event => setMonths(Number(event.target.value))} className="mt-1">
                {MONTH_CHOICES.map(choice => <option key={choice} value={String(choice)}>{t("membership.monthsOption", { months: choice })}</option>)}
              </Select>
            </div>
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={problem !== null || buy.isPending}
              className="inline-flex min-h-11 items-center rounded-full bg-[#0a285a] px-5 text-[14px] font-semibold text-white hover:bg-[#0d3372] disabled:opacity-50"
            >
              {t(member ? "membership.addMonths" : "membership.buy")}
            </button>
          </div>
          <p className={`mt-2 text-[12px] ${problem === "membership.notEnoughPoints" ? "text-[#8c2f22]" : "ink-muted"}`}>
            {problem === "membership.notEnoughPoints"
              ? t("membership.notEnoughPointsLine", { cost: count(cost), points: count(points) })
              : t("membership.costLine", { cost: count(cost), points: count(points) })}
          </p>
        </div>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={t("membership.buyTitle")}
        body={t("membership.buyBody", { months, cost: count(cost) })}
        confirmLabel={t("membership.buyConfirm", { cost: count(cost) })}
        pending={buy.isPending}
        onConfirm={() => buy.mutate({ months })}
        onClose={() => setAsking(false)}
      />
    </section>
  );
}
