/**
 * The overview's dashboard: four figures with how they moved, the sales line
 * with its estimate, revenue by department, the shelf's health, who bought
 * and who joined, and what sold most (`Shared/commerce/dashboard.ts` is the
 * arithmetic, `inventory.dashboard` the read).
 *
 * **The sales line is the page's one bold thing**: the widest card, the
 * deep indigo with its gradient beneath it. Everything around it is quiet —
 * white cards on the cool ground, each figure's colour a small plate beside it
 * and its own sparkline, never a wash behind the words.
 *
 * Scoped like the sales summary: an administrator reads the whole shop, a
 * store's manager or owner their own lines and shelf, and the accounts line is
 * NetLet's alone. A rank that reads the shelf and not the money (`staff`) gets
 * the shelf's card on its own.
 */
import { MiniBars, SegmentedBar, SERIES, Sparkline, STATUS, TrendChart, Legend, SERIES_GREY } from "@/components/admin/charts";
import { surfaceClass } from "@/components/admin/ui";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { departmentLabel } from "@shared/ai/copilot";
import { wholePercents, type Dashboard, type StockHealth } from "@shared/commerce/dashboard";
import type { MessageKey } from "@shared/i18n/dictionary";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Coins, ReceiptText, ShoppingBag, TrendingDown, TrendingUp, Users, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "wouter";

/** "12 Oct", a Kuwaiti day read at noon UTC so no zone can move it. */
export function useDayLabel() {
  const { isArabic } = useTranslation();
  return (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Today, spelled out, on Kuwait's calendar. */
export function useToday() {
  const { isArabic } = useTranslation();
  return new Date().toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: SHOP_TIME_ZONE });
}

/** A card on the dashboard: a heading, a line on what it shows, and its body. */
export function Panel({ title, note, action, className = "", children, id }: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <section aria-labelledby={id} className={`min-w-0 p-5 ${surfaceClass} ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] leading-6 font-bold text-[#0a285a]">{title}</h2>
          {note ? <p className="mt-0.5 text-[12px] leading-5 ink-muted">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** How a figure moved against the period before, said with an arrow and a word. */
function ChangeLine({ change, days }: { change: number | null; days: number }) {
  const { t } = useTranslation();
  if (change === null) return <p className="text-[12px] ink-muted">{t("dashboard.noCompare")}</p>;
  const up = change > 0;
  const flat = change === 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[12px]">
      {flat ? (
        <span className="font-semibold text-[#536b8c]">{t("dashboard.flat")}</span>
      ) : (
        <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-[#006300]" : "text-[#b42318]"}`}>
          <Icon className="size-3.5 rtl:-scale-x-100" aria-hidden />
          {t(up ? "dashboard.up" : "dashboard.down", { change: Math.abs(Math.round(change * 10) / 10) })}
        </span>
      )}
      <span className="ink-muted">{t("dashboard.vsPrevious", { days })}</span>
    </p>
  );
}

function Kpi({ label, value, change, days, series, color, icon }: {
  label: string;
  value: ReactNode;
  change: number | null;
  days: number;
  series: number[];
  color: string;
  icon: ReactNode;
}) {
  return (
    <li className={`flex min-w-0 flex-col gap-2.5 p-4 sm:p-5 ${surfaceClass}`}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]" style={{ background: `${color}14`, color }}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold ink-muted">{label}</span>
        <Sparkline values={series} color={color} width={72} height={28} />
      </div>
      {/* The figure has the card's whole width: beside the sparkline a
          dinar amount was cut to "KWD 4…". */}
      <span className="text-[22px] leading-8 font-extrabold tabular-nums text-[#0a285a] sm:text-[24px]">{value}</span>
      <ChangeLine change={change} days={days} />
    </li>
  );
}

