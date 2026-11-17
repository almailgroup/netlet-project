/**
 * Product views in the portal (`Shared/commerce/productViews.ts` is the rule,
 * `inventory.views` the read): how many people opened a store's product pages,
 * in the app or on the website, where they came from, and what came of it —
 * the store's own reading of demand, on the owner's word.
 *
 * **The line of views each day is the page's one bold thing**, the dashboard's
 * look: the figures above it, the channels and the sources beside it, and
 * every product under them with its own figures and its demand said in words.
 * The channels are three fixed hues in a fixed order (the app indigo, the
 * website on a phone cyan, on a computer amber) wherever they are drawn; the
 * sources are one hue, a ranking of magnitude, because their names are what
 * tells them apart.
 */
import { Kpi, Panel, useDayLabel } from "@/components/admin/Dashboard";
import { Legend, SegmentedBar, SERIES, SERIES_GREY, TrendChart } from "@/components/admin/charts";
import { Card, fieldClass, Notice, Pill, Segmented, SkeletonCards, surfaceClass, tableClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/admin/QueryGate";
import { trpc } from "@/lib/trpc";
import { Select } from "@/components/ui/Select";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import { readStored, writeStored } from "@/lib/browserStore";
import { percentChange } from "@shared/commerce/dashboard";
import { textsMatch } from "@shared/commerce/search";
import {
  conversionOf,
  DEFAULT_VIEW_RANGE,
  MIN_VISITORS_TO_JUDGE,
  VIEW_CHANNELS,
  VIEW_RANGES,
  type Demand,
  type ProductViews,
  type ViewChannel,
  type ViewRange,
  type ViewSource,
  type ViewsReport,
} from "@shared/commerce/productViews";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowUpRight, Eye, ImageOff, Percent, ReceiptText, Search, Users } from "lucide-react";
import { useMemo, useState, type ComponentProps } from "react";
import { Link } from "wouter";
import { failedToLoad } from "@/lib/queryState";

/** Fixed per channel, wherever a channel is drawn: colour follows the thing, never its rank. */
export const CHANNEL_COLOR: Record<ViewChannel, string> = { app: SERIES[0], web_phone: SERIES[2], web_computer: SERIES[1] };
export const CHANNEL_LABEL: Record<ViewChannel, MessageKey> = {
  app: "views.channelApp",
  web_phone: "views.channelPhone",
  web_computer: "views.channelComputer",
};
export const SOURCE_LABEL: Record<ViewSource, MessageKey> = {
  home: "views.sourceHome",
  search: "views.sourceSearch",
  browse: "views.sourceBrowse",
  store: "views.sourceStore",
  product: "views.sourceProduct",
  account: "views.sourceAccount",
  outside: "views.sourceOutside",
  other: "views.sourceOther",
};
export const DEMAND_LABEL: Record<Demand, MessageKey> = {
  unseen: "views.demandUnseen",
  few: "views.demandFew",
  notBuying: "views.demandNotBuying",
  some: "views.demandSome",
  strong: "views.demandStrong",
};
/* What each reading means, said under one product's figures. */
const DEMAND_EXPLAIN: Record<Demand, MessageKey> = {
  unseen: "views.explainUnseen",
  few: "views.explainFew",
  notBuying: "views.explainNotBuying",
  some: "views.explainSome",
  strong: "views.explainStrong",
};
const DEMAND_TONE: Record<Demand, ComponentProps<typeof Pill>["tone"]> = {
  unseen: "neutral",
  few: "neutral",
  notBuying: "warning",
  some: "navy",
  strong: "good",
};

const RANGE_KEY = "portal:viewsRange";

/** The period last read on this device, the dashboard's rule. */
export function useViewRange(): [ViewRange, (range: ViewRange) => void] {
  const [range, setRange] = useState<ViewRange>(() => {
    const stored = Number(readStored(RANGE_KEY));
    return (VIEW_RANGES as readonly number[]).includes(stored) ? (stored as ViewRange) : DEFAULT_VIEW_RANGE;
  });
  return [range, next => { setRange(next); writeStored(RANGE_KEY, String(next)); }];
}

