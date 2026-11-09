/**
 * The portal's charts, drawn by hand in SVG: no chart library is worth the
 * bytes for five shapes, and these follow the shop's rules where a library
 * would follow its own.
 *
 * **Colour does a job.** The series are a validated categorical order (deep
 * indigo, warm amber, cool cyan, raspberry, emerald, violet — each adjacent
 * pair apart for colour-blind eyes, every one 3:1 on white), given to
 * departments in that fixed order and never by rank. Stock states wear the
 * status colours, which no series uses, and always beside an icon and a word.
 * Words are in the page's inks, never a series colour.
 *
 * **One axis, thin marks, a hairline grid.** The period before is a grey
 * line on the same scale as this period; the estimate continues the line
 * dashed, the one place a dashed line is allowed, because it is a projection.
 *
 * **A chart is a picture with its figures beside it.** Every one is an image
 * to a screen reader with a sentence naming what it shows, and the trend has
 * a table a press away; the hover tooltip is a convenience, never the only
 * place a figure is. The time axis runs in the page's direction, so in Arabic
 * the days go from the right, as the bars on this page always have.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/** The categorical order, validated on white: assigned in this order, never cycled. */
export const SERIES = ["#4f46e5", "#d97706", "#0891b2", "#be185d", "#16a34a", "#9333ea"] as const;
export const SERIES_GREY = "#94a3b8";
/** Status marks, reserved for state: good, warning, serious, critical. */
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", info: "#4f46e5" } as const;
const GRID = "#e8ecf2";
const AXIS = "#cbd4e0";

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

/** Numbers short enough for an axis: 1.2K, 35K. */
export function useCompact() {
  const { isArabic } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { notation: "compact", maximumFractionDigits: 1 });
    return (value: number) => format.format(value);
  }, [isArabic]);
}

export type TrendPoint = { day: string; value: number; before: number; orders: number };