export function KpiRow({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { totals, days, range } = board;
  return (
    <ul className="grid grid-cols-1 gap-3 @md:grid-cols-2 @5xl:grid-cols-4">
      <Kpi label={t("dashboard.sales")} value={money(totals.sales.current)} change={totals.sales.change} days={range} series={days.map(day => Number(day.sales))} color={SERIES[0]} icon={<Coins />} />
      <Kpi label={t("dashboard.orders")} value={<bdi dir="ltr">{totals.orders.current}</bdi>} change={totals.orders.change} days={range} series={days.map(day => day.orders)} color={SERIES[2]} icon={<ReceiptText />} />
      <Kpi label={t("dashboard.averageOrder")} value={totals.orders.current ? money(totals.averageOrder.current) : "—"} change={totals.averageOrder.change} days={range} series={days.map(day => Number(day.averageOrder))} color={SERIES[1]} icon={<ShoppingBag />} />
      <Kpi label={t("dashboard.customers")} value={<bdi dir="ltr">{totals.customers.current}</bdi>} change={totals.customers.change} days={range} series={days.map(day => day.customers)} color={SERIES[4]} icon={<Users />} />
    </ul>
  );
}

export function TrendPanel({ board, className = "" }: { board: Dashboard; className?: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayLabel();
  const [table, setTable] = useState(false);
  const points = board.days.map((entry, index) => ({ day: entry.day, value: Number(entry.sales), before: Number(board.previousDays[index]?.sales ?? 0), orders: entry.orders }));
  const forecast = board.forecast.map(entry => ({ day: entry.day, value: Number(entry.sales) }));
  const summary = t("dashboard.chartLabel", { from: day(board.days[0].day), to: day(board.days[board.days.length - 1].day) });
  return (
    <Panel
      id="trend-title"
      title={t("dashboard.trendTitle")}
      note={t("dashboard.trendNote")}
      className={className}
      action={(
        <button type="button" onClick={() => setTable(shown => !shown)} aria-pressed={table} className="inline-flex h-9 items-center rounded-lg border border-[#dfe5ee] px-3 text-[12px] font-semibold text-[#0a285a] hover:bg-[#f0f2f5]">
          {table ? t("dashboard.showChart") : t("dashboard.showTable")}
        </button>
      )}
    >
      {table ? (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-[#eef1f6]">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{t("dashboard.trendTitle")}</caption>
            <thead className="sticky top-0 bg-[#f8fafc] text-[12px] text-[#536b8c]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{t("dashboard.columnDay")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("dashboard.columnSales")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("dashboard.columnBefore")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("dashboard.columnOrders")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-[#0a285a]">
              {points.map(point => (
                <tr key={point.day} className="border-t border-[#f1f4f8]">
                  <th scope="row" className="px-3 py-1.5 text-start font-medium">{day(point.day)}</th>
                  <td className="px-3 py-1.5 text-end">{money(point.value.toFixed(3))}</td>
                  <td className="px-3 py-1.5 text-end text-[#536b8c]">{money(point.before.toFixed(3))}</td>
                  <td className="px-3 py-1.5 text-end"><bdi dir="ltr">{point.orders}</bdi></td>
                </tr>
              ))}
              {forecast.map(point => (
                <tr key={point.day} className="border-t border-[#f1f4f8] bg-[#f7f7fe]">
                  <th scope="row" className="px-3 py-1.5 text-start font-medium">{day(point.day)} <span className="text-[11px] font-normal text-[#536b8c]">({t("dashboard.columnEstimate")})</span></th>
                  <td className="px-3 py-1.5 text-end">{money(point.value.toFixed(3))}</td>
                  <td className="px-3 py-1.5 text-end text-[#536b8c]">—</td>
                  <td className="px-3 py-1.5 text-end text-[#536b8c]">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <Legend items={[
            { label: t("dashboard.seriesThis"), color: SERIES[0] },
            { label: t("dashboard.seriesBefore"), color: SERIES_GREY },
            { label: t("dashboard.seriesForecast"), color: SERIES[0], dashed: true },
          ]} />
          <div className="mt-3">
            <TrendChart
              points={points}
              forecast={forecast}
              money={value => money(value.toFixed(3))}
              day={day}
              labels={{
                current: t("dashboard.seriesThis"),
                before: t("dashboard.seriesBefore"),
                forecast: t("dashboard.seriesForecast"),
                orders: count => t("dashboard.ordersOn", { count }),
                summary,
              }}
            />
          </div>
        </>
      )}
      <p className="mt-3 text-[12px] leading-5 ink-muted">{t("dashboard.forecastNote")}</p>
    </Panel>
  );
}

export function DepartmentsPanel({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <Panel id="departments-title" title={t("dashboard.departmentsTitle")} note={t("dashboard.departmentsNote")}>
      {board.departments.length === 0 ? (
        <p className="text-[14px] ink-muted">{t("dashboard.noSales")}</p>
      ) : (
        <SegmentedBar
          label={t("dashboard.departmentsTitle")}
          segments={board.departments.map((entry, index) => ({
            key: entry.other ? "other" : entry.slug ?? "unfiled",
            label: entry.other ? t("dashboard.otherDepartments") : t(departmentLabel(entry.slug)),
            value: money(entry.sales),
            percent: entry.percent,
            color: SERIES[index % SERIES.length],
          }))}
        />
      )}
    </Panel>
  );
}

const STOCK_STATES: { key: keyof StockHealth; label: MessageKey; color: string; icon: ReactNode }[] = [
  { key: "healthy", label: "dashboard.stockHealthy", color: STATUS.good, icon: <CheckCircle2 aria-hidden className="size-4 shrink-0 text-[#0a7a0a]" /> },
  { key: "low", label: "dashboard.stockLow", color: STATUS.warning, icon: <AlertTriangle aria-hidden className="size-4 shrink-0 text-[#8a5a00]" /> },
  { key: "out", label: "dashboard.stockOut", color: STATUS.critical, icon: <XCircle aria-hidden className="size-4 shrink-0 text-[#b42318]" /> },
  { key: "preorder", label: "dashboard.stockPreorder", color: "#64748b", icon: <Clock aria-hidden className="size-4 shrink-0 text-[#475569]" /> },
];

export function StockPanel({ stock }: { stock: StockHealth }) {
  const { t } = useTranslation();
  const total = stock.healthy + stock.low + stock.out + stock.preorder;
  const percents = wholePercents(STOCK_STATES.map(state => BigInt(stock[state.key])));
  return (
    <Panel
      id="stock-title"
      title={t("dashboard.stockTitle")}
      note={t("dashboard.stockNote")}
      action={(
        <Link href="/admin/stock" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#0a285a] hover:bg-[#0a285a]/[.06]">
          {t("dashboard.openStock")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
    >
      {total === 0 ? (
        <p className="text-[14px] ink-muted">{t("dashboard.stockNone")}</p>
      ) : (
        <SegmentedBar
          label={t("dashboard.stockTitle")}
          segments={STOCK_STATES.map((state, index) => ({
            key: state.key,
            label: t(state.label),
            value: String(stock[state.key]),
            percent: percents[index],
            color: state.color,
            icon: state.icon,
          }))}
        />
      )}
    </Panel>
  );
}

export function ActivityPanel({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const day = useDayLabel();
  const customers = board.days.map(entry => ({ day: entry.day, value: entry.customers }));
  /* Over the period a customer who bought on two days is one customer: the
     dashboard's own distinct count, never the days added up. */
  const customersInAll = board.totals.customers.current;
  const accounts = board.newAccounts;
  const total = (values: { value: number }[]) => values.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <Panel id="activity-title" title={t("dashboard.activityTitle")} note={t("dashboard.activityNote")}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="flex items-center gap-2 font-semibold text-[#0a285a]"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: SERIES[2] }} />{t("dashboard.activityCustomers")}</span>
            <span className="ink-muted">{t("dashboard.activityTotal", { count: customersInAll })}</span>
          </p>
          <MiniBars values={customers} color={SERIES[2]} day={day} summary={`${t("dashboard.activityCustomers")}: ${t("dashboard.activityTotal", { count: customersInAll })}`} />
        </div>
        {accounts ? (
          <div>
            <p className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-2 font-semibold text-[#0a285a]"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: SERIES[5] }} />{t("dashboard.activityAccounts")}</span>
              <span className="ink-muted">{t("dashboard.activityTotal", { count: total(accounts.map(entry => ({ value: entry.count }))) })}</span>
            </p>
            <MiniBars values={accounts.map(entry => ({ day: entry.day, value: entry.count }))} color={SERIES[5]} day={day} summary={`${t("dashboard.activityAccounts")}: ${t("dashboard.activityTotal", { count: total(accounts.map(entry => ({ value: entry.count }))) })}`} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function TopPanel({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <Panel id="top-title" title={t("dashboard.topTitle")} note={t("dashboard.topNote")}>
      {board.top.length === 0 ? (
        <p className="text-[14px] ink-muted">{t("dashboard.noSales")}</p>
      ) : (
        <ol className="space-y-3">
          {board.top.map((entry, index) => (
            <li key={`${entry.productId ?? entry.title}`} className="flex items-center gap-3">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1f4f9] text-[12px] font-bold tabular-nums text-[#0a285a]">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  {entry.productId ? (
                    <Link href={`/admin/products/${entry.productId}`} dir="auto" className="min-w-0 truncate text-[14px] font-semibold text-[#0a285a] hover:underline">{entry.title}</Link>
                  ) : (
                    <span dir="auto" className="min-w-0 truncate text-[14px] font-semibold text-[#0a285a]">{entry.title}</span>
                  )}
                  <span className="shrink-0 text-[14px] font-bold tabular-nums text-[#0a285a]">{money(entry.sales)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eef1f6]">
                    <span className="chart-segment block h-full rounded-full" style={{ width: `${Math.max(2, entry.percent)}%`, background: SERIES[0] }} />
                  </span>
                  <span className="shrink-0 text-[12px] ink-muted">{t("dashboard.topUnits", { count: entry.units })}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
