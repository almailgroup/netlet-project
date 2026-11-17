import { describe, expect, it } from "vitest";
import { DELIVERY_WINDOWS, SLOT_DAYS, slotDays, slotState, storeSlotSpeed } from "./deliverySlots.js";

/* 2026-09-23 is a Wednesday; 25th Friday, 26th Saturday, 27th Sunday. Kuwait is UTC+3. */
const at = (iso: string) => new Date(iso);
const dates = (days: { date: string }[]) => days.map(day => day.date);

describe("the days offered", () => {
  it("start at the band's first day and run for seven working days", () => {
    /* 1pm Wednesday in Kuwait, a band of 2 to 4 days: Sunday is the second working day. */
    const days = slotDays("two_to_four", at("2026-09-23T10:00:00Z"));
    expect(days).toHaveLength(SLOT_DAYS);
    expect(dates(days)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-04", "2026-10-05"]);
    expect(days.every(day => day.windows.length === DELIVERY_WINDOWS.length)).toBe(true);
  });

  it("never offer a Friday or a Saturday", () => {
    const days = slotDays("next_day", at("2026-09-23T10:00:00Z"));
    for (const day of days) {
      const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
      expect([5, 6]).not.toContain(weekday);
    }
  });

  /* A window today is offered only while its start is still ahead. */
  it("offer today only the windows that have not started", () => {
    /* 10:30 in Kuwait: the morning has begun, the afternoon and evening have not. */
    const days = slotDays("same_day", at("2026-09-23T07:30:00Z"));
    expect(days[0]).toEqual({ date: "2026-09-23", windows: ["afternoon", "evening"] });
    /* 17:00: only tomorrow onwards, and still seven days. */
    const late = slotDays("same_day", at("2026-09-23T14:00:00Z"));
    expect(late[0].date).toBe("2026-09-24");
    expect(late).toHaveLength(SLOT_DAYS);
  });

  /* 1am Friday in Kuwait is still Thursday in UTC: the weekend is Kuwait's. */
  it("count from Kuwait's day, not UTC's", () => {
    const days = slotDays("same_day", at("2026-09-24T22:00:00Z"));
    expect(days[0].date).toBe("2026-09-27");
  });

  it("are none for a store that has said nothing or makes to order", () => {
    expect(slotDays(null)).toEqual([]);
    expect(slotDays("made_to_order")).toEqual([]);
  });
});

describe("the band a store's day is counted from", () => {
  it("is the slowest line's", () => {
    expect(storeSlotSpeed([
      { choice: "regular", speed: "next_day", fastSpeed: null },
      { choice: "regular", speed: "two_to_four", fastSpeed: null },
    ])).toBe("two_to_four");
  });

  it("is the fast band for an Express line", () => {
    expect(storeSlotSpeed([{ choice: "fast", speed: "up_to_week", fastSpeed: "same_day" }])).toBe("same_day");
  });

  /* Any day offered would be NetLet promising for the store. */
  it("is nothing when any line has no band, makes to order or rides an Express the store has no band for", () => {
    expect(storeSlotSpeed([{ choice: "regular", speed: "next_day", fastSpeed: null }, { choice: "regular", speed: null, fastSpeed: null }])).toBeNull();
    expect(storeSlotSpeed([{ choice: "regular", speed: "made_to_order", fastSpeed: null }])).toBeNull();
    expect(storeSlotSpeed([{ choice: "fast", speed: "next_day", fastSpeed: null }])).toBeNull();
    expect(storeSlotSpeed([])).toBeNull();
  });
});

describe("a chosen day", () => {
  const days = slotDays("next_day", at("2026-09-23T10:00:00Z"));

  it("is kept while it is offered", () => {
    expect(slotState({ date: days[0].date, window: "evening" }, days)).toBe("kept");
    expect(slotState(null, days)).toBe("unset");
  });

  /* Said, never moved to a day the shopper did not choose. */
  it("is gone once its day passes or the store offers no day", () => {
    expect(slotState({ date: "2026-09-22", window: "morning" }, days)).toBe("gone");
    expect(slotState({ date: days[0].date, window: "morning" }, [])).toBe("gone");
  });
});
