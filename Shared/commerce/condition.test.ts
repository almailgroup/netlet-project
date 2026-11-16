import { describe, expect, it } from "vitest";
import { freeFormRows, mergeAttributes } from "./attributeSchema.js";
import { REFURBISHED_JSON, belongsTo, conditionOf, isConditionRow, isRefurbished, withCondition } from "./condition.js";
import { specifications } from "./productDetail.js";

const brand = { namespace: "spec", key: "brand", label: "Brand", value: "Apple" };
const score = { namespace: "reviews", key: "rating", label: "Rating", value: "4.5" };

describe("a product's condition", () => {
  it("is new without the row and refurbished with it", () => {
    expect(conditionOf([])).toBe("new");
    expect(conditionOf(null)).toBe("new");
    const used = withCondition([brand], "refurbished");
    expect(conditionOf(used)).toBe("refurbished");
    expect(isRefurbished({ attributes: used })).toBe(true);
    /* Exactly the row the server's containment reads, and nothing looser. */
    expect(conditionOf([{ namespace: "spec", key: "condition", value: "Refurbished" }])).toBe("new");
    expect(JSON.parse(REFURBISHED_JSON)).toEqual([{ namespace: "spec", key: "condition", value: "refurbished" }]);
  });

  it("is one row, replaced wherever it sat, with every other row kept", () => {
    const twice = withCondition(withCondition([brand, score], "refurbished"), "refurbished");
    expect(twice.filter(isConditionRow)).toHaveLength(1);
    expect(withCondition(twice, "new")).toEqual([brand, score]);
  });

  it("is never a row the specification form draws, and survives its save", () => {
    const used = withCondition([score, brand], "refurbished");
    expect(freeFormRows(used, "electronics").some(isConditionRow)).toBe(false);
    const saved = mergeAttributes(used, "electronics", { brand: "Samsung" });
    expect(conditionOf(saved)).toBe("refurbished");
    expect(saved.find(row => row.key === "brand")?.value).toBe("Samsung");
  });

  it("is said by its own badge on the product page, never as a specification", () => {
    const rows = specifications({ attributes: withCondition([brand], "refurbished"), description: "" }).rows;
    expect(rows.map(row => row.label)).toEqual(["Brand"]);
  });

  it("puts a product on the shop it belongs to", () => {
    expect(belongsTo("new", "new")).toBe(true);
    expect(belongsTo("refurbished", "new")).toBe(false);
    expect(belongsTo("refurbished", "any")).toBe(true);
  });
});
