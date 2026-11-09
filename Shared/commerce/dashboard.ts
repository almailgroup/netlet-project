/**
 * The portal's dashboard: the sales line with a week's estimate after it,
 * the period against the one before, revenue by department, how many
 * customers bought and how many accounts were opened each day, and the shelf's
 * health. Pure, for the reason `salesSummary.ts` is — a figure an owner reads
 * every morning has to be checkable without a database.
 *
 * **Every money figure is the frozen line** (`line_total`, copied at the sale),
 * and the database half leaves out what is not a sale: a cancelled line, a
 * cancelled order, an exchange's zero-priced replacement. **Days are Kuwaiti
 * days.**
 *
 * **The estimate is arithmetic, said as an estimate.** Each of the next seven
 * days is the average of the same weekday over the last four whole weeks
 * (today, being half over, is not one of them). That is a rule an owner can
 * check against the line above it, which a model's guess would not be, and the
 * page draws it dashed and names it.
 *
 * **A change is against the period just before**, of the same length; with
 * nothing to compare against it is null rather than an infinite rise.
 */
import { kuwaitDay, KUWAIT_OFFSET_MS } from "../kuwaitDay.js";
import { fromFils, toFils } from "../money.js";
import { DEPARTMENTS } from "./departments.js";

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = 30;

/** How many days the estimate looks ahead, and how many past weeks it averages. */
export const FORECAST_DAYS = 7;
export const FORECAST_WEEKS = 4;

/** At most this many departments get a segment of their own; the rest are one. */
export const DEPARTMENT_SEGMENTS = 5;

export const TOP_PRODUCTS = 5;

/** Read no more lines than this, and say so when it was reached. */
export const DASHBOARD_LINE_CEILING = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DashboardLine = {
  orderId: number;
  placedAt: Date;
  lineTotal: string;
  quantity: number;
  /** The account that ordered; null for an order with none. */
  buyerId: number | null;
  /** The department's slug, or null for a product filed nowhere (or since deleted). */
  department: string | null;
  productId: number | null;
  /** The title frozen on the line, which a deleted product keeps. */
  productTitle: string;
};

export type StockHealth = { healthy: number; low: number; out: number; preorder: number };
export type StockState = keyof StockHealth;

export type Change = { current: string; previous: string; change: number | null };
export type CountChange = { current: number; previous: number; change: number | null };

export type DashboardDay = { day: string; sales: string; orders: number; customers: number; averageOrder: string };

export type Dashboard = {
  range: DashboardRange;
  /** One per Kuwaiti day of the range, oldest first, the last being today. */
  days: DashboardDay[];
  /** The period before, day for day, so the two lines can be drawn together. */
  previousDays: { day: string; sales: string }[];
  /** The next `FORECAST_DAYS` days, each its weekday's recent average. */
  forecast: { day: string; sales: string }[];
  totals: { sales: Change; orders: CountChange; averageOrder: Change; customers: CountChange };
  /** Biggest first; at most `DEPARTMENT_SEGMENTS` and one segment for the rest. */
  departments: { slug: string | null; other?: true; sales: string; percent: number }[];
  /** What sold most over the range, by takings, at most `TOP_PRODUCTS`. */
  top: { productId: number | null; title: string; units: number; sales: string; percent: number }[];
  /** Accounts opened each day, for an administrator; null for a store. */
  newAccounts: { day: string; count: number }[] | null;
  stock: StockHealth;
  /** True when the read stopped at `DASHBOARD_LINE_CEILING`. */
  truncated: boolean;
};

/** The Kuwaiti days ending `end` days back from `now`, oldest first. */
export function daysEnding(now: Date, count: number, endBack = 0): string[] {
  const days: string[] = [];
  for (let back = endBack + count - 1; back >= endBack; back--) days.push(kuwaitDay(new Date(now.getTime() - back * DAY_MS)));
  return days;
}

function dayAfter(day: string, step: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + step * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  return new Date(Date.parse(`${day}T12:00:00Z`)).getUTCDay();
}

/** How far back the database half has to read for a range: the period before it, and the weeks the estimate averages. */
export function dashboardStart(now: Date, range: DashboardRange): Date {
  const span = Math.max(range * 2, FORECAST_WEEKS * 7 + 1);
  const first = daysEnding(now, span)[0];
  return new Date(Date.parse(`${first}T00:00:00Z`) - KUWAIT_OFFSET_MS);
}

