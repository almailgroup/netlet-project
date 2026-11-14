import { describe, expect, it } from "vitest";
import { dayAfter, dayBefore, dayOf, formatDate, formatMoney, formatTime } from "./format.js";
import { fromKuwaitClock, isDay, kuwaitDay, toKuwaitClock } from "./kuwait.js";

describe("Kuwait's clock", () => {
  it("is UTC+3, so a late evening in Kuwait is the next day's early hours nowhere", () => {
    expect(kuwaitDay(new Date("2026-11-14T21:30:00Z"))).toBe("2026-11-15");
    expect(dayOf("2026-11-14T20:59:00Z")).toBe("2026-11-14");
    expect(formatTime("2026-11-14T12:20:00Z", "en")).toBe("15:20");
    expect(formatDate("2026-11-14T22:00:00Z", "en")).toBe("15 November 2026");
  });

  it("turns a typed Kuwaiti time into the instant it names, and back", () => {
    expect(fromKuwaitClock("2026-11-14T15:20")?.toISOString()).toBe("2026-11-14T12:20:00.000Z");
    expect(fromKuwaitClock("2026-02-30T10:00")).toBeNull();
    expect(toKuwaitClock(new Date("2026-11-14T12:20:00Z"))).toBe("2026-11-14T15:20");
  });

  it("knows a real day and its neighbours", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
});

describe("money", () => {
  it("is the dinar to three places, in Latin digits on both pages", () => {
    expect(formatMoney(12_500, "en")).toMatch(/KWD\s?12\.500/);
    const ar = formatMoney(12_500, "ar");
    expect(ar).toContain("12.500");
    expect(ar).toContain("د.ك.");
  });
});