export function RangeControl({ range, onChange }: { range: ViewRange; onChange: (range: ViewRange) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t("dashboard.range")}
      value={String(range) as `${ViewRange}`}
      onChange={value => onChange(Number(value) as ViewRange)}
      options={[
        { value: "7", label: t("dashboard.range7") },
        { value: "30", label: t("dashboard.range30") },
        { value: "90", label: t("dashboard.range90") },
      ]}
    />
  );
}

/** A count in Latin digits, isolated, the portal's rule for a figure. */
function Count({ value }: { value: number }) {
  const { isArabic } = useTranslation();
  return <bdi dir="ltr">{value.toLocaleString(isArabic ? "ar-KW-u-nu-latn" : "en-GB")}</bdi>;
}

function Figures({ report }: { report: ViewsReport }) {
  const { t } = useTranslation();
  const { totals, days, range } = report;
  const before = conversionOf(totals.orders.previous, totals.visitors.previous);
  const conversion = report.conversion;
  return (
    <ul className="grid grid-cols-1 gap-3 @md:grid-cols-2 @5xl:grid-cols-4">
      <Kpi label={t("views.views")} value={<Count value={totals.views.current} />} change={totals.views.change} days={range} series={days.map(day => day.views)} color={SERIES[0]} icon={<Eye />} />
      <Kpi label={t("views.visitors")} value={<Count value={totals.visitors.current} />} change={totals.visitors.change} days={range} series={days.map(day => day.visitors)} color={SERIES[2]} icon={<Users />} />
      <Kpi label={t("views.orders")} value={<Count value={totals.orders.current} />} change={totals.orders.change} days={range} series={[]} color={SERIES[4]} icon={<ReceiptText />} />
      <Kpi
        label={t("views.conversion")}
        value={conversion === null ? "—" : <bdi dir="ltr">{conversion}</bdi>}
        change={conversion === null || before === null ? null : percentChange(Math.round(conversion * 10), Math.round(before * 10))}
        days={range}
        series={[]}
        color={SERIES[1]}
        icon={<Percent />}
      />
    </ul>
  );
}