/** What one variant's shelf amounts to — the rule the stock page's pills and the dashboard's counts share. */
export function stockState(variant: { stock: number; lowStockAt: number | null; preorderStock: number }): StockState {
  if (variant.stock <= 0) return variant.preorderStock > 0 ? "preorder" : "out";
  if (variant.lowStockAt !== null && variant.stock <= variant.lowStockAt) return "low";
  return "healthy";
}

/** The change from one figure to the next, in percent to one decimal; null when there was nothing before. */
export function percentChange(current: bigint | number, previous: bigint | number): number | null {
  const now = Number(current);
  const before = Number(previous);
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** Rounded to the fil, half up, so an average is a price somebody could pay. */
function averageOf(total: bigint, count: number): bigint {
  return count ? (total * 2n + BigInt(count)) / (BigInt(count) * 2n) : 0n;
}

/**
 * Each segment's share of the whole in whole percentages that add up to 100,
 * by the largest remainder (the reviews' breakdown rule), so the labels on
 * the bar never sum to 99 or 101.
 */
export function wholePercents(amounts: bigint[]): number[] {
  const whole = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (whole === 0n) return amounts.map(() => 0);
  const exact = amounts.map(amount => Number((amount * 1_000_000n) / whole) / 10_000);
  const out = exact.map(Math.floor);
  let given = out.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let i = 0; given < 100 && i < order.length; i++, given++) out[order[i].index] += 1;
  return out;
}

type Bucket = { fils: bigint; orders: Set<number>; customers: Set<string> };

const customerOf = (line: DashboardLine) => (line.buyerId === null ? `order:${line.orderId}` : `user:${line.buyerId}`);

