import { describe, expect, it } from "vitest";
import {
  buildDashboard,
  daysEnding,
  daysOfCover,
  dashboardStart,
  percentChange,
  stockState,
  wholePercents,
  type DashboardLine,
} from "./dashboard.js";

/* 2026-10-12 is a Monday; 07:00Z is 10am in Kuwait. */
const NOW = new Date("2026-10-12T07:00:00Z");
const STOCK = { healthy: 0, low: 0, out: 0, preorder: 0 };
let order = 0;

function line(day: string, total: string, extra: Partial<DashboardLine> = {}): DashboardLine {
  return {
    orderId: ++order,
    /* Noon in Kuwait on that day. */
    placedAt: new Date(`${day}T09:00:00Z`),
    lineTotal: total,
    quantity: 1,
    buyerId: 1,
    department: "electronics",
    productId: 1,
    productTitle: "Lamp",
    ...extra,
  };
}

describe("the dashboard", () => {
  it("counts days as Kuwait does, the last being today", () => {
    expect(daysEnding(NOW, 3)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(daysEnding(NOW, 2, 2)).toEqual(["2026-10-09", "2026-10-10"]);
    /* 22:30Z on the 11th is half past one on the 12th in Kuwait. */
    expect(daysEnding(new Date("2026-10-11T22:30:00Z"), 1)).toEqual(["2026-10-12"]);
  });

  it("reads back far enough for the period before and the weeks the estimate averages", () => {
    expect(dashboardStart(NOW, 7).toISOString()).toBe("2026-09-13T21:00:00.000Z");
    expect(dashboardStart(NOW, 30).toISOString()).toBe("2026-08-13T21:00:00.000Z");
  });

  it("compares the period with the one before it, and says nothing about a rise from zero", () => {
    const lines = [
      line("2026-10-12", "30.000", { buyerId: 1 }),
      line("2026-10-11", "10.000", { buyerId: 1 }),
      line("2026-10-10", "20.000", { buyerId: 2 }),
      /* The week before. */
      line("2026-10-04", "40.000", { buyerId: 3 }),
    ];
    const board = buildDashboard({ lines, now: NOW, range: 7, stock: STOCK, accountDays: null });
    expect(board.days).toHaveLength(7);
    expect(board.days.at(-1)).toMatchObject({ day: "2026-10-12", sales: "30.000", orders: 1 });
    expect(board.totals.sales).toEqual({ current: "60.000", previous: "40.000", change: 50 });
    expect(board.totals.orders).toEqual({ current: 3, previous: 1, change: 200 });
    /* One customer on two days is one customer. */
    expect(board.totals.customers).toEqual({ current: 2, previous: 1, change: 100 });
    expect(board.totals.averageOrder).toEqual({ current: "20.000", previous: "40.000", change: -50 });
    expect(board.previousDays.map(day => day.day)).toEqual(daysEnding(NOW, 7, 7));

    const fresh = buildDashboard({ lines: [line("2026-10-12", "5.000")], now: NOW, range: 7, stock: STOCK, accountDays: null });
    expect(fresh.totals.sales.change).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("estimates each coming day from the same weekday over the last four whole weeks", () => {
    /* Tuesdays 6, 29 Sep and the 22nd, 15th; and a Wednesday. Today (Monday) is not averaged. */
    const lines = [
      line("2026-10-06", "10.000"),
      line("2026-09-29", "20.000"),
      line("2026-09-22", "30.000"),
      line("2026-09-15", "40.000"),
      /* Five weeks back: outside the four. */
      line("2026-09-08", "1000.000"),
      line("2026-10-07", "7.000"),
      line("2026-10-12", "500.000"),
    ];
    const board = buildDashboard({ lines, now: NOW, range: 30, stock: STOCK, accountDays: null });
    expect(board.forecast).toHaveLength(7);
    expect(board.forecast[0]).toEqual({ day: "2026-10-13", sales: "25.000" });
    /* Wednesday: one sale of 7 over four Wednesdays, rounded half up to the fil. */
    expect(board.forecast[1]).toEqual({ day: "2026-10-14", sales: "1.750" });
    /* Next Monday: the four Mondays before today, none of which sold. */
    expect(board.forecast[6]).toEqual({ day: "2026-10-19", sales: "0.000" });
  });

  it("breaks revenue down by department, biggest first, the rest as one", () => {
    const lines = [
      line("2026-10-12", "50.000", { department: "electronics" }),
      line("2026-10-12", "20.000", { department: "beauty" }),
      line("2026-10-12", "20.000", { department: "grocery" }),
      line("2026-10-12", "10.000", { department: null }),
      /* Outside the range. */
      line("2026-09-01", "999.000", { department: "style" }),
    ];
    const board = buildDashboard({ lines, now: NOW, range: 7, stock: STOCK, accountDays: null });
    expect(board.departments).toEqual([
      { slug: "electronics", sales: "50.000", percent: 50 },
      /* A tie goes to the departments' own order. */
      { slug: "beauty", sales: "20.000", percent: 20 },
      { slug: "grocery", sales: "20.000", percent: 20 },
      { slug: null, sales: "10.000", percent: 10 },
    ]);

    const many = ["electronics", "home-and-kitchen", "beauty", "style", "grocery", null, "x"].map((slug, index) =>
      line("2026-10-12", `${10 - index}.000`, { department: slug }));
    const folded = buildDashboard({ lines: many, now: NOW, range: 7, stock: STOCK, accountDays: null });
    expect(folded.departments).toHaveLength(6);
    expect(folded.departments.at(-1)).toMatchObject({ slug: null, other: true, sales: "9.000" });
    expect(folded.departments.reduce((sum, entry) => sum + entry.percent, 0)).toBe(100);
  });

  it("names what sold most over the range, by takings", () => {
    const lines = [
      line("2026-10-12", "30.000", { productId: 1, productTitle: "Lamp", quantity: 1 }),
      line("2026-10-11", "30.000", { productId: 2, productTitle: "Soap", quantity: 6 }),
      line("2026-10-11", "40.000", { productId: null, productTitle: "Gone", quantity: 1 }),
      line("2026-09-01", "500.000", { productId: 3, productTitle: "Old", quantity: 1 }),
    ];
    const board = buildDashboard({ lines, now: NOW, range: 7, stock: STOCK, accountDays: null });
    expect(board.top).toEqual([
      { productId: null, title: "Gone", units: 1, sales: "40.000", percent: 40 },
      /* A tie on takings goes to more units sold. */
      { productId: 2, title: "Soap", units: 6, sales: "30.000", percent: 30 },
      { productId: 1, title: "Lamp", units: 1, sales: "30.000", percent: 30 },
    ]);
  });

  it("counts new accounts per day for an administrator, and none for a store", () => {
    const board = buildDashboard({ lines: [], now: NOW, range: 7, stock: STOCK, accountDays: ["2026-10-12", "2026-10-12", "2026-10-11", "2026-09-01"] });
    expect(board.newAccounts?.at(-1)).toEqual({ day: "2026-10-12", count: 2 });
    expect(board.newAccounts?.reduce((sum, day) => sum + day.count, 0)).toBe(3);
    expect(buildDashboard({ lines: [], now: NOW, range: 7, stock: STOCK, accountDays: null }).newAccounts).toBeNull();
  });

  it("names a variant's shelf one way for the dashboard and the stock page", () => {
    expect(stockState({ stock: 0, lowStockAt: 5, preorderStock: 0 })).toBe("out");
    expect(stockState({ stock: -1, lowStockAt: null, preorderStock: 4 })).toBe("preorder");
    expect(stockState({ stock: 5, lowStockAt: 5, preorderStock: 0 })).toBe("low");
    expect(stockState({ stock: 6, lowStockAt: 5, preorderStock: 0 })).toBe("healthy");
    expect(stockState({ stock: 1, lowStockAt: null, preorderStock: 0 })).toBe("healthy");
  });

  it("says how long a shelf lasts at the last four weeks' pace", () => {
    expect(daysOfCover(10, 28)).toBe(10);
    expect(daysOfCover(3, 28)).toBe(3);
    expect(daysOfCover(10, 0)).toBeNull();
    expect(daysOfCover(0, 50)).toBeNull();
  });

  it("gives whole percentages that add up to a hundred", () => {
    expect(wholePercents([1n, 1n, 1n])).toEqual([34, 33, 33]);
    expect(wholePercents([0n, 0n])).toEqual([0, 0]);
    expect(wholePercents([2n, 1n]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
