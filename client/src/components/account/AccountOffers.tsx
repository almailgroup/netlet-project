/**
 * The special prices this shopper asked for, and where each stands.
 *
 * Requirement 3.1.13. The product page is where a request is made and where
 * its state is read back, which covers somebody who returns to the product —
 * but an answered price runs out in days, and expecting a shopper to remember
 * which of four things they asked about is how a seller's yes goes unused.
 *
 * Each row links back to the product, because the only useful thing to do with
 * an agreed price is buy the thing.
 */
import { Link } from "wouter";
import { appPath } from "@/lib/basePath";
import { daysLeft } from "@shared/commerce/priceOffers";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { QueryGate } from "@/components/admin/QueryGate";

const STATE_LABEL: Record<string, MessageKey> = {
  pending: "offers.statusPending",
  offered: "offers.statusOffered",
  declined: "offers.statusDeclined",
  expired: "offers.statusExpired",
  withdrawn: "offers.statusWithdrawn",
  used: "offers.statusUsed",
};

export function AccountOffers() {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const list = trpc.offers.list.useQuery();
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <QueryGate audience="shopper" queries={[list]}>
      {() => {
        const rows = list.data ?? [];
        if (!rows.length) {
          return <p className="text-sm leading-6 text-[#536b8c]">{t("offers.mineEmpty")}</p>;
        }
        return (
          <ul className="space-y-2">
            {rows.map(row => {
              const left = daysLeft({
                status: "offered",
                offeredPrice: row.offeredPrice,
                expiresAt: row.expiresAt,
                usedOnOrderId: null,
              });
              return (
                <li key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    {row.productHandle ? (
                      <Link href={appPath(`/products/${encodeURIComponent(row.productHandle)}`)} className="font-bold text-[#0a285a] hover:underline">
                        <span dir="auto">{row.productTitle}</span>
                      </Link>
                    ) : (
                      <span dir="auto" className="font-bold text-[#0a285a]">{row.productTitle}</span>
                    )}
                    <span className="text-[12px] font-semibold ink-muted">
                      {row.state === "offered" && row.offeredPrice
                        ? t("offers.statusOffered", { price: amount(row.offeredPrice) })
                        : t(STATE_LABEL[row.state])}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] ink-muted">
                    {row.state === "offered"
                      /* The last hours are their own sentence: "0 days left" on
                         a price somebody can still spend would be a lie. */
                      ? left === null || left <= 1
                        ? t("offers.statusOfferedToday")
                        : t("offers.statusOfferedNote", { days: String(left) })
                      : t("offers.statusPendingNote", {
                          price: amount(row.askedPrice),
                          date: row.expiresAt ? formatDate(row.expiresAt) : "—",
                        })}
                  </p>
                  {row.vendorNote ? (
                    <p dir="auto" className="mt-1 text-[12px] leading-5 text-[#404553]">
                      {t("offers.sellerSaid", { note: row.vendorNote })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        );
      }}
    </QueryGate>
  );
}