export function buildDashboard(input: {
  lines: DashboardLine[];
  now: Date;
  range: DashboardRange;
  stock: StockHealth;
  /** Each account's opening day; null for a store, which is not shown who joined NetLet. */
  accountDays: string[] | null;
  truncated?: boolean;
}): Dashboard {
  const { lines, now, range } = input;
  const current = daysEnding(now, range);
  const previous = daysEnding(now, range, range);
  const byDay = new Map<string, Bucket>();
  for (const line of lines) {
    const day = kuwaitDay(line.placedAt);
    const bucket = byDay.get(day) ?? { fils: 0n, orders: new Set(), customers: new Set() };
    bucket.fils += toFils(line.lineTotal);
    bucket.orders.add(line.orderId);
    bucket.customers.add(customerOf(line));
    byDay.set(day, bucket);
  }
  const filsOn = (day: string) => byDay.get(day)?.fils ?? 0n;

  const days: DashboardDay[] = current.map(day => {
    const bucket = byDay.get(day);
    const orders = bucket?.orders.size ?? 0;
    return {
      day,
      sales: fromFils(bucket?.fils ?? 0n),
      orders,
      customers: bucket?.customers.size ?? 0,
      averageOrder: fromFils(averageOf(bucket?.fils ?? 0n, orders)),
    };
  });

  /* A period's totals are counted over its lines, not summed from its days:
     one customer who bought on two days is one customer. */
  const totalsOf = (period: string[]) => {
    const set = new Set(period);
    const within = lines.filter(line => set.has(kuwaitDay(line.placedAt)));
    const fils = within.reduce((sum, line) => sum + toFils(line.lineTotal), 0n);
    const orders = new Set(within.map(line => line.orderId)).size;
    return { fils, orders, customers: new Set(within.map(customerOf)).size, average: averageOf(fils, orders) };
  };
  const now_ = totalsOf(current);
  const before = totalsOf(previous);

  /* The estimate: the four whole weeks before today, weekday by weekday. */
  const history = daysEnding(now, FORECAST_WEEKS * 7, 1);
  const today = current[current.length - 1];
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, index) => {
    const day = dayAfter(today, index + 1);
    const sameWeekday = history.filter(past => weekdayOf(past) === weekdayOf(day));
    const total = sameWeekday.reduce((sum, past) => sum + filsOn(past), 0n);
    return { day, sales: fromFils(averageOf(total, sameWeekday.length)) };
  });

  /* Revenue by department over the range, biggest first, ties in the
     departments' own order, a product filed nowhere after them. */
  const inRange = new Set(current);
  const bySlug = new Map<string | null, bigint>();
  for (const line of lines) {
    if (!inRange.has(kuwaitDay(line.placedAt))) continue;
    bySlug.set(line.department, (bySlug.get(line.department) ?? 0n) + toFils(line.lineTotal));
  }
  const position = (slug: string | null) => (slug === null ? 1_000 : DEPARTMENTS.find(d => d.slug === slug)?.position ?? 999);
  const ranked = Array.from(bySlug, ([slug, fils]) => ({ slug, fils }))
    .filter(entry => entry.fils > 0n)
    .sort((a, b) => (a.fils === b.fils ? position(a.slug) - position(b.slug) : a.fils > b.fils ? -1 : 1));
  const kept = ranked.length > DEPARTMENT_SEGMENTS + 1 ? ranked.slice(0, DEPARTMENT_SEGMENTS) : ranked;
  const rest = ranked.slice(kept.length).reduce((sum, entry) => sum + entry.fils, 0n);
  const segments: { slug: string | null; other?: true; fils: bigint }[] = [...kept];
  if (rest > 0n) segments.push({ slug: null, other: true, fils: rest });
  const percents = wholePercents(segments.map(segment => segment.fils));

  /* What sold most, by takings, then units, then title — a deleted product
     grouped by the title it was sold under. Its share is of the range's takings. */
  const byProduct = new Map<string, { productId: number | null; title: string; units: number; fils: bigint }>();
  let rangeFils = 0n;
  for (const line of lines) {
    if (!inRange.has(kuwaitDay(line.placedAt))) continue;
    const key = line.productId === null ? `title:${line.productTitle}` : `id:${line.productId}`;
    const held = byProduct.get(key) ?? { productId: line.productId, title: line.productTitle, units: 0, fils: 0n };
    held.units += line.quantity;
    held.fils += toFils(line.lineTotal);
    rangeFils += toFils(line.lineTotal);
    byProduct.set(key, held);
  }
  const top = Array.from(byProduct.values())
    .sort((a, b) => (a.fils === b.fils ? b.units - a.units || a.title.localeCompare(b.title) : a.fils > b.fils ? -1 : 1))
    .slice(0, TOP_PRODUCTS)
    .map(entry => ({
      productId: entry.productId,
      title: entry.title,
      units: entry.units,
      sales: fromFils(entry.fils),
      percent: rangeFils === 0n ? 0 : Number((entry.fils * 1000n) / rangeFils) / 10,
    }));

  const accounts = input.accountDays
    ? current.map(day => ({ day, count: input.accountDays!.filter(opened => opened === day).length }))
    : null;

  return {
    range,
    days,
    previousDays: previous.map(day => ({ day, sales: fromFils(filsOn(day)) })),
    forecast,
    totals: {
      sales: { current: fromFils(now_.fils), previous: fromFils(before.fils), change: percentChange(now_.fils, before.fils) },
      orders: { current: now_.orders, previous: before.orders, change: percentChange(now_.orders, before.orders) },
      averageOrder: { current: fromFils(now_.average), previous: fromFils(before.average), change: percentChange(now_.average, before.average) },
      customers: { current: now_.customers, previous: before.customers, change: percentChange(now_.customers, before.customers) },
    },
    departments: segments.map((segment, index) => ({
      slug: segment.slug,
      ...(segment.other ? { other: true as const } : {}),
      sales: fromFils(segment.fils),
      percent: percents[index],
    })),
    top,
    newAccounts: accounts,
    stock: input.stock,
    truncated: input.truncated ?? false,
  };
}

/**
 * How long a variant's shelf lasts at the pace it sold over the last four
 * weeks, in whole days, or null when it did not sell (no pace to measure) or
 * has nothing on the shelf. The stock page and the co-pilot say it; neither
 * acts on it.
 */
export function daysOfCover(stock: number, unitsSold28: number): number | null {
  if (stock <= 0 || unitsSold28 <= 0) return null;
  return Math.floor((stock * 28) / unitsSold28);
}
