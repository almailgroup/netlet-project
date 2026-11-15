/**
 * How many people look at a product, and from where — the store's own
 * measure of demand, on the owner's word ("how many people have viewed their
 * product … categorise it, for example by app views and website views").
 *
 * **A view is a product's page opened.** One row a product, a Kuwaiti day, a
 * channel and a source holds two counts (`product_views`, migration 0084):
 * every opening (`views`), and every phone or computer opening it for the
 * first time that day (`visitors`). **Nothing about who looked is kept** — no
 * account, no address, no device id: the device itself remembers which
 * products it has counted today (`firstToday`), so a second look the same day
 * is a view and not a visitor. The store's own team, NetLet's staff and
 * automated browsers are not counted, so a seller checking their own listing
 * does not read as interest.
 *
 * **Visitors over a period are the days' visitors added up**: somebody who
 * comes back on three days is three. That is what the device can say without
 * the server keeping a history of anybody's browsing, and the page says so.
 *
 * **Demand is views against orders, said as a reading with its working**
 * (`demandOf`): too few visitors to judge is said as that, never as no demand;
 * a product many looked at and nobody bought is told apart from one that
 * sells, against the average of the products on the page.
 */
import { daysEnding, percentChange, wholePercents, type CountChange } from "./dashboard.js";

/** Where the page was opened: the iPhone app, or the website on a phone (or tablet) or a computer. */
export const VIEW_CHANNELS = ["app", "web_phone", "web_computer"] as const;
export type ViewChannel = (typeof VIEW_CHANNELS)[number];

/** Which part of the shop the page was opened from. */
export const VIEW_SOURCES = ["home", "search", "browse", "store", "product", "account", "outside", "other"] as const;
export type ViewSource = (typeof VIEW_SOURCES)[number];

export const VIEW_RANGES = [7, 30, 90] as const;
export type ViewRange = (typeof VIEW_RANGES)[number];
export const DEFAULT_VIEW_RANGE: ViewRange = 30;

/** Below this many visitors in the period, a product's figures say too little to judge. */
export const MIN_VISITORS_TO_JUDGE = 10;

/** At most this many products are listed; the most viewed first, then the unviewed newest. */
export const VIEW_PRODUCT_ROWS = 300;

/** A press that names where the next product page came from is good for this long. */
export const SOURCE_HINT_MS = 10_000;

export function isViewChannel(value: unknown): value is ViewChannel {
  return typeof value === "string" && (VIEW_CHANNELS as readonly string[]).includes(value);
}

export function isViewSource(value: unknown): value is ViewSource {
  return typeof value === "string" && (VIEW_SOURCES as readonly string[]).includes(value);
}

/**
 * The source an address inside the shop stands for — the page a product was
 * opened from, as the website's history records it (`cameFrom`). No address
 * (the first page of a visit: a shared link, a search engine, a bookmark) is
 * from outside NetLet. A department searched (`?q=`) is a search.
 */
export function sourceOfPath(address: string | null | undefined): ViewSource {
  if (!address) return "outside";
  const [rawPath, query = ""] = address.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const searched = new URLSearchParams(query.split("#")[0]).get("q");
  if (path === "/") return "home";
  if (path === "/search") return "search";
  if (path.startsWith("/category/")) return searched ? "search" : "browse";
  if (path === "/categories" || path === "/brands" || path === "/stores") return "browse";
  if (path.startsWith("/stores/")) return "store";
  if (path.startsWith("/products/")) return "product";
  if (path === "/saved" || path === "/cart" || path === "/checkout" || path === "/account" || path.startsWith("/account/") || path.startsWith("/gifts")) return "account";
  return "other";
}

/* ------------------------------------------------------------- the report --- */

export type Demand = "unseen" | "few" | "notBuying" | "some" | "strong";

/**
 * What a product's figures say about demand, against the average of the
 * products beside it (orders per hundred visitors, or null with none).
 */
