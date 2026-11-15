import { describe, expect, it } from "vitest";
import {
  buildViewsReport,
  conversionOf,
  demandOf,
  MIN_VISITORS_TO_JUDGE,
  sourceOfPath,
  VIEW_CHANNELS,
  type ProductFacts,
} from "./productViews";
import { daysEnding } from "./dashboard";

const NOW = new Date("2026-11-15T12:00:00Z");

describe("where a product page was opened from", () => {
  it("names each part of the shop by its address", () => {
    expect(sourceOfPath("/")).toBe("home");
    expect(sourceOfPath("/search?q=lamp")).toBe("search");
    expect(sourceOfPath("/category/electronics?q=phone")).toBe("search");
    expect(sourceOfPath("/category/electronics")).toBe("browse");
    expect(sourceOfPath("/category/all?offer=1")).toBe("browse");
    expect(sourceOfPath("/categories?dept=style")).toBe("browse");
    expect(sourceOfPath("/brands")).toBe("browse");
    expect(sourceOfPath("/stores")).toBe("browse");
    expect(sourceOfPath("/stores/acme")).toBe("store");
    expect(sourceOfPath("/products/smart-watch")).toBe("product");
    expect(sourceOfPath("/saved?tab=wishlists")).toBe("account");
    expect(sourceOfPath("/cart")).toBe("account");
    expect(sourceOfPath("/account/orders?order=NL-1")).toBe("account");
    expect(sourceOfPath("/gifts/abc")).toBe("account");
    expect(sourceOfPath("/guides/how-to")).toBe("other");
    expect(sourceOfPath("/help")).toBe("other");
  });

  it("calls the first page of a visit outside NetLet", () => {
    expect(sourceOfPath(null)).toBe("outside");
    expect(sourceOfPath(undefined)).toBe("outside");
    expect(sourceOfPath("")).toBe("outside");
  });

  it("is not fooled by a trailing slash or an empty search", () => {
    expect(sourceOfPath("/products/lamp/")).toBe("product");
    expect(sourceOfPath("/category/electronics?q=")).toBe("browse");
  });
});

describe("what the figures say about demand", () => {
  it("never calls a product with too few visitors short of demand", () => {
    expect(demandOf({ views: 0, visitors: 0, orders: 0 }, 5)).toBe("unseen");
    expect(demandOf({ views: 12, visitors: MIN_VISITORS_TO_JUDGE - 1, orders: 0 }, 5)).toBe("few");
  });

  it("tells a product looked at and not bought from one that sells", () => {
    expect(demandOf({ views: 40, visitors: 30, orders: 0 }, 5)).toBe("notBuying");
    expect(demandOf({ views: 40, visitors: 20, orders: 2 }, 5)).toBe("strong");
    expect(demandOf({ views: 40, visitors: 40, orders: 1 }, 5)).toBe("some");
    expect(demandOf({ views: 40, visitors: 40, orders: 1 }, null)).toBe("strong");
  });

  it("counts orders per hundred visitors to one decimal", () => {
    expect(conversionOf(1, 3)).toBe(33.3);
    expect(conversionOf(0, 0)).toBeNull();
  });
});

const fact = (productId: number, sold: Partial<ProductFacts> = {}): ProductFacts => ({
  productId,
  title: `Product ${productId}`,
  titleAr: null,
  handle: `p-${productId}`,
  image: null,
  vendorName: null,
  published: true,
  inCarts: 0,
  units: 0,
  orders: 0,
  ...sold,
});

describe("the report", () => {
  const [today] = daysEnding(NOW, 1);
  const [earlier] = daysEnding(NOW, 1, 3);
  const [lastPeriod] = daysEnding(NOW, 1, 7);

  const report = buildViewsReport({
    now: NOW,
    range: 7,
    ready: true,
    dayChannels: [
      { day: today, channel: "app", views: 6, visitors: 4 },
      { day: today, channel: "web_phone", views: 3, visitors: 3 },
      { day: earlier, channel: "web_computer", views: 1, visitors: 1 },
      { day: lastPeriod, channel: "app", views: 5, visitors: 5 },
      { day: today, channel: "fax", views: 99, visitors: 99 },
    ],
    sources: [
      { source: "search", views: 6, visitors: 5 },
      { source: "home", views: 4, visitors: 3 },
      { source: "telepathy", views: 1, visitors: 1 },
    ],
    productChannels: [
      { productId: 1, channel: "app", views: 6, visitors: 4 },
      { productId: 1, channel: "web_phone", views: 3, visitors: 3 },
      { productId: 2, channel: "web_computer", views: 1, visitors: 1 },
    ],
    productPrevious: [{ productId: 1, views: 3 }],
    products: [fact(2), fact(1, { orders: 1, units: 2, inCarts: 3 }), fact(3)],
    orders: { current: 1, previous: 0 },
    productCount: 3,
  });

  it("totals this period against the one before, leaving out what is not a channel", () => {
    expect(report.totals.views).toEqual({ current: 10, previous: 5, change: 100 });
    expect(report.totals.visitors.current).toBe(8);
    expect(report.totals.orders).toEqual({ current: 1, previous: 0, change: null });
    expect(report.days).toHaveLength(7);
    expect(report.days.at(-1)).toEqual({ day: today, views: 9, visitors: 7, channels: { app: 6, web_phone: 3, web_computer: 0 } });
    expect(report.previousDays.at(-1)).toEqual({ day: lastPeriod, views: 5 });
  });

  it("splits by channel in a fixed order, the percentages adding to a hundred", () => {
    expect(report.channels.map(row => row.channel)).toEqual([...VIEW_CHANNELS]);
    expect(report.channels.map(row => row.views)).toEqual([6, 3, 1]);
    expect(report.channels.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
  });

  it("lists the sources most first, an unknown one as other", () => {
    expect(report.sources.map(row => [row.source, row.views])).toEqual([["search", 6], ["home", 4], ["other", 1]]);
  });

  it("lists the most viewed first and keeps the unviewed", () => {
    expect(report.products.map(row => row.productId)).toEqual([1, 2, 3]);
    const top = report.products[0];
    expect(top).toMatchObject({ views: 9, visitors: 7, previousViews: 3, change: 200, inCarts: 3, units: 2, orders: 1, demand: "few" });
    expect(report.products[2].demand).toBe("unseen");
    expect(report.conversion).toBe(12.5);
  });
});
