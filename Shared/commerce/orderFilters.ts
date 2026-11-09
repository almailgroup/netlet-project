/**
 * The filters at the top of My orders, on the owner's word ("add these filter
 * options at the top of the my order page … I want the orders page to have all
 * the tools that the user needs").
 *
 * A row of views — every order, the ones being processed, the ones on the
 * way, the ones delivered, the ones cancelled — each saying how many it holds,
 * a search by the order's number or anything in it, and how far back to look.
 * The page also carries the returns asked for and the reviews (`ORDER_TABS`'
 * last two), which moved there from the account's home; those are lists of
 * their own and not views of the orders.
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

export const ORDER_VIEWS = ["all", "processing", "onTheWay", "delivered", "cancelled"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/** Every tab on the page: the views of the orders, then the returns and the reviews. */
export const ORDER_TABS = [...ORDER_VIEWS, "returns", "reviews"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

/** How far back to look, in days; "all" is every order. */
export const ORDER_PERIODS = ["all", "30", "90", "180", "365"] as const;
export type OrderPeriod = (typeof ORDER_PERIODS)[number];

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

/** The view an order is filed under, from where it has got to. */
export function viewOfProgress(progress: OrderProgress): Exclude<OrderView, "all"> {
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
 * with or without its dashes, or every word typed found in what was bought —
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
};

/**
 * The orders a view, a search and a period leave, in the order given (newest
 * first), and how many each view holds under the same search and period — so
 * a chip's number is what pressing it shows.
 */
export function filterOrders<T extends FilterableOrder>(
  orders: readonly T[],
  filters: { view?: OrderView; q?: string; period?: OrderPeriod },
  now: Date = new Date(),
): { shown: T[]; counts: OrderCounts } {
  const since = periodStart(filters.period ?? "all", now);
  const q = filters.q ?? "";
  const kept = orders.filter(order =>
    (since === null || new Date(order.placedAt).getTime() >= since.getTime()) && matchesOrderSearch(q, order));
  const counts: OrderCounts = { all: kept.length, processing: 0, onTheWay: 0, delivered: 0, cancelled: 0 };
  for (const order of kept) counts[viewOfProgress(order.progress)] += 1;
  const view = filters.view ?? "all";
  const shown = view === "all" ? kept : kept.filter(order => viewOfProgress(order.progress) === view);
  return { shown, counts };
}