function TrendPanel({ report }: { report: ViewsReport }) {
  const { t } = useTranslation();
  const day = useDayLabel();
  const [table, setTable] = useState(false);
  const points = report.days.map((entry, index) => ({ day: entry.day, value: entry.views, before: report.previousDays[index]?.views ?? 0, orders: entry.visitors }));
  const count = (value: number) => value.toLocaleString("en-GB");
  return (
    <Panel
      id="views-trend-title"
      title={t("views.trendTitle")}
      note={t("views.trendNote")}
      action={(
        <button type="button" onClick={() => setTable(shown => !shown)} aria-pressed={table} className="inline-flex h-9 items-center rounded-lg border border-[#dfe5ee] px-3 text-[12px] font-semibold text-[#0a285a] hover:bg-[#f0f2f5]">
          {table ? t("dashboard.showChart") : t("dashboard.showTable")}
        </button>
      )}
    >
      {table ? (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-[#eef1f6]">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{t("views.trendTitle")}</caption>
            <thead className="sticky top-0 bg-[#f8fafc] text-[12px] text-[#536b8c]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{t("dashboard.columnDay")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("views.views")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("views.visitors")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t("dashboard.columnBefore")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-[#0a285a]">
              {points.map(point => (
                <tr key={point.day} className="border-t border-[#f1f4f8]">
                  <th scope="row" className="px-3 py-1.5 text-start font-medium">{day(point.day)}</th>
                  <td className="px-3 py-1.5 text-end"><Count value={point.value} /></td>
                  <td className="px-3 py-1.5 text-end"><Count value={point.orders} /></td>
                  <td className="px-3 py-1.5 text-end text-[#536b8c]"><Count value={point.before} /></td>
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
          ]} />
          <div className="mt-3">
            <TrendChart
              points={points}
              forecast={[]}
              money={count}
              day={day}
              labels={{
                current: t("dashboard.seriesThis"),
                before: t("dashboard.seriesBefore"),
                forecast: t("dashboard.seriesForecast"),
                orders: value => t("views.visitorsOn", { count: value }),
                summary: t("views.chartLabel", { from: day(report.days[0].day), to: day(report.days[report.days.length - 1].day), count: report.totals.views.current }),
              }}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

export function ChannelsPanel({ report }: { report: ViewsReport }) {
  const { t } = useTranslation();
  return (
    <Panel id="views-channels-title" title={t("views.channelsTitle")} note={t("views.channelsNote")}>
      {report.totals.views.current === 0 ? (
        <p className="text-[14px] ink-muted">{t("views.none")}</p>
      ) : (
        <SegmentedBar
          label={t("views.channelsTitle")}
          segments={report.channels.map(row => ({
            key: row.channel,
            label: t(CHANNEL_LABEL[row.channel]),
            value: row.views.toLocaleString("en-GB"),
            note: t("views.visitorsOn", { count: row.visitors }),
            percent: row.percent,
            color: CHANNEL_COLOR[row.channel],
          }))}
        />
      )}
    </Panel>
  );
}

export function SourcesPanel({ report, limit }: { report: ViewsReport; limit?: number }) {
  const { t } = useTranslation();
  const rows = limit ? report.sources.slice(0, limit) : report.sources;
  return (
    <Panel id="views-sources-title" title={t("views.sourcesTitle")} note={t("views.sourcesNote")}>
      {rows.length === 0 ? (
        <p className="text-[14px] ink-muted">{t("views.none")}</p>
      ) : (
        <ul className="space-y-3" aria-label={t("views.sourcesTitle")}>
          {rows.map(row => (
            <li key={row.source}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 text-[#0a285a]">{t(SOURCE_LABEL[row.source])}</span>
                <span className="shrink-0 font-semibold tabular-nums text-[#0a285a]">
                  <Count value={row.views} /> <span className="ms-1 font-normal text-[#536b8c]"><bdi dir="ltr">{row.percent}%</bdi></span>
                </span>
              </div>
              <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#eef1f6]">
                <span className="chart-segment block h-full rounded-full" style={{ width: `${Math.max(2, row.percent)}%`, background: SERIES[0] }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** A product's views split by channel: one thin bar, its words for a screen reader. */
function ChannelSplit({ row }: { row: ProductViews }) {
  const { t } = useTranslation();
  const words = t("views.splitLabel", { app: row.channels.app, phone: row.channels.web_phone, computer: row.channels.web_computer });
  if (row.views === 0) return <span className="text-[12px] ink-muted">—</span>;
  return (
    <span className="flex min-w-24 flex-col gap-1">
      <span aria-hidden className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-[#eef1f6]">
        {VIEW_CHANNELS.filter(channel => row.channels[channel] > 0).map(channel => (
          <span key={channel} className="h-full first:rounded-s-full last:rounded-e-full" style={{ flexGrow: row.channels[channel], flexBasis: 0, background: CHANNEL_COLOR[channel] }} />
        ))}
      </span>
      <span className="sr-only">{words}</span>
      <span aria-hidden title={words} className="flex gap-2.5 text-[12px] leading-4 tabular-nums text-[#536b8c]">
        {VIEW_CHANNELS.map(channel => (
          <span key={channel} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-[2px]" style={{ background: CHANNEL_COLOR[channel] }} />
            <bdi dir="ltr">{row.channels[channel]}</bdi>
          </span>
        ))}
      </span>
    </span>
  );
}

export function DemandPill({ demand }: { demand: Demand }) {
  const { t } = useTranslation();
  return <Pill tone={DEMAND_TONE[demand]}>{t(DEMAND_LABEL[demand])}</Pill>;
}

type Sort = "views" | "orders" | "attention";

function sorted(rows: ProductViews[], sort: Sort): ProductViews[] {
  if (sort === "views") return rows;
  const copy = [...rows];
  if (sort === "orders") return copy.sort((a, b) => b.orders - a.orders || b.units - a.units || b.views - a.views);
  /* Looked at and not bought first: that is where a price, a photo or a description is costing a sale. */
  const rank = (row: ProductViews) => (row.demand === "notBuying" ? 0 : row.demand === "some" ? 1 : 2);
  return copy.sort((a, b) => rank(a) - rank(b) || b.views - a.views);
}

function ProductsPanel({ report }: { report: ViewsReport }) {
  const { t, isArabic } = useTranslation();
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>("views");
  const rows = useMemo(
    () => sorted(report.products.filter(row => textsMatch([row.title, row.titleAr, row.vendorName], term)), sort),
    [report.products, term, sort],
  );
  const name = (row: ProductViews) => (isArabic && row.titleAr ? row.titleAr : row.title);
  const store = report.products.some(row => row.vendorName);

  return (
    <section aria-labelledby="views-products-title" className={`min-w-0 p-5 ${surfaceClass}`}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 id="views-products-title" className="text-[15px] leading-6 font-bold text-[#0a285a]">{t("views.productsTitle")}</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-5 ink-muted">
            {t("views.productsNote", { min: MIN_VISITORS_TO_JUDGE })}
            {report.conversion !== null ? <> {t("views.averageNote", { rate: report.conversion })}</> : null}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-60">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 ink-muted" aria-hidden />
            <input type="search" value={term} onChange={event => setTerm(event.target.value)} aria-label={t("views.search")} placeholder={t("views.search")} className={`${fieldClass} ps-10`} />
          </div>
          <Select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label={t("views.sort")} className={`${fieldClass} sm:w-56`}>
            <option value="views">{t("views.sortViews")}</option>
            <option value="orders">{t("views.sortOrders")}</option>
            <option value="attention">{t("views.sortAttention")}</option>
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[14px] ink-muted">{report.products.length ? t("views.noMatch") : t("views.noProducts")}</p>
      ) : (
        <>
          {/* From md up a table; under it each product is a card. */}
          <div className={`hidden md:block ${tableClass.wrap} shadow-none`}>
            <table className={tableClass.table}>
              <caption className="sr-only">{t("views.productsTitle")}</caption>
              <thead className={tableClass.head}>
                <tr>
                  <th scope="col" className={tableClass.th}>{t("views.product")}</th>
                  <th scope="col" className={tableClass.thEnd}>{t("views.views")}</th>
                  <th scope="col" className={tableClass.thEnd}>{t("views.visitors")}</th>
                  <th scope="col" className={tableClass.th}>{t("views.channelsColumn")}</th>
                  <th scope="col" className={tableClass.thEnd}>{t("views.inCarts")}</th>
                  <th scope="col" className={tableClass.thEnd}>{t("views.orders")}</th>
                  <th scope="col" className={tableClass.th}>{t("views.demand")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.productId} className={tableClass.row}>
                    <td className={tableClass.td}>
                      <ProductName row={row} name={name(row)} store={store} />
                    </td>
                    <td className={`${tableClass.td} text-end tabular-nums font-semibold text-[#0a285a]`}>
                      <Count value={row.views} />
                      <ChangeNote row={row} />
                    </td>
                    <td className={`${tableClass.td} text-end tabular-nums text-[#0a285a]`}><Count value={row.visitors} /></td>
                    <td className={tableClass.td}><ChannelSplit row={row} /></td>
                    <td className={`${tableClass.td} text-end tabular-nums text-[#0a285a]`}><Count value={row.inCarts} /></td>
                    <td className={`${tableClass.td} text-end tabular-nums text-[#0a285a]`}>
                      <Count value={row.orders} />
                      {row.units ? <span className="block text-[12px] text-[#536b8c]">{t("views.unitsOrdered", { count: row.units })}</span> : null}
                    </td>
                    <td className={tableClass.td}><DemandPill demand={row.demand} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {rows.map(row => row.views === 0 ? (
              /* Nobody looked: one line, not four zeros, so the list stays short. */
              <li key={row.productId} className="flex items-center justify-between gap-3 rounded-xl border border-[#e3e8f0] p-3">
                <ProductName row={row} name={name(row)} store={store} />
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <DemandPill demand={row.demand} />
                  {row.inCarts > 0 ? <span className="text-[12px] text-[#536b8c]">{t("views.inCartsCount", { count: row.inCarts })}</span> : null}
                </span>
              </li>
            ) : (
              <li key={row.productId} className="rounded-xl border border-[#e3e8f0] p-3">
                <ProductName row={row} name={name(row)} store={store} />
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <Figure label={t("views.views")} value={row.views} />
                  <Figure label={t("views.visitors")} value={row.visitors} />
                  <Figure label={t("views.orders")} value={row.orders} />
                  <Figure label={t("views.inCarts")} value={row.inCarts} />
                </dl>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <ChannelSplit row={row} />
                  <DemandPill demand={row.demand} />
                </div>
              </li>
            ))}
          </ul>
          {report.products.length < report.productCount ? (
            <p className="mt-3 text-[12px] ink-muted">{t("views.shown", { shown: report.products.length, count: report.productCount })}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#f6f8fb] px-2.5 py-2">
      <dt className="text-[#536b8c]">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-bold tabular-nums text-[#0a285a]"><Count value={value} /></dd>
    </div>
  );
}

function ChangeNote({ row }: { row: ProductViews }) {
  const { t } = useTranslation();
  if (row.change === null || row.change === 0) return null;
  const up = row.change > 0;
  return (
    <span className={`block text-[12px] font-normal ${up ? "text-[#006300]" : "text-[#b42318]"}`}>
      {t(up ? "dashboard.up" : "dashboard.down", { change: Math.abs(Math.round(row.change)) })}
    </span>
  );
}

function ProductName({ row, name, store }: { row: ProductViews; name: string; store: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9]">
        <Thumb src={row.image ?? undefined} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
      </span>
      <span className="min-w-0">
        <Link href={`/admin/products/${row.productId}`} dir="auto" className="line-clamp-2 text-[14px] leading-5 font-semibold text-[#0a285a] hover:underline">{name}</Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {store && row.vendorName ? <span dir="auto" className="text-[12px] text-[#536b8c]">{row.vendorName}</span> : null}
          {row.published ? null : <Pill tone="neutral">{t("views.notOnSale")}</Pill>}
        </span>
      </span>
    </div>
  );
}

/** The whole report: what the Product views page draws under its heading. */
export function ViewsReportView({ report }: { report: ViewsReport }) {
  const { t } = useTranslation();
  if (!report.ready) return <Notice tone="info">{t("views.unavailable")}</Notice>;
  return (
    <div className="@container space-y-4">
      {report.totals.views.current === 0 ? <Notice tone="info">{t("views.noneYet")}</Notice> : null}
      <Figures report={report} />
      <TrendPanel report={report} />
      <div className="grid items-start gap-4 @3xl:grid-cols-2">
        <ChannelsPanel report={report} />
        <SourcesPanel report={report} />
      </div>
      <ProductsPanel report={report} />
      <p className="text-[12px] leading-5 ink-muted">{t("views.privacyNote")}</p>
    </div>
  );
}

/** One product's views, for its editor: the figures, the channels, the sources and what they say. */
export function ProductViewsSummary({ report }: { report: ViewsReport }) {
  const { t } = useTranslation();
  if (!report.ready) return <Notice tone="info">{t("views.unavailable")}</Notice>;
  const row = report.products[0];
  return (
    <div className="@container space-y-4">
      <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Figure label={t("views.views")} value={report.totals.views.current} />
        <Figure label={t("views.visitors")} value={report.totals.visitors.current} />
        <Figure label={t("views.orders")} value={row?.orders ?? 0} />
        <Figure label={t("views.inCarts")} value={row?.inCarts ?? 0} />
      </dl>
      {row ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-[#3d5376]">
          <DemandPill demand={row.demand} />
          <span>{t(DEMAND_EXPLAIN[row.demand], { min: MIN_VISITORS_TO_JUDGE })}</span>
        </p>
      ) : null}
      {report.totals.views.current > 0 ? (
        <div className="grid items-start gap-4 @3xl:grid-cols-2">
          <ChannelsPanel report={report} />
          <SourcesPanel report={report} limit={4} />
        </div>
      ) : null}
      <Link href="/admin/views" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-[#0a285a] hover:bg-[#0a285a]/[.06]">
        {t("views.seeAll")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      </Link>
    </div>
  );
}

/** The editor's section: one product's views over the period chosen, the page's own range. */
export function ProductViewsCard({ productId, published }: { productId: number; published: boolean }) {
  const { t } = useTranslation();
  const [range, setRange] = useViewRange();
  const report = trpc.inventory.views.useQuery({ range, productId }, { placeholderData: previous => previous });
  return (
    <Card id="views" title={t("views.cardTitle")} description={t("views.cardNote")}>
      <div className="mb-4"><RangeControl range={range} onChange={setRange} /></div>
      {report.data ? (
        !published && report.data.ready && report.data.totals.views.current === 0
          ? <Notice tone="info">{t("views.cardDraft")}</Notice>
          : <ProductViewsSummary report={report.data} />
      ) : failedToLoad(report) ? (
        <QueryGate queries={[report]}>{() => null}</QueryGate>
      ) : (
        <SkeletonCards count={2} label={t("admin.loading")} />
      )}
    </Card>
  );
}
