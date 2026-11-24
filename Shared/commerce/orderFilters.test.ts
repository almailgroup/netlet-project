import { describe, expect, it } from "vitest";
import {
  dayBounds, filterOrders, inTotalBand, inView, isCalendarDay, isOrderTab, narrowingCount, ORDER_DATE_CHOICES, ORDER_LISTS, ORDER_STATUSES,
  ORDER_TABS, ORDER_VIEWS, matchesOrderSearch, orderYears, paymentOf, periodStart, sortOrders, statusOfProgress, storesOf, viewOfProgress,
  yearOfRange, yearRange, type FilterableOrder,
} from "./orderFilters";

/* The server filters; the app sends one of each and draws the answer. */
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

  /* The owner's filter page: received, being prepared, shipped, delivered, cancelled. */
  it("files every progress under the status the filter page offers", () => {
    expect(ORDER_STATUSES).toEqual(["received", "preparing", "onTheWay", "delivered", "cancelled"]);
    expect(statusOfProgress({ kind: "received", preordered: false })).toBe("received");
    expect(statusOfProgress({ kind: "preparing" })).toBe("preparing");
    expect(statusOfProgress({ kind: "partlyDelivered", delivered: 1, of: 3 })).toBe("onTheWay");
    expect(statusOfProgress({ kind: "returned" })).toBe("delivered");
    expect(inView({ kind: "preparing" }, "processing")).toBe(true);
    expect(inView({ kind: "preparing" }, "received")).toBe(false);
    expect(inView({ kind: "received", preordered: false }, "received")).toBe(true);
    expect(inView({ kind: "cancelled" }, "all")).toBe(true);
    for (const status of ORDER_STATUSES) expect(isOrderTab(status)).toBe(true);
    expect(ORDER_LISTS).toEqual(["returns", "reviews"]);
    expect(ORDER_DATE_CHOICES).toEqual(["30", "90"]);
  });

  it("shows one status and counts each", () => {
    const { shown, counts } = filterOrders(orders, { view: "received" }, now);
    expect(shown.map(entry => entry.reference)).toEqual(["NL-20261108-AAAA2"]);
    expect(counts.received).toBe(1);
    expect(counts.preparing).toBe(0);
    expect(filterOrders(orders, { view: "processing" }, now).shown).toHaveLength(1);
  });

  it("counts each view and shows the one asked for, newest first", () => {
    const { shown, counts } = filterOrders(orders, { view: "onTheWay" }, now);
    expect(counts).toEqual({ all: 6, received: 1, preparing: 0, processing: 1, onTheWay: 2, delivered: 2, cancelled: 1 });
    expect(shown.map(entry => entry.reference)).toEqual(["NL-20261101-BBBB3", "NL-20261015-CCCC4"]);
    expect(filterOrders(orders, {}, now).shown).toHaveLength(6);
  });

  it("looks back as far as the period says, and counts under it", () => {
    expect(periodStart("all", now)).toBeNull();
    expect(periodStart("30", now)?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const { shown, counts } = filterOrders(orders, { period: "90" }, now);
    expect(shown).toHaveLength(3);
    expect(counts).toEqual({ all: 3, received: 1, preparing: 0, processing: 1, onTheWay: 2, delivered: 0, cancelled: 0 });
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
    expect(counts).toEqual({ all: 1, received: 0, preparing: 0, processing: 0, onTheWay: 0, delivered: 1, cancelled: 0 });
  });

  it("knows everything the page can show, every view among them", () => {
    expect(ORDER_TABS.slice(0, 3)).toEqual(["all", "received", "preparing"]);
    for (const view of ORDER_VIEWS) expect(isOrderTab(view)).toBe(true);
    expect(isOrderTab("returns")).toBe(true);
    expect(isOrderTab("reviews")).toBe(true);
    expect(isOrderTab("toPay")).toBe(false);
  });

  describe("the chips under the tabs", () => {
    const store = (id: number, name: string) => ({ id, name });
    const priced: FilterableOrder[] = [
      { ...orders[0], stores: [store(1, "Gadget Hub"), store(2, "Acme Home")], paymentMethod: "cod", grandTotal: "41.400" },
      { ...orders[1], stores: [store(1, "Gadget Hub")], paymentMethod: "knet", grandTotal: "9.999" },
      { ...orders[2], stores: [store(2, "Acme Home")], paymentMethod: "cod", grandTotal: "50.000" },
      { ...orders[3], stores: [store(3, "Sidr Farm"), store(3, "Sidr Farm")], paymentMethod: "apple_pay", grandTotal: "120.000" },
      { ...orders[4], stores: [{ id: null, name: "Gone" }], paymentMethod: null, grandTotal: "10.000" },
      { ...orders[5], stores: [store(2, "Acme Home")], paymentMethod: "cod", grandTotal: "100.000" },
    ];

    it("knows a calendar day from a string that looks like one", () => {
      expect(isCalendarDay("2026-02-28")).toBe(true);
      expect(isCalendarDay("2024-02-29")).toBe(true);
      expect(isCalendarDay("2026-02-30")).toBe(false);
      expect(isCalendarDay("2026-2-3")).toBe(false);
      expect(isCalendarDay(null)).toBe(false);
    });

    it("bounds two days as Kuwait counts them, either way round", () => {
      const { start, end } = dayBounds("2026-10-01", "2026-10-31");
      expect(start?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
      expect(end?.toISOString()).toBe("2026-10-31T20:59:59.999Z");
      expect(dayBounds("2026-10-31", "2026-10-01")).toEqual(dayBounds("2026-10-01", "2026-10-31"));
      expect(dayBounds("2026-10-01", null).end).toBeNull();
      expect(dayBounds("nonsense", "2026-10-01").start).toBeNull();
    });

    it("keeps the orders placed between two days, the last day whole", () => {
      // NL-20261101 was placed 8 days before 9 November at noon: the 1st.
      expect(filterOrders(priced, { from: "2026-10-15", to: "2026-11-01" }, now).shown.map(entry => entry.reference))
        .toEqual(["NL-20261101-BBBB3", "NL-20261015-CCCC4"]);
      expect(filterOrders(priced, { from: "2026-11-02" }, now).shown).toHaveLength(1);
      expect(filterOrders(priced, { to: "2025-12-31" }, now).shown.map(entry => entry.reference)).toEqual(["NL-20250101-FFFF8"]);
    });

    it("says a year as its first and last day, and reads it back", () => {
      expect(yearRange(2025)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
      expect(yearOfRange("2025-01-01", "2025-12-31")).toBe(2025);
      expect(yearOfRange("2025-01-02", "2025-12-31")).toBeNull();
      expect(yearOfRange("2025-01-01", "2026-12-31")).toBeNull();
      expect(orderYears(priced)).toEqual([2026, 2025]);
      expect(filterOrders(priced, yearRange(2025), now).shown).toHaveLength(1);
    });

    it("lists the stores bought from, the most orders first, a store once per order", () => {
      expect(storesOf(priced)).toEqual([
        { id: 2, name: "Acme Home", count: 3 },
        { id: 1, name: "Gadget Hub", count: 2 },
        { id: 3, name: "Sidr Farm", count: 1 },
      ]);
      expect(filterOrders(priced, { store: 1 }, now).shown.map(entry => entry.reference)).toEqual(["NL-20261108-AAAA2", "NL-20261101-BBBB3"]);
    });

    it("tells cash from paid online", () => {
      expect(paymentOf("cod")).toBe("cod");
      expect(paymentOf(null)).toBe("cod");
      expect(paymentOf("knet")).toBe("online");
      expect(paymentOf("apple_pay")).toBe("online");
      expect(filterOrders(priced, { payment: "online" }, now).shown).toHaveLength(2);
      expect(filterOrders(priced, { payment: "cod" }, now).shown).toHaveLength(4);
    });

    it("bands the total from its first fils up to its last", () => {
      expect(inTotalBand("9.999", "under10")).toBe(true);
      expect(inTotalBand("10.000", "under10")).toBe(false);
      expect(inTotalBand("10.000", "10to50")).toBe(true);
      expect(inTotalBand("50.000", "10to50")).toBe(false);
      expect(inTotalBand("50.000", "50to100")).toBe(true);
      expect(inTotalBand("100.000", "over100")).toBe(true);
      expect(filterOrders(priced, { total: "10to50" }, now).shown.map(entry => entry.grandTotal)).toEqual(["41.400", "10.000"]);
    });

    it("sorts by date or total, ties newest first", () => {
      expect(sortOrders(priced, "oldest").map(entry => entry.reference)[0]).toBe("NL-20250101-FFFF8");
      expect(sortOrders(priced, "highest").map(entry => entry.grandTotal)).toEqual(["120.000", "100.000", "50.000", "41.400", "10.000", "9.999"]);
      expect(sortOrders(priced, "lowest").map(entry => entry.grandTotal)).toEqual(["9.999", "10.000", "41.400", "50.000", "100.000", "120.000"]);
      const tied = [{ ...priced[0], reference: "A", grandTotal: "5.000" }, { ...priced[1], reference: "B", grandTotal: "5.000" }];
      expect(sortOrders(tied, "highest").map(entry => entry.reference)).toEqual(["A", "B"]);
      expect(filterOrders(priced, { sort: "oldest", view: "delivered" }, now).shown.map(entry => entry.reference))
        .toEqual(["NL-20260501-EEEE7", "NL-20260801-DDDD6"]);
    });

    it("counts each view under every other chip", () => {
      expect(filterOrders(priced, { payment: "cod", total: "over100" }, now).counts)
        .toEqual({ all: 1, received: 0, preparing: 0, processing: 0, onTheWay: 0, delivered: 0, cancelled: 1 });
    });

    it("counts the chips that narrow, the date once and the order never", () => {
      expect(narrowingCount({})).toBe(0);
      /* A status is a filter now, on the filter page. */
      expect(narrowingCount({ view: "delivered" })).toBe(1);
      expect(narrowingCount({ view: "all" })).toBe(0);
      expect(narrowingCount({ period: "30", from: "2026-01-01" })).toBe(1);
      expect(narrowingCount({ from: "2026-01-01", store: 2, payment: "online", total: "under10", sort: "oldest" })).toBe(4);
      expect(narrowingCount({ period: "all", payment: "all", total: "all", sort: "highest" })).toBe(0);
    });
  });
});
