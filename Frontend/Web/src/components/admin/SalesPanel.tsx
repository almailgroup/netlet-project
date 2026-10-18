/**
 * The overview's business numbers: sales, orders, average order and returns
 * for a chosen period, thirty days of sales by day, and what sold most.
 *
 * The figures are `inventory.sales`, scoped on the server — the whole shop for
 * an administrator, a store's own lines for its manager or owner — and drawn
 * only for a rank that reads payouts, since that is the rank allowed to see
 * the store's takings.
 *
 * **The chart is a row of bars in the page's direction**, so in Arabic the
 * days run from the right, the way the page reads. It is one image to a
 * screen reader, named by a sentence that says the total and the best day,
 * with the day-by-day figures in a table only a screen reader is given; each
 * bar carries its own figures as a tooltip for a pointer.
 */
import { Card, SectionHeading, Segmented, Stat, StatGrid } from "@/components/admin/ui";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { SalesSummary } from "@shared/commerce/salesSummary";
import { useState } from "react";
import { Link } from "wouter";

type Period = "today" | "week" | "month";

export function SalesPanel() {
  const { t } = useTranslation();
  const money = useMoney();
  const sales = trpc.inventory.sales.useQuery(undefined, { retry: false });
  const [period, setPeriod] = useState<Period>("week");
  if (!sales.data) return null;
  const figures = sales.data.periods[period];

  return (
    <section aria-labelledby="sales-title" className="mt-8">
      <SectionHeading
        description={t("admin.salesNote")}
        actions={(
          <Segmented
            label={t("admin.periodLabel")}
            value={period}
            onChange={setPeriod}
            options={[
              { value: "today", label: t("admin.periodToday") },
              { value: "week", label: t("admin.period7") },
              { value: "month", label: t("admin.period30") },
            ]}
          />
        )}
      >
        <span id="sales-title">{t("admin.salesTitle")}</span>
      </SectionHeading>
      <StatGrid>
        <Stat label={t("admin.salesTitle")} value={money(figures.sales)} />
        <Stat label={t("admin.statOrders")} value={<bdi dir="ltr">{figures.orders}</bdi>} />
        <Stat label={t("admin.statAverage")} value={figures.orders ? money(figures.averageOrder) : "—"} />
        <Stat label={t("admin.statReturns")} value={<bdi dir="ltr">{figures.returns}</bdi>} href="/admin/returns" />
      </StatGrid>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={t("admin.chartTitle")}>
          <DailyChart daily={sales.data.daily} />
        </Card>
        <Card title={t("admin.topSellers")}>
          {sales.data.top.length === 0 ? (
            <p className="text-[14px] ink-muted">{t("admin.noSalesYet")}</p>
          ) : (
            <ol className="space-y-2.5">
              {sales.data.top.map((entry, index) => (
                <li key={`${entry.productId ?? entry.title}`} className="flex items-baseline gap-3 text-[14px]">
                  <span className="w-5 shrink-0 text-end font-bold tabular-nums ink-muted"><bdi dir="ltr">{index + 1}</bdi></span>
                  <span className="min-w-0 flex-1">
                    {entry.productId ? (
                      <Link href={`/admin/products/${entry.productId}`} dir="auto" className="block truncate font-semibold text-[#0a285a] hover:underline">{entry.title}</Link>
                    ) : (
                      <span dir="auto" className="block truncate font-semibold text-[#0a285a]">{entry.title}</span>
                    )}
                    <span className="text-[12px] ink-muted">{t("admin.topUnits", { count: entry.units })}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-[#0a285a]">{money(entry.sales)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </section>
  );
}

function DailyChart({ daily }: { daily: SalesSummary["daily"] }) {
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  /* A Kuwaiti day as "12 Oct": read at noon UTC so no zone can move it a day. */
  const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const amounts = daily.map(entry => Number(entry.sales));
  const max = Math.max(...amounts, 0);
  if (max === 0) return <p className="text-[14px] ink-muted">{t("admin.noSalesYet")}</p>;
  const total = daily.reduce((sum, entry) => sum + Number(entry.sales), 0);
  const best = daily[amounts.indexOf(max)];
  const summary = t("admin.chartSummary", { total: money(total.toFixed(3)), day: dayLabel(best.day), best: money(best.sales) });

  return (
    <div className="relative">
      <p className="text-[13px] leading-5 ink-muted">{summary}</p>
      <div role="img" aria-label={summary} className="mt-3 flex h-40 items-end gap-[3px] border-b border-[#d5dfeb]">
        {daily.map(entry => {
          const share = Number(entry.sales) / max;
          return (
            <div
              key={entry.day}
              title={t("admin.chartBar", { day: dayLabel(entry.day), amount: money(entry.sales), orders: entry.orders })}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={`w-full rounded-t-[3px] ${share > 0 ? "bg-[#0a285a] hover:bg-[#0d3372]" : ""}`}
                style={{ height: share > 0 ? `${Math.max(share * 100, 2)}%` : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] ink-muted">
        <span>{dayLabel(daily[0].day)}</span>
        <span>{dayLabel(daily[daily.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>{t("admin.chartTitle")}</caption>
        <thead><tr><th scope="col">{t("admin.chartDay")}</th><th scope="col">{t("admin.salesTitle")}</th><th scope="col">{t("admin.statOrders")}</th></tr></thead>
        <tbody>
          {daily.map(entry => <tr key={entry.day}><th scope="row">{dayLabel(entry.day)}</th><td>{money(entry.sales)}</td><td>{entry.orders}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
