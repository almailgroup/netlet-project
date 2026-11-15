import { describe, expect, it } from "vitest";
import { countToday, noteViewSource, viewSource } from "./productViews";

describe("the day's list of products counted on this device", () => {
  it("counts a product once a day, a second look not being a visitor", () => {
    const first = countToday(null, "12", "2026-11-15");
    expect(first.first).toBe(true);
    const again = countToday(first.next, "12", "2026-11-15");
    expect(again.first).toBe(false);
    expect(countToday(again.next, "13", "2026-11-15")).toMatchObject({ first: true, next: { ids: ["12", "13"] } });
  });

  it("starts afresh when the Kuwaiti day turns", () => {
    const yesterday = { day: "2026-11-14", ids: ["12"] };
    expect(countToday(yesterday, "12", "2026-11-15")).toEqual({ first: true, next: { day: "2026-11-15", ids: ["12"] } });
  });

  it("reads anything else stored there as nothing", () => {
    expect(countToday("rubbish", "12", "2026-11-15").first).toBe(true);
    expect(countToday({ day: "2026-11-15", ids: [7, "12"] }, "12", "2026-11-15").first).toBe(false);
  });
});

describe("where the product page came from", () => {
  it("takes a fresh hint once, and only once", () => {
    noteViewSource("search");
    expect(viewSource()).toBe("search");
    /* No address behind it in a test is a page opened from outside. */
    expect(viewSource()).toBe("outside");
  });

  it("lets a stale hint go", () => {
    noteViewSource("other");
    expect(viewSource(Date.now() + 60_000)).toBe("outside");
  });
});
