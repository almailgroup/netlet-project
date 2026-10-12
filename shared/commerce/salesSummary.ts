/**
 * The overview's business numbers: sales, orders, average order and returns
 * for today, seven days and thirty, a day-by-day line for the chart, and what
 * sold most. Pure, for the reason the finance sums are — a figure an owner
 * reads every morning is one that must be checkable without a database.
 *
 * **Every figure is the frozen line.** `line_total` was copied at the sale, so
 * a price changed today does not rewrite yesterday. A line cancelled before
 * collection is not a sale, and a line priced at zero is an exchange's
 * replacement — the same item counted a second time — so neither arrives
 * here; the database half leaves them out.
 *
 * **Days are Kuwaiti days** (`kuwaitDay`), because "today" for a shop in
 * Kuwait starts at midnight in Kuwait, not at midnight in London. A sale at
 * 1am on a Friday is Friday's.
 *
 * **Sales are gross, and returns are counted beside them**, never netted in:
 * the finance panel is where gross, refunded and net are three figures; here
 * the question is "how is the shop doing", and a return is its own signal.
 */
import { kuwaitDay, KUWAIT_OFFSET_MS } from "../kuwaitDay.js";
import { fromFils, toFils } from "../money.js";

export type SoldLine = {
  orderId: number;
  placedAt: Date;
  lineTotal: string;
  quantity: number;
  productId: number | null;
  productTitle: string;
};

export type PeriodFigures = { sales: string; orders: number; averageOrder: string; returns: number };

export type SalesSummary = {
  periods: { today: PeriodFigures; week: PeriodFigures; month: PeriodFigures };
  /** One entry per Kuwaiti day, oldest first, the last being today. */
  daily: { day: string; sales: string; orders: number }[];
  top: { productId: number | null; title: string; units: number; sales: string }[];
};

export const SUMMARY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Kuwaiti days ending today, oldest first. */
export function lastDays(now: Date, count: number): string[] {
  const days: string[] = [];
  for (let back = count - 1; back >= 0; back--) days.push(kuwaitDay(new Date(now.getTime() - back * DAY_MS)));
  return days;
}

/** The first moment of the oldest of those days, which is how far back to read. */
export function summaryStart(now: Date, count = SUMMARY_DAYS): Date {
  const first = lastDays(now, count)[0];
  return new Date(Date.parse(`${first}T00:00:00Z`) - KUWAIT_OFFSET_MS);
}

function figures(lines: SoldLine[], returns: number): PeriodFigures {
  const sales = lines.reduce((sum, line) => sum + toFils(line.lineTotal), 0n);
  const orders = new Set(lines.map(line => line.orderId)).size;
  /* Rounded to the fil, half up, so the average is a price somebody could pay. */
  const average = orders ? (sales * 2n + BigInt(orders)) / (BigInt(orders) * 2n) : 0n;
  return { sales: fromFils(sales), orders, averageOrder: fromFils(average), returns };
}

/**
 * `returnDays` is the Kuwaiti day each return request was opened on, so the
 * three periods count them by the same calendar as the sales.
 */
export function summarise(lines: SoldLine[], returnDays: string[], now: Date, topCount = 5): SalesSummary {
  const days = lastDays(now, SUMMARY_DAYS);
  const today = days[days.length - 1];
  const week = new Set(days.slice(-7));
  const month = new Set(days);
  const dayOf = new Map(lines.map(line => [line, kuwaitDay(line.placedAt)]));
  const within = (set: Set<string>) => lines.filter(line => set.has(dayOf.get(line)!));
  const returnsIn = (set: Set<string>) => returnDays.filter(day => set.has(day)).length;

  const daily = days.map(day => {
    const onDay = lines.filter(line => dayOf.get(line) === day);
    return {
      day,
      sales: fromFils(onDay.reduce((sum, line) => sum + toFils(line.lineTotal), 0n)),
      orders: new Set(onDay.map(line => line.orderId)).size,
    };
  });

  const byProduct = new Map<string, { productId: number | null; title: string; units: number; fils: bigint }>();
  for (const line of within(month)) {
    /* A deleted product keeps its frozen title, so it is grouped by that. */
    const key = line.productId === null ? `title:${line.productTitle}` : `id:${line.productId}`;
    const held = byProduct.get(key) ?? { productId: line.productId, title: line.productTitle, units: 0, fils: 0n };
    held.units += line.quantity;
    held.fils += toFils(line.lineTotal);
    byProduct.set(key, held);
  }
  const top = Array.from(byProduct.values())
    .sort((left, right) => right.units - left.units || (right.fils > left.fils ? 1 : right.fils < left.fils ? -1 : 0) || left.title.localeCompare(right.title))
    .slice(0, topCount)
    .map(entry => ({ productId: entry.productId, title: entry.title, units: entry.units, sales: fromFils(entry.fils) }));

  return {
    periods: {
      today: figures(within(new Set([today])), returnsIn(new Set([today]))),
      week: figures(within(week), returnsIn(week)),
      month: figures(within(month), returnsIn(month)),
    },
    daily,
    top,
  };
}