export function demandOf(product: { views: number; visitors: number; orders: number }, average: number | null): Demand {
  if (product.views === 0) return "unseen";
  if (product.visitors < MIN_VISITORS_TO_JUDGE) return "few";
  if (product.orders === 0) return "notBuying";
  if (average === null || conversionOf(product.orders, product.visitors)! >= average) return "strong";
  return "some";
}

/** Orders per hundred visitors, to one decimal; null with no visitors. */
export function conversionOf(orders: number, visitors: number): number | null {
  if (visitors <= 0) return null;
  return Math.round((orders / visitors) * 1000) / 10;
}

type ByChannel = Record<ViewChannel, number>;
const noChannels = (): ByChannel => ({ app: 0, web_phone: 0, web_computer: 0 });

export type ProductViews = {
  productId: number;
  title: string;
  titleAr: string | null;
  handle: string;
  image: string | null;
  /** The store's name, for an administrator's list across stores; null otherwise. */
  vendorName: string | null;
  published: boolean;
  views: number;
  visitors: number;
  previousViews: number;
  change: number | null;
  /** Views by channel. */
  channels: ByChannel;
  /** Carts holding it, put there in the period and not bought or taken out since. */
  inCarts: number;
  /** Units ordered and the orders they were on, in the period. */
  units: number;
  orders: number;
  conversion: number | null;
  demand: Demand;
};

export type ViewsReport = {
  range: ViewRange;
  /** False before migration 0084 is pasted: nothing is counted yet. */
  ready: boolean;
  /** One per Kuwaiti day of the range, oldest first, the last being today. */
  days: { day: string; views: number; visitors: number; channels: ByChannel }[];
  previousDays: { day: string; views: number }[];
  totals: { views: CountChange; visitors: CountChange; orders: CountChange };
  /** Every channel, in `VIEW_CHANNELS`' order. */
  channels: { channel: ViewChannel; views: number; visitors: number; percent: number }[];
  /** The sources that brought a view, most first. */
  sources: { source: ViewSource; views: number; visitors: number; percent: number }[];
  /** Orders per hundred visitors across the products listed. */
  conversion: number | null;
  products: ProductViews[];
  /** How many products the scope holds on the shelf, listed or not. */
  productCount: number;
};

export type ProductFacts = Omit<ProductViews, "views" | "visitors" | "previousViews" | "change" | "channels" | "conversion" | "demand">;

