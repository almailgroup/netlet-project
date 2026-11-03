import { describe, expect, it } from "vitest";
import {
  frequentAddable,
  frequentKey,
  frequentQuantity,
  frequentState,
  suggestFrequent,
  type PastPurchase,
} from "./frequentItems.js";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const line = (productId: number, variantId: number, orderId: number, n: number, quantity = 1): PastPurchase => ({
  productId,
  variantId,
  orderId,
  placedAt: day(n),
  quantity,
});

describe("suggestFrequent", () => {
  it("counts orders, not lines or units, and puts the habit first", () => {
    const suggestions = suggestFrequent(
      [
        line(1, 10, 100, 1, 12), // twelve bottles once
        line(2, 20, 100, 1),
        line(2, 20, 101, 5),
        line(2, 20, 102, 9, 3),
        line(2, 20, 102, 9), // a second line of it in the same order
      ],
      new Set(),
    );
    expect(suggestions.map(s => [s.productId, s.timesBought])).toEqual([[2, 3], [1, 1]]);
    expect(suggestions[0].lastQuantity).toBe(3);
    expect(suggestions[0].lastBought).toEqual(day(9));
  });

  it("breaks a tie by the most recent, and leaves out what is already on the list", () => {
    const suggestions = suggestFrequent(
      [line(1, 10, 100, 1), line(2, 20, 101, 5), line(3, 30, 102, 9)],
      new Set([frequentKey(3, 30)]),
    );
    expect(suggestions.map(s => s.productId)).toEqual([2, 1]);
  });

  it("keeps each variant apart and stops at the limit", () => {
    const suggestions = suggestFrequent([line(1, 10, 100, 1), line(1, 11, 101, 2), line(2, 20, 102, 3)], new Set(), 2);
    expect(suggestions.map(s => frequentKey(s.productId, s.variantId))).toEqual(["2:20", "1:11"]);
  });
});

describe("the usual amount and what one press adds", () => {
  it("holds the usual amount to a whole number from one to the line ceiling", () => {
    expect(frequentQuantity(0)).toBe(1);
    expect(frequentQuantity(2.6)).toBe(3);
    expect(frequentQuantity(500)).toBe(99);
    expect(frequentQuantity(Number.NaN)).toBe(1);
  });

  it("adds the usual amount, less what is already in the bag, never past what there is", () => {
    expect(frequentAddable(3, 10, 0)).toBe(3);
    expect(frequentAddable(3, 10, 8)).toBe(2);
    expect(frequentAddable(3, 2, 0)).toBe(2);
    expect(frequentAddable(3, 4, 4)).toBe(0);
  });
});

describe("frequentState", () => {
  const product = {
    variants: [
      { id: "10", availableForSale: true },
      { id: "11", availableForSale: false },
    ],
  };
  it("says ready, sold out, or gone", () => {
    expect(frequentState(product, "10")).toBe("ready");
    expect(frequentState(product, "11")).toBe("soldOut");
    expect(frequentState(product, "12")).toBe("gone");
    expect(frequentState(null, "10")).toBe("gone");
  });
});