export function TrendChart({ points, forecast, money, day, labels }: {
  points: TrendPoint[];
  forecast: { day: string; value: number }[];
  money: (value: number) => string;
  day: (day: string) => string;
  labels: { current: string; before: string; forecast: string; orders: (count: number) => string; summary: string };
}) {
  const { direction } = useTranslation();
  const compact = useCompact();
  const rtl = direction === "rtl";
  const gradient = useId();
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = width < 520 ? 220 : 280;
  const pad = { top: 14, bottom: 30, side: 46, end: 14 };
  const all = [...points.map(point => ({ day: point.day, value: point.value })), ...forecast];
  const max = niceMax(Math.max(...points.map(point => Math.max(point.value, point.before)), ...forecast.map(point => point.value), 0));
  const inner = Math.max(1, width - pad.side - pad.end);
  const step = all.length > 1 ? inner / (all.length - 1) : 0;
  const xAt = (index: number) => {
    const x = pad.side + index * step;
    return rtl ? width - x : x;
  };
  const yAt = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const line = (values: number[], offset = 0) => values.map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index + offset).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ");
  const current = line(points.map(point => point.value));
  const area = points.length ? `${current} L${xAt(points.length - 1).toFixed(1)},${yAt(0)} L${xAt(0).toFixed(1)},${yAt(0)} Z` : "";
  const before = line(points.map(point => point.before));
  const ahead = points.length ? line([points[points.length - 1].value, ...forecast.map(point => point.value)], points.length - 1) : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(share => share * max);
  const labelEvery = Math.max(1, Math.ceil(all.length / (width < 520 ? 4 : 7)));

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || step === 0) return;
    const local = rtl ? rect.right - clientX : clientX - rect.left;
    setActive(Math.max(0, Math.min(all.length - 1, Math.round((local - pad.side) / step))));
  };

  const hovered = active === null ? null : active < points.length ? { kind: "day" as const, point: points[active] } : { kind: "forecast" as const, point: forecast[active - points.length] };
  const tipX = active === null ? 0 : xAt(active);

  return (
    <div ref={box} className="relative select-none" onPointerMove={event => pick(event.clientX)} onPointerLeave={() => setActive(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={labels.summary} className="block overflow-visible">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.28" />
              <stop offset="70%" stopColor={SERIES[0]} stopOpacity="0.06" />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map(tick => (
            <g key={tick}>
              <line x1={rtl ? pad.end : pad.side} x2={rtl ? width - pad.side : width - pad.end} y1={yAt(tick)} y2={yAt(tick)} stroke={tick === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={rtl ? width - pad.side + 8 : pad.side - 8} y={yAt(tick) + 4} textAnchor={rtl ? "start" : "end"} className="fill-[#64748b] text-[11px] tabular-nums">{compact(tick)}</text>
            </g>
          ))}
          {all.map((point, index) => (index % labelEvery === 0 || index === all.length - 1) && (index === all.length - 1 || all.length - 1 - index >= labelEvery / 2) ? (
            <text key={point.day} x={xAt(index)} y={height - 8} textAnchor="middle" className="fill-[#64748b] text-[11px]">{day(point.day)}</text>
          ) : null)}
          {area ? <path d={area} fill={`url(#${gradient})`} className="chart-fade" /> : null}
          <path d={before} fill="none" stroke={SERIES_GREY} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="chart-fade" />
          {ahead ? <path d={ahead} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" opacity="0.75" className="chart-fade" /> : null}
          <path d={current} pathLength={1} fill="none" stroke={SERIES[0]} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" className="chart-draw" />
          {active !== null ? (
            <g aria-hidden>
              <line x1={tipX} x2={tipX} y1={pad.top} y2={height - pad.bottom} stroke="#0a285a" strokeOpacity="0.25" strokeWidth="1" />
              {hovered?.kind === "day" ? (
                <>
                  <circle cx={tipX} cy={yAt(hovered.point.before)} r="3.5" fill="white" stroke={SERIES_GREY} strokeWidth="2" />
                  <circle cx={tipX} cy={yAt(hovered.point.value)} r="4.5" fill={SERIES[0]} stroke="white" strokeWidth="2" />
                </>
              ) : hovered ? (
                <circle cx={tipX} cy={yAt(hovered.point.value)} r="4.5" fill="white" stroke={SERIES[0]} strokeWidth="2" />
              ) : null}
            </g>
          ) : null}
        </svg>
      ) : <div style={{ height }} />}
      {hovered ? (
        <div
          aria-hidden
          className="chart-point pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-[#e3e8f0] bg-white px-3 py-2.5 shadow-[0_12px_32px_-16px_rgba(10,40,90,0.45)]"
          style={{ left: Math.max(8, Math.min(width - 180, tipX + (tipX > width / 2 ? -188 : 12))) }}
        >
          <p className="text-[12px] font-semibold text-[#0a285a]">{day(hovered.point.day)}</p>
          {hovered.kind === "day" ? (
            <>
              <TipRow color={SERIES[0]} label={labels.current} value={money(hovered.point.value)} />
              <TipRow color={SERIES_GREY} label={labels.before} value={money(hovered.point.before)} />
              <p className="mt-1 text-[12px] text-[#536b8c]">{labels.orders(hovered.point.orders)}</p>
            </>
          ) : <TipRow color={SERIES[0]} label={labels.forecast} value={money(hovered.point.value)} dashed />}
        </div>
      ) : null}
    </div>
  );
}