export function buildViewsReport(input: {
  now: Date;
  range: ViewRange;
  ready: boolean;
  /** Views and visitors per day and channel, over both periods. */
  dayChannels: { day: string; channel: string; views: number; visitors: number }[];
  /** Per source, over the current period. */
  sources: { source: string; views: number; visitors: number }[];
  /** Per product and channel, over the current period. */
  productChannels: { productId: number; channel: string; views: number; visitors: number }[];
  /** Per product, over the period before. */
  productPrevious: { productId: number; views: number }[];
  /** The products to list, with what they sold and how many carts hold them. */
  products: ProductFacts[];
  /** Distinct orders in scope, this period and the one before. */
  orders: { current: number; previous: number };
  productCount: number;
}): ViewsReport {
  const current = daysEnding(input.now, input.range);
  const previous = daysEnding(input.now, input.range, input.range);
  const inCurrent = new Set(current);
  const inPrevious = new Set(previous);

  const dayMap = new Map<string, { views: number; visitors: number; channels: ByChannel }>();
  const channelTotals = new Map<ViewChannel, { views: number; visitors: number }>();
  let views = 0;
  let visitors = 0;
  let previousViews = 0;
  let previousVisitors = 0;
  for (const row of input.dayChannels) {
    if (!isViewChannel(row.channel)) continue;
    if (inCurrent.has(row.day)) {
      const day = dayMap.get(row.day) ?? { views: 0, visitors: 0, channels: noChannels() };
      day.views += row.views;
      day.visitors += row.visitors;
      day.channels[row.channel] += row.views;
      dayMap.set(row.day, day);
      const held = channelTotals.get(row.channel) ?? { views: 0, visitors: 0 };
      held.views += row.views;
      held.visitors += row.visitors;
      channelTotals.set(row.channel, held);
      views += row.views;
      visitors += row.visitors;
    } else if (inPrevious.has(row.day)) {
      const day = dayMap.get(row.day) ?? { views: 0, visitors: 0, channels: noChannels() };
      day.views += row.views;
      dayMap.set(row.day, day);
      previousViews += row.views;
      previousVisitors += row.visitors;
    }
  }

  const channelRows = VIEW_CHANNELS.map(channel => ({ channel, ...(channelTotals.get(channel) ?? { views: 0, visitors: 0 }) }));
  const channelPercents = wholePercents(channelRows.map(row => BigInt(row.views)));

  const sourceMap = new Map<ViewSource, { views: number; visitors: number }>();
  for (const row of input.sources) {
    const source: ViewSource = isViewSource(row.source) ? row.source : "other";
    const held = sourceMap.get(source) ?? { views: 0, visitors: 0 };
    held.views += row.views;
    held.visitors += row.visitors;
    sourceMap.set(source, held);
  }
  const sourceRows = VIEW_SOURCES.map(source => ({ source, ...(sourceMap.get(source) ?? { views: 0, visitors: 0 }) }))
    .filter(row => row.views > 0)
    .sort((a, b) => b.views - a.views || VIEW_SOURCES.indexOf(a.source) - VIEW_SOURCES.indexOf(b.source));
  const sourcePercents = wholePercents(sourceRows.map(row => BigInt(row.views)));

  const perProduct = new Map<number, { views: number; visitors: number; channels: ByChannel }>();
  for (const row of input.productChannels) {
    if (!isViewChannel(row.channel)) continue;
    const held = perProduct.get(row.productId) ?? { views: 0, visitors: 0, channels: noChannels() };
    held.views += row.views;
    held.visitors += row.visitors;
    held.channels[row.channel] += row.views;
    perProduct.set(row.productId, held);
  }
  const before = new Map(input.productPrevious.map(row => [row.productId, row.views]));

  const listedVisitors = input.products.reduce((sum, product) => sum + (perProduct.get(product.productId)?.visitors ?? 0), 0);
  const listedOrders = input.products.reduce((sum, product) => sum + product.orders, 0);
  const average = conversionOf(listedOrders, listedVisitors);

  const products: ProductViews[] = input.products
    .map(product => {
      const counted = perProduct.get(product.productId) ?? { views: 0, visitors: 0, channels: noChannels() };
      const was = before.get(product.productId) ?? 0;
      return {
        ...product,
        views: counted.views,
        visitors: counted.visitors,
        previousViews: was,
        change: percentChange(counted.views, was),
        channels: counted.channels,
        conversion: conversionOf(product.orders, counted.visitors),
        demand: demandOf({ views: counted.views, visitors: counted.visitors, orders: product.orders }, average),
      };
    })
    .sort((a, b) => b.views - a.views || b.visitors - a.visitors || b.orders - a.orders || a.productId - b.productId);

  return {
    range: input.range,
    ready: input.ready,
    days: current.map(day => {
      const held = dayMap.get(day);
      return { day, views: held?.views ?? 0, visitors: held?.visitors ?? 0, channels: held?.channels ?? noChannels() };
    }),
    previousDays: previous.map(day => ({ day, views: dayMap.get(day)?.views ?? 0 })),
    totals: {
      views: { current: views, previous: previousViews, change: percentChange(views, previousViews) },
      visitors: { current: visitors, previous: previousVisitors, change: percentChange(visitors, previousVisitors) },
      orders: { current: input.orders.current, previous: input.orders.previous, change: percentChange(input.orders.current, input.orders.previous) },
    },
    channels: channelRows.map((row, index) => ({ ...row, percent: channelPercents[index] })),
    sources: sourceRows.map((row, index) => ({ ...row, percent: sourcePercents[index] })),
    conversion: average,
    products,
    productCount: input.productCount,
  };
}
