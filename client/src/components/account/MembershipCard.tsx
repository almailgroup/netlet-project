/**
 * The shopper's NetLet membership (4.1), on the account page — drawn only for
 * a member. Nothing offers one to anybody else: buying waits on payments, and
 * a card advertising something nobody can get is a button with nothing behind it.
 */
import { BadgeCheck } from "lucide-react";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMembership } from "@/hooks/useMembership";
import { useMoney, useTranslation } from "@/hooks/useTranslation";

export function MembershipCard() {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const { member, until, freeDeliveryOver } = useMembership();
  if (!member || !until) return null;
  return (
    <section aria-labelledby="membership-card" className="rounded-2xl border border-[#d5dfeb] bg-[#eef3fa] p-5 text-[#0a285a]">
      <h2 id="membership-card" className="flex items-center gap-2 text-[15px] font-extrabold">
        <BadgeCheck className="size-5" aria-hidden />{t("membership.cardTitle")}
      </h2>
      <p className="mt-1 text-[12px] font-bold ink-muted">{t("membership.until", { date: formatDate(until) })}</p>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-6">
        <li>{freeDeliveryOver ? t("membership.benefitDeliveryOver", { amount: money(freeDeliveryOver) }) : t("membership.benefitDelivery")}</li>
        <li>{t("membership.benefitPrices")}</li>
        <li>{t("membership.benefitPriority")}</li>
      </ul>
    </section>
  );
}
