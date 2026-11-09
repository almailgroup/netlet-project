import { describe, expect, it } from "vitest";
import { freshViewed, MAX_VIEWED, VIEWED_DAYS, withoutViewed, withViewed, type Viewed } from "./recentlyViewed";

const DAY = 24 * 60 * 60 * 1000;

describe("previously viewed", () => {
  it("puts the latest first, once", () => {
    const list = withViewed([{ id: "1", at: 10 }, { id: "2", at: 5 }], "2", 20);
    expect(list.map(entry => entry.id)).toEqual(["2", "1"]);
    expect(list[0].at).toBe(20);
  });

  it("keeps only the last two dozen", () => {
    let list: Viewed[] = [];
    for (let index = 0; index < MAX_VIEWED + 5; index += 1) list = withViewed(list, String(index), index);
    expect(list).toHaveLength(MAX_VIEWED);
    expect(list[0].id).toBe(String(MAX_VIEWED + 4));
    expect(list.map(entry => entry.id)).not.toContain("0");
  });

  it("ignores an empty id and an overlong one", () => {
    const list: Viewed[] = [{ id: "1", at: 1 }];
    expect(withViewed(list, "", 2)).toEqual(list);
    expect(withViewed(list, "x".repeat(300), 2)).toEqual(list);
  });

  /* What is stored is the device's word: read it back as a list of ids and
     times, newest first, and nothing older than the window. */
  it("reads back only well-formed entries inside the window, newest first", () => {
    const now = 1_000 * DAY;
    const list = freshViewed([
      { id: "old", at: now - (VIEWED_DAYS + 1) * DAY },
      { id: "a", at: now - 2 * DAY },
      { id: "b", at: now - DAY },
      { id: "a", at: now - 3 * DAY },
      { id: 7, at: now },
      { at: now },
      "junk",
      null,
    ], now);
    expect(list.map(entry => entry.id)).toEqual(["b", "a"]);
  });

  /* One comes off with its own cross; several, or all, with Delete (n). */
  it("takes out one product, or every one chosen, and keeps the rest in order", () => {
    const list: Viewed[] = [{ id: "a", at: 3 }, { id: "b", at: 2 }, { id: "c", at: 1 }];
    expect(withoutViewed(list, "b").map(entry => entry.id)).toEqual(["a", "c"]);
    expect(withoutViewed(list, ["a", "c"]).map(entry => entry.id)).toEqual(["b"]);
    expect(withoutViewed(list, ["a", "b", "c"])).toEqual([]);
    expect(withoutViewed(list, ["gone"])).toEqual(list);
    expect(withoutViewed(list, [])).toEqual(list);
  });
});
