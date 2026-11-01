/**
 * Every return the shopper has asked for, across their orders — the
 * account's Returns page, on the owner's word ("add returns option in the
 * profile page").
 *
 * A return is started from its order (Request a refund, or Return or exchange
 * beside the item), because that is where the item and its window are; this
 * page is where somebody comes back to ask "where is my refund". So each row
 * is the item as the order froze it, with today's photo to know it by, what
 * was asked (a refund or an exchange), where it has got to — the opened
 * order's own words, `STATUS_LABEL` — and the way to the order, where it can
 * still be withdrawn. Read by `orders.myReturns`, scoped to the account in
 * the query.
 *
 * Nothing yet is said in words, with the way to the orders and the policy,
 * rather than as an empty list.
 */
import { PackageSearch, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { QueryGate } from "@/components/admin/QueryGate";
import { STATUS_LABEL } from "@/components/account/LineReturn";
import { PANEL } from "@/components/account/profileParts";
import { BUTTON_PLAIN, BUTTON_PRIMARY, EmptyState } from "@/components/layout/Page";
import { Thumb } from "@/components/product/Thumb";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { isMessageKey } from "@shared/i18n/dictionary";

/** A state's pill: green once the money or the swap is done, red if declined, navy while it moves. */
function tone(status: string): string {
  if (status === "refunded" || status === "exchanged") return "bg-[#e7f3ea] text-[#2f5d33]";
  if (status === "declined") return "bg-[#fbeceb] text-[#8c2f22]";
  if (status === "cancelled") return "bg-[#f1f2f6] text-[#404553]";
  return "bg-[#eef1f6] text-[#0a285a]";
}

export function AccountReturns() {
  const { t, locale } = useTranslation();
  const formatDate = useDateFormat();
  const list = trpc.orders.myReturns.useQuery(undefined, { staleTime: 30_000 });

  return (
    <QueryGate audience="shopper" queries={[list]}>
      {() => {
        const rows = list.data ?? [];
        if (!rows.length) {
          return (
            <EmptyState heading="h3" icon={<RotateCcw className="size-6" />} title={t("returns.mineEmpty")} note={t("returns.mineEmptyNote")}>
              <Link href="/account/orders" className={BUTTON_PRIMARY}>{t("account.myOrders")}</Link>
              <Link href="/returns" className={BUTTON_PLAIN}>{t("returns.policyLink")}</Link>
            </EmptyState>
          );
        }
        return (
          <div className="space-y-3">
            <ul className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-4 sm:px-5`}>
              {rows.map(row => {
                const money = (amount: string | null) => formatMoney(amount ?? "0", { currencyCode: "KWD", locale });
                const next = row.status === "refunded"
                  ? (row.refundPaidAt ? t("returns.refundPaid", { amount: money(row.refundAmount) }) : t("returns.refundDue", { amount: money(row.refundAmount) }))
                  : row.status === "approved" ? t("returns.nextApproved")
                  : row.status === "requested" ? t("returns.nextRequested")
                  : row.status === "review" ? t("returns.nextReview")
                  : row.status === "collected" ? t("returns.nextCollected")
                  : null;
                return (
                  <li key={row.id} className="flex gap-3 py-4">
                    <Thumb
                      src={row.photo}
                      alt=""
                      className="size-16 shrink-0 rounded-xl border border-[#e6e9ef] bg-[#f4f6f9] object-contain"
                      icon={<PackageSearch className="size-5" />}
                    />
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="line-clamp-2 text-[15px] font-bold leading-snug text-[#0a285a]">{row.productTitle}</p>
                      <p className="mt-0.5 text-[13px] ink-muted">
                        {row.variantTitle && row.variantTitle !== "Default" ? <><bdi>{row.variantTitle}</bdi> · </> : null}
                        {t("cart.quantityShort", { count: row.quantity })}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                        <span className={`rounded-full px-2.5 py-0.5 font-bold ${tone(row.status)}`}>
                          {t(row.kind === "exchange" ? "returns.kindExchange" : "returns.kindRefund")} · {t(STATUS_LABEL[row.status] ?? "returns.statusRequested")}
                        </span>
                        <span className="ink-muted">{t("returns.askedOn", { date: formatDate(row.createdAt) })}</span>
                      </p>
                      {next || row.declineReason || (row.status === "exchanged" && row.replacementReference) ? (
                        <p className="mt-1.5 text-[13px] leading-5 text-[#404553]">
                          {next}
                          {row.status === "exchanged" && row.replacementReference ? <>{t("returns.replacementSent")} <bdi dir="ltr">{row.replacementReference}</bdi></> : null}
                          {row.declineReason ? <span dir="auto"> {isMessageKey(row.declineReason) ? t(row.declineReason) : row.declineReason}</span> : null}
                        </p>
                      ) : null}
                      <Link
                        href={`/account/orders?order=${encodeURIComponent(row.orderReference)}`}
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-[13px] font-bold ink-accent hover:underline pointer-fine:min-h-0"
                      >
                        {t("returns.viewOrder")} <bdi dir="ltr" className="font-semibold">{row.orderReference}</bdi>
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-center text-[13px] ink-muted">
              <Link href="/returns" className="font-bold ink-accent hover:underline">{t("returns.policyLink")}</Link>
            </p>
          </div>
        );
      }}
    </QueryGate>
  );
}
