/**
 * The filters on My orders, on the owner's word ("add these filter options at
 * the top of the my order page … I want the orders page to have all the tools
 * that the user needs") — **a search bar with a filter button beside it, and
 * the filter a page of its own, also on the owner's word** ("all bar up
 * removed, only add search bar and in the side filter"). The row of tabs and
 * the sort went.
 *
 * The filter page offers the order's status (`ORDER_STATUSES`, in the
 * owner's order: received, being prepared, shipped, delivered, then
 * cancelled), then the returns and refunds asked for (`ORDER_LISTS`), a list
 * of its own and not a view of the orders, offered beside the statuses on the
 * owner's word ("add return/refund up and cancel review"); the last 30 days,
 * the last 3 months or two days of one's own (`ORDER_DATE_CHOICES`), and a
 * year. The reviews are no longer offered there — each item is rated under
 * its photo — and an old address naming them still opens them. The search
 * finds an order by its number, anything in it, or the store it came from.
 *
 * **A view is read off `orderProgress`, never a second rule.** The pill on a
 * row says where the order has got to; the view it is filed under is that same
 * answer grouped, so an order never reads "On the way" under Delivered. An
 * order that came back whole was delivered first and is filed there, its pill
 * saying "Returned"; its return is under Returns.
 *
 * **It is decided on the server, over every order the shopper has.** A filter
 * applied to the page already fetched searches twenty orders and says "none"
 * about the twenty-first — the admin lists' rule. `filterOrders` is the whole
 * of it and is pure, so the counts on the chips and the list under them are
 * one computation and cannot disagree.
 */
import type { OrderProgress } from "./orderProgress.js";
import { foldText, searchWords } from "./search.js";
import { toFils } from "../money.js";
import { DAY_ONLY, endOfKuwaitDay, kuwaitDay } from "../kuwaitDay.js";
import { isOnlineMethod } from "./onlinePayment.js";

/**
 * What an order is filed under. `processing` is `received` and `preparing`
 * together — the tab before the filter page, kept for an installed app and an
 * old address.
 */
