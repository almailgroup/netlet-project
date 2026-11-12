import { describe, expect, it } from "vitest";
import { rankStores, STORES_SELLING_LIMIT } from "./storesSelling";

describe("rankStores", () => {
  it("names a store once, the one selling the most first", () => {
    const rows = [{ vendorId: 1 }, { vendorId: 2 }, { vendorId: 2 }, { vendorId: 3 }, { vendorId: 2 }, { vendorId: 1 }];
    expect(rankStores(rows)).toEqual([
      { vendorId: 2, matching: 3 },
      { vendorId: 1, matching: 2 },
      { vendorId: 3, matching: 1 },
    ]);
  });

  it("breaks a tie by whose match came first", () => {
    /* For a search the rows are in the ranking's order: the best match wins. */
    expect(rankStores([{ vendorId: 7 }, { vendorId: 4 }, { vendorId: 4 }, { vendorId: 7 }]).map(store => store.vendorId)).toEqual([7, 4]);
  });

  it("keeps at most the limit, and skips a row with no store", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ vendorId: index }));
    expect(rankStores(rows)).toHaveLength(STORES_SELLING_LIMIT);
    expect(rankStores(rows, 3).map(store => store.vendorId)).toEqual([0, 1, 2]);
    expect(rankStores([{ vendorId: null }, { vendorId: 5 }])).toEqual([{ vendorId: 5, matching: 1 }]);
    expect(rankStores([], 4)).toEqual([]);
  });
});
