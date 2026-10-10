import { describe, expect, it } from "vitest";
import { MAX_RECENT, withRecent } from "./recentSearches";

describe("recent searches", () => {
  it("puts the latest first, once, whatever its case or spacing", () => {
    expect(withRecent(["lamp", "kettle"], "  Kettle ")).toEqual(["Kettle", "lamp"]);
    expect(withRecent([], "brass   lamp")).toEqual(["brass lamp"]);
  });

  it("keeps only the last few", () => {
    const many = Array.from({ length: MAX_RECENT }, (_, i) => `term ${i}`);
    expect(withRecent(many, "new")).toHaveLength(MAX_RECENT);
    expect(withRecent(many, "new")[0]).toBe("new");
  });

  /* Nothing typed, or a pasted paragraph, is not a search to offer back. */
  it("ignores an empty term and an overlong one", () => {
    expect(withRecent(["lamp"], "   ")).toEqual(["lamp"]);
    expect(withRecent(["lamp"], "x".repeat(81))).toEqual(["lamp"]);
  });
});