export const ORDER_VIEWS = ["all", "received", "preparing", "processing", "onTheWay", "delivered", "cancelled"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/**
 * The statuses the filter page offers, in the owner's order ("pending,
 * received, ready to ship, shipped, delivered"): an order received and not
 * yet started (the store's "Pending"), one being prepared, one shipped, one
 * delivered — then one cancelled. NetLet has no step between a store
 * preparing an order and it leaving, so "ready to ship" is "being prepared".
 */
export const ORDER_STATUSES = ["received", "preparing", "onTheWay", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The lists of their own the filter page leads to, drawn after the statuses:
 * the returns and refunds asked for. Reviews left the page on the owner's word
 * ("cancel review"); `reviews` stays in `ORDER_TABS` so an old address answers.
 */
export const ORDER_LISTS = ["returns"] as const;

/** How far back the filter page offers, in days — the last 30 days and the last 3 months — beside two days of one's own. */
export const ORDER_DATE_CHOICES = ["30", "90"] as const;

/** Everything the page can show: every order, a status, the old Processing, the returns, or the reviews an old address names. */
export const ORDER_TABS = ["all", "received", "preparing", "processing", "onTheWay", "delivered", "returns", "cancelled", "reviews"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

/** How far back to look, in days; "all" is every order. */
export const ORDER_PERIODS = ["all", "30", "90", "180", "365"] as const;
export type OrderPeriod = (typeof ORDER_PERIODS)[number];

/**
 * The rest of the filters, on the owner's word ("a filter option at the top of
 * the my order page in which the user can set custom dates … give the user as
 * many options as you can, but keep it as user friendly as possible"): a
 * chip each under the tabs, every one a short list of choices.
 *
 * - **When**: the periods above, a year the shopper ordered in, or two days of
 *   their own (`from`, `to`, Kuwaiti calendar days, both kept). A year is
 *   those two days set to its first and last, so a bookmark of "2025" is the
 *   same address as the dates typed by hand.
 * - **Store**: one of the stores the shopper has bought from, with how many
 *   orders each was in.
 * - **How it was paid**: cash at the door, or paid online.
 * - **What it came to**: four bands of the order's total as placed.
 * - **Order**: newest or oldest first, or by the total either way.
 */
export const ORDER_SORTS = ["newest", "oldest", "highest", "lowest"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export const ORDER_PAYMENTS = ["all", "cod", "online"] as const;
export type OrderPayment = (typeof ORDER_PAYMENTS)[number];

export const ORDER_TOTALS = ["all", "under10", "10to50", "50to100", "over100"] as const;
export type OrderTotal = (typeof ORDER_TOTALS)[number];

/** Each band of the total, in whole dinars, from its first fils up to (and not
    including) its last: an order of exactly KWD 50 is in 50 to 100. */
export const ORDER_TOTAL_BANDS: Record<Exclude<OrderTotal, "all">, { min: number | null; max: number | null }> = {
  under10: { min: null, max: 10 },
  "10to50": { min: 10, max: 50 },
  "50to100": { min: 50, max: 100 },
  over100: { min: 100, max: null },
};

export function isOrderSort(value: unknown): value is OrderSort {
  return typeof value === "string" && (ORDER_SORTS as readonly string[]).includes(value);
}

export function isOrderPayment(value: unknown): value is OrderPayment {
  return typeof value === "string" && (ORDER_PAYMENTS as readonly string[]).includes(value);
}

export function isOrderTotal(value: unknown): value is OrderTotal {
  return typeof value === "string" && (ORDER_TOTALS as readonly string[]).includes(value);
}

/** A calendar day as a date box sends it, and one the calendar has: "2026-02-30" is not. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_ONLY.test(value)) return false;
  const when = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(when.getTime()) && when.toISOString().slice(0, 10) === value;
}

/**
 * The moments two days bound, as Kuwait counts them: from the first moment of
 * `from` to the last of `to`, either left open. Two days the wrong way round
 * are the days between them — somebody who picked the later day first meant
 * the same span — and a day that is not one is left open rather than refusing
 * the list.
 */
export function dayBounds(from?: string | null, to?: string | null): { start: Date | null; end: Date | null } {
  let first = isCalendarDay(from) ? from : null;
  let last = isCalendarDay(to) ? to : null;
  if (first && last && first > last) [first, last] = [last, first];
  return {
    start: first ? new Date(Date.parse(`${first}T00:00:00+03:00`)) : null,
    end: last ? endOfKuwaitDay(last) : null,
  };
}

/** A year's first and last day, which is how a year is chosen. */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The year two days are exactly, or null: how the chip knows to say "2025". */
export function yearOfRange(from?: string | null, to?: string | null): number | null {
  if (!isCalendarDay(from) || !isCalendarDay(to)) return null;
  const year = Number(from.slice(0, 4));
  return from === `${year}-01-01` && to === `${year}-12-31` ? year : null;
}

/** The years the shopper ordered in, as Kuwait counts them, newest first. */
export function orderYears(orders: readonly { placedAt: Date | string }[]): number[] {
  const years = new Set(orders.map(order => Number(kuwaitDay(new Date(order.placedAt)).slice(0, 4))));
  return [...years].sort((a, b) => b - a);
}

/** How an order was paid, by its chosen way: anything but cash is online. */
export function paymentOf(paymentMethod: string | null | undefined): Exclude<OrderPayment, "all"> {
  return isOnlineMethod(paymentMethod) ? "online" : "cod";
}

/** Whether an order's total is in a band. */
export function inTotalBand(total: string, band: OrderTotal): boolean {
  if (band === "all") return true;
  const { min, max } = ORDER_TOTAL_BANDS[band];
  const fils = toFils(total);
  return (min === null || fils >= BigInt(min) * 1000n) && (max === null || fils < BigInt(max) * 1000n);
}

export type OrderStoreOption = { id: number; name: string; count: number };

/**
 * The stores the shopper has bought from, each with how many orders it was
 * in, the most first and then by name; a store's name is the one its latest
 * order froze. A store whose row has gone (no id) is not a choice.
 */
export function storesOf(orders: readonly { stores?: readonly { id: number | null; name: string | null }[] }[]): OrderStoreOption[] {
  const found = new Map<number, OrderStoreOption>();
  for (const order of orders) {
    const seen = new Set<number>();
    for (const store of order.stores ?? []) {
      if (store.id === null || seen.has(store.id)) continue;
      seen.add(store.id);
      const entry = found.get(store.id);
      if (entry) entry.count += 1;
      else found.set(store.id, { id: store.id, name: store.name?.trim() || "", count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id - b.id);
}

/** The list in the order asked for. Ties keep the order given, which is newest first. */
export function sortOrders<T extends { grandTotal?: string }>(orders: readonly T[], sort: OrderSort = "newest"): T[] {
  if (sort === "newest") return [...orders];
  if (sort === "oldest") return [...orders].reverse();
  const indexed = orders.map((order, index) => ({ order, index, fils: toFils(order.grandTotal ?? "0") }));
  indexed.sort((a, b) => {
    if (a.fils !== b.fils) return (sort === "highest" ? a.fils < b.fils : a.fils > b.fils) ? 1 : -1;
    return a.index - b.index;
  });
  return indexed.map(entry => entry.order);
}

/** Every filter on the page but the tab, as the address and the API carry them. */
export type OrderFilterSet = {
  view?: OrderView;
  q?: string;
  period?: OrderPeriod;
  from?: string | null;
  to?: string | null;
  store?: number | null;
  payment?: OrderPayment;
  total?: OrderTotal;
  sort?: OrderSort;
};

/** How many filters are set — a status, the date counting once, the order of the list never. */
export function narrowingCount(filters: OrderFilterSet): number {
  const dated = (filters.period && filters.period !== "all") || isCalendarDay(filters.from) || isCalendarDay(filters.to);
  return (filters.view && filters.view !== "all" ? 1 : 0)
    + (dated ? 1 : 0)
    + (filters.store ? 1 : 0)
    + (filters.payment && filters.payment !== "all" ? 1 : 0)
    + (filters.total && filters.total !== "all" ? 1 : 0);
}

/**
 * How many of a shopper's orders the filters read, newest first. Far past what
 * anybody orders from one shop, and a ceiling the answer says it reached
 * rather than a list that quietly stops.
 */
export const ORDER_SCAN_CEILING = 1000;

/** The longest search a shopper types into the box. */
export const ORDER_SEARCH_MAX = 80;

export function isOrderView(value: unknown): value is OrderView {
  return typeof value === "string" && (ORDER_VIEWS as readonly string[]).includes(value);
}

export function isOrderTab(value: unknown): value is OrderTab {
  return typeof value === "string" && (ORDER_TABS as readonly string[]).includes(value);
}

export function isOrderPeriod(value: unknown): value is OrderPeriod {
  return typeof value === "string" && (ORDER_PERIODS as readonly string[]).includes(value);
}

/**
 * The status an order is filed under on the filter page, from where it has
 * got to: received and being prepared apart, part-delivered with shipped, one
 * that came back whole with delivered (its return is under Returns).
 */
export function statusOfProgress(progress: OrderProgress): OrderStatus {
  switch (progress.kind) {
    case "received": return "received";
    case "preparing": return "preparing";
    case "onTheWay":
    case "partlyDelivered":
      return "onTheWay";
    case "delivered":
    case "returned":
      return "delivered";
    case "cancelled": return "cancelled";
  }
}

/** Whether an order is under a view: every order, a status, or Processing (received and being prepared). */
export function inView(progress: OrderProgress, view: OrderView): boolean {
  if (view === "all") return true;
  if (view === "processing") return viewOfProgress(progress) === "processing";
  return statusOfProgress(progress) === view;
}

/** The coarser view an order was filed under before the filter page, for an installed app. */
export function viewOfProgress(progress: OrderProgress): "processing" | "onTheWay" | "delivered" | "cancelled" {
  switch (progress.kind) {
    case "received":
    case "preparing":
      return "processing";
    case "onTheWay":
    case "partlyDelivered":
      return "onTheWay";
    case "delivered":
    case "returned":
      return "delivered";
    case "cancelled":
      return "cancelled";
  }
}

/** The first moment an order placed in the period may have been placed, or null for all of them. */
export function periodStart(period: OrderPeriod, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - Number(period) * 86_400_000);
}

/** An order number as typed or printed, without its dashes or spaces: "nl 20261012 3nja9" is "NL202610123NJA9". */
function compactReference(text: string): string {
  return foldText(text).replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
}

/**
 * Whether an order answers the search: its number, typed whole or in part
 * with or without its dashes, or every word typed found in what was bought or
 * the store it came from (the server adds the stores' names to `titles`, on
 * the owner's word: "he can search by the filter bar for any name") —
 * folded and stemmed as the shop's own search compares words, so "ساعه" finds
 * "ساعة ذكية" and "watches" finds "Smart watch", and a word typed in part
 * ("cha") finds the word it starts.
 */
export function matchesOrderSearch(query: string, order: { reference: string; titles: readonly string[] }): boolean {
  const typed = query.trim();
  if (!typed) return true;
  const compact = compactReference(typed);
  if (compact.length >= 3 && compactReference(order.reference).includes(compact)) return true;
  const wanted = searchWords(typed);
  if (wanted.length === 0) return false;
  const words = order.titles.flatMap(title => searchWords(title));
  return wanted.every(word => words.some(have => have.startsWith(word) || have.includes(word)));
}

export type OrderCounts = Record<OrderView, number>;

export type FilterableOrder = {
  reference: string;
  placedAt: Date | string;
  progress: OrderProgress;
  /** What is in it, by the lines' own titles. */
  titles: readonly string[];
  /** The stores its lines came from, by the id and the name each line froze. */
  stores?: readonly { id: number | null; name: string | null }[];
  /** How it is paid: "cod", or the online way chosen. */
  paymentMethod?: string | null;
  /** What it came to as placed. */
  grandTotal?: string;
};

/**
 * The orders the filters leave, in the order asked for (newest first unless
 * told otherwise), and how many each view holds under every other filter — so
 * a tab's number is what pressing it shows.
 */
export function filterOrders<T extends FilterableOrder>(
  orders: readonly T[],
  filters: OrderFilterSet,
  now: Date = new Date(),
): { shown: T[]; counts: OrderCounts } {
  const since = periodStart(filters.period ?? "all", now);
  const { start, end } = dayBounds(filters.from, filters.to);
  const q = filters.q ?? "";
  const payment = filters.payment ?? "all";
  const total = filters.total ?? "all";
  const kept = orders.filter(order => {
    const placed = new Date(order.placedAt).getTime();
    return (since === null || placed >= since.getTime())
      && (start === null || placed >= start.getTime())
      && (end === null || placed <= end.getTime())
      && (!filters.store || (order.stores ?? []).some(store => store.id === filters.store))
      && (payment === "all" || paymentOf(order.paymentMethod) === payment)
      && (total === "all" || inTotalBand(order.grandTotal ?? "0", total))
      && matchesOrderSearch(q, order);
  });
  const counts: OrderCounts = { all: kept.length, received: 0, preparing: 0, processing: 0, onTheWay: 0, delivered: 0, cancelled: 0 };
  for (const order of kept) {
    counts[statusOfProgress(order.progress)] += 1;
    if (viewOfProgress(order.progress) === "processing") counts.processing += 1;
  }
  const view = filters.view ?? "all";
  const viewed = view === "all" ? kept : kept.filter(order => inView(order.progress, view));
  return { shown: sortOrders(viewed, filters.sort ?? "newest"), counts };
}
