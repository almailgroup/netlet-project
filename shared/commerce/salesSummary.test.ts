import { describe, expect, it } from "vitest";
import { lastDays, summarise, summaryStart, type SoldLine } from "./salesSummary";

/* 12 October 2026, 10:00 in Kuwait. */
const NOW = new Date("2026-10-12T07:00:00Z");

const line = (orderId: number, at: string, total: string, quantity = 1, productId: number | null = 1, title = "Lamp"): SoldLine =>
  ({ orderId, placedAt: new Date(at), lineTotal: total, quantity, productId, productTitle: title });

describe("the overview's sales figures", () => {
  it("counts Kuwaiti days, so 1am in Kuwait is that day and not the one before", () => {
    /* 22:30 UTC on the 11th is 01:30 on the 12th in Kuwait. */
    const summary = summarise([line(1, "2026-10-11T22:30:00Z", "10.000"), line(2, "2026-10-11T20:30:00Z", "5.000")], [], NOW);
    expect(summary.periods.today).toEqual({ sales: "10.000", orders: 1, averageOrder: "10.000", returns: 0 });
    expect(summary.periods.week.sales).toBe("15.000");
  });

  it("counts an order once however many lines it has, and rounds the average to the fil", () => {
    const summary = summarise([
      line(1, "2026-10-12T06:00:00Z", "10.000"),
      line(1, "2026-10-12T06:00:00Z", "0.001", 1, 2, "Clip"),
      line(2, "2026-10-12T06:00:00Z", "10.000"),
    ], [], NOW);
    expect(summary.periods.today.orders).toBe(2);
    /* 20.001 over two orders is 10.0005, rounded half up. */
    expect(summary.periods.today.averageOrder).toBe("10.001");
  });

  it("keeps a sale older than a week out of the week and in the month", () => {
    const summary = summarise([line(1, "2026-09-30T09:00:00Z", "8.000")], ["2026-09-30", "2026-10-12"], NOW);
    expect(summary.periods.week.sales).toBe("0.000");
    expect(summary.periods.month.sales).toBe("8.000");
    expect(summary.periods.week.returns).toBe(1);
    expect(summary.periods.month.returns).toBe(2);
  });

  it("draws thirty days ending today, oldest first, with empty days at zero", () => {
    const summary = summarise([line(1, "2026-10-12T06:00:00Z", "3.500")], [], NOW);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily[0].day).toBe("2026-09-13");
    expect(summary.daily[29]).toEqual({ day: "2026-10-12", sales: "3.500", orders: 1 });
    expect(summary.daily[28]).toEqual({ day: "2026-10-11", sales: "0.000", orders: 0 });
    expect(lastDays(NOW, 2)).toEqual(["2026-10-11", "2026-10-12"]);
    /* Midnight in Kuwait on the first of those days. */
    expect(summaryStart(NOW).toISOString()).toBe("2026-09-12T21:00:00.000Z");
  });

  it("ranks what sold most by units, and keeps a deleted product by its frozen title", () => {
    const summary = summarise([
      line(1, "2026-10-10T06:00:00Z", "4.000", 2, 1, "Lamp"),
      line(2, "2026-10-10T06:00:00Z", "6.000", 3, null, "Old kettle"),
      line(3, "2026-10-11T06:00:00Z", "2.000", 1, 1, "Lamp"),
    ], [], NOW);
    expect(summary.top).toEqual([
      { productId: 1, title: "Lamp", units: 3, sales: "6.000" },
      { productId: null, title: "Old kettle", units: 3, sales: "6.000" },
    ]);
  });
});
