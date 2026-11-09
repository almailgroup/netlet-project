import { describe, expect, it } from "vitest";
import { filterOrders, isOrderTab, ORDER_TABS, ORDER_VIEWS, matchesOrderSearch, periodStart, viewOfProgress, type FilterableOrder } from "./orderFilters";

/* The Swift app's `OrderFiltersTests` runs these same cases. */
const now = new Date("2026-11-09T12:00:00Z");
const day = 86_400_000;
const order = (reference: string, daysAgo: number, progress: FilterableOrder["progress"], titles: string[]): FilterableOrder => ({
  reference,
  placedAt: new Date(now.getTime() - daysAgo * day).toISOString(),
  progress,
  titles,
});

const orders = [
  order("NL-20261108-AAAA2", 1, { kind: "received", preordered: false }, ["Smart watch", "USB-C charger 65W"]),
  order("NL-20261101-BBBB3", 8, { kind: "onTheWay" }, ["ساعة ذكية"]),
  order("NL-20261015-CCCC4", 25, { kind: "partlyDelivered", delivered: 1, of: 2 }, ["Brass desk lamp"]),
  order("NL-20260801-DDDD6", 100, { kind: "delivered", at: null }, ["Sidr honey 500g"]),
  order("NL-20260501-EEEE7", 190, { kind: "returned" }, ["Stoneware mug"]),
  order("NL-20250101-FFFF8", 677, { kind: "cancelled" }, ["Khalas dates box"]),
];

describe("order filters", () => {
  it("files every progress under the view its pill names", () => {
    expect(viewOfProgress({ kind: "received", preordered: true })).toBe("processing");
    expect(viewOfProgress({ kind: "preparing" })).toBe("processing");
    expect(viewOfProgress({ kind: "onTheWay" })).toBe("onTheWay");
    expect(viewOfProgress({ kind: "partlyDelivered", delivered: 1, of: 3 })).toBe("onTheWay");
    expect(viewOfProgress({ kind: "delivered", at: null })).toBe("delivered");
    expect(viewOfProgress({ kind: "returned" })).toBe("delivered");
    expect(viewOfProgress({ kind: "cancelled" })).toBe("cancelled");
  });

  it("counts each view and shows the one asked for, newest first", () => {
    const { shown, counts } = filterOrders(orders, { view: "onTheWay" }, now);
    expect(counts).toEqual({ all: 6, processing: 1, onTheWay: 2, delivered: 2, cancelled: 1 });
    expect(shown.map(entry => entry.reference)).toEqual(["NL-20261101-BBBB3", "NL-20261015-CCCC4"]);
    expect(filterOrders(orders, {}, now).shown).toHaveLength(6);
  });

  it("looks back as far as the period says, and counts under it", () => {
    expect(periodStart("all", now)).toBeNull();
    expect(periodStart("30", now)?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const { shown, counts } = filterOrders(orders, { period: "90" }, now);
    expect(shown).toHaveLength(3);
    expect(counts).toEqual({ all: 3, processing: 1, onTheWay: 2, delivered: 0, cancelled: 0 });
    expect(filterOrders(orders, { period: "365" }, now).counts.all).toBe(5);
  });

  it("finds an order by its number, with or without dashes, whole or in part", () => {
    const target = orders[1];
    expect(matchesOrderSearch("NL-20261101-BBBB3", target)).toBe(true);
    expect(matchesOrderSearch("nl20261101bbbb3", target)).toBe(true);
    expect(matchesOrderSearch("bbbb3", target)).toBe(true);
    expect(matchesOrderSearch("BBBB9", target)).toBe(false);
  });

  it("finds an order by what is in it, folded and stemmed as the shop's search is", () => {
    expect(matchesOrderSearch("watches", orders[0])).toBe(true);
    expect(matchesOrderSearch("cha", orders[0])).toBe(true);
    expect(matchesOrderSearch("smart charger", orders[0])).toBe(true);
    expect(matchesOrderSearch("smart lamp", orders[0])).toBe(false);
    expect(matchesOrderSearch("ساعه", orders[1])).toBe(true);
    expect(matchesOrderSearch("الساعة", orders[1])).toBe(true);
    expect(matchesOrderSearch("  ", orders[3])).toBe(true);
    expect(matchesOrderSearch("—", orders[3])).toBe(false);
  });

  it("searches, then views, and the counts follow the search", () => {
    const { shown, counts } = filterOrders(orders, { q: "honey", view: "delivered" }, now);
    expect(shown.map(entry => entry.reference)).toEqual(["NL-20260801-DDDD6"]);
    expect(counts).toEqual({ all: 1, processing: 0, onTheWay: 0, delivered: 1, cancelled: 0 });
  });

  it("knows its tabs, in the reference's order, every view among them", () => {
    expect(ORDER_TABS.slice(0, 5)).toEqual(["all", "processing", "onTheWay", "delivered", "returns"]);
    for (const view of ORDER_VIEWS) expect(isOrderTab(view)).toBe(true);
    expect(isOrderTab("returns")).toBe(true);
    expect(isOrderTab("reviews")).toBe(true);
    expect(isOrderTab("toPay")).toBe(false);
  });
});