function TipRow({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <p className="mt-1 flex items-center gap-2 text-[12px] text-[#3d5376]">
      <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 50%, transparent 50%)`, backgroundSize: "4px 2px" } : { background: color }} />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="font-semibold tabular-nums text-[#0a285a]">{value}</span>
    </p>
  );
}

/** What each line is, above the chart: a legend for two or more series. */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; muted?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[#536b8c]">
      {items.map(item => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-[3px] w-4 rounded-full"
            style={item.dashed ? { backgroundImage: `linear-gradient(90deg, ${item.color} 55%, transparent 55%)`, backgroundSize: "6px 3px" } : { background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A small line under a figure: its days, drawn, with no axis. */
export function Sparkline({ values, color, width = 112, height = 36 }: { values: number[]; color: string; width?: number; height?: number }) {
  const gradient = useId();
  const { direction } = useTranslation();
  if (values.length < 2) return null;
  const max = Math.max(...values, 0) || 1;
  const x = (index: number) => {
    const at = (index / (values.length - 1)) * (width - 4) + 2;
    return direction === "rtl" ? width - at : at;
  };
  const y = (value: number) => height - 3 - (value / max) * (height - 8);
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg width={width} height={height} aria-hidden className="block shrink-0 overflow-visible">
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} className="chart-fade" />
      {/* Faded in, not traced: at this size the dash trick drew only the
          line's first few pixels in Chromium. */}
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" className="chart-fade" />
    </svg>
  );
}

export type Segment = { key: string; label: string; value: string; percent: number; color: string; icon?: ReactNode; note?: string };

/**
 * A whole split into parts: one bar of segments, two pixels of white between
 * them, and the parts listed under it with their figures — the list is what a
 * screen reader reads, so the bar is hidden from it.
 */
export function SegmentedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = segments.filter(segment => segment.percent > 0);
  return (
    <div>
      <div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-[#eef1f6]">
        {shown.map(segment => (
          <span
            key={segment.key}
            onPointerEnter={() => setHover(segment.key)}
            onPointerLeave={() => setHover(null)}
            className="chart-segment h-full first:rounded-s-full last:rounded-e-full"
            style={{ flexGrow: segment.percent, flexBasis: 0, background: segment.color, opacity: hover && hover !== segment.key ? 0.35 : 1 }}
          />
        ))}
      </div>
      <ul aria-label={label} className="mt-4 space-y-1">
        {segments.map(segment => (
          <li
            key={segment.key}
            onPointerEnter={() => setHover(segment.key)}
            onPointerLeave={() => setHover(null)}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${hover === segment.key ? "bg-[#f4f6fb]" : ""}`}
          >
            {segment.icon ?? <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: segment.color }} />}
            <span dir="auto" className="min-w-0 flex-1 truncate text-[#0a285a]">{segment.label}</span>
            {segment.note ? <span className="shrink-0 text-[12px] text-[#536b8c]">{segment.note}</span> : null}
            <span className="shrink-0 font-semibold tabular-nums text-[#0a285a]">{segment.value}</span>
            <span className="w-11 shrink-0 text-end tabular-nums text-[#536b8c]"><bdi dir="ltr">{segment.percent}%</bdi></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A count per day as thin bars rising from the baseline, each with its figure on hover. */
export function MiniBars({ values, color, summary, day }: {
  values: { day: string; value: number }[];
  color: string;
  summary: string;
  day: (day: string) => string;
}) {
  const { direction } = useTranslation();
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 96;
  const max = Math.max(...values.map(entry => entry.value), 1);
  const slot = values.length ? width / values.length : 0;
  const barWidth = Math.max(2, Math.min(14, slot * 0.62));
  const xOf = (index: number) => {
    const at = index * slot + (slot - barWidth) / 2;
    return direction === "rtl" ? width - at - barWidth : at;
  };
  return (
    <div ref={box} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={summary} className="block">
          <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke={AXIS} />
          {values.map((entry, index) => {
            const barHeight = entry.value > 0 ? Math.max(3, (entry.value / max) * (height - 10)) : 0;
            return (
              <g key={entry.day} onPointerEnter={() => setActive(index)}>
                <rect x={xOf(index) - (slot - barWidth) / 2} y={0} width={slot} height={height} fill="transparent" />
                {barHeight > 0 ? (
                  <rect
                    x={xOf(index)}
                    y={height - 1 - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(4, barWidth / 2)}
                    fill={color}
                    opacity={active === null || active === index ? 1 : 0.4}
                    className="chart-grow"
                    style={{ animationDelay: `${Math.min(index * 12, 600)}ms` }}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : <div style={{ height }} />}
      {active !== null && values[active] ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-lg border border-[#e3e8f0] bg-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-[0_10px_24px_-14px_rgba(10,40,90,0.45)]"
          style={{ left: Math.max(0, Math.min(width - 120, xOf(active) - 40)) }}
        >
          <span className="text-[#536b8c]">{day(values[active].day)}</span>{" "}
          <span className="font-semibold tabular-nums text-[#0a285a]">{values[active].value}</span>
        </div>
      ) : null}
    </div>
  );
}
