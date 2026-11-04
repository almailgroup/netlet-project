import { describe, expect, it } from "vitest";
import { brandProblem, percentProblem, restockProblem, scalePrice, withBrand } from "./productBulk";

describe("bulk price changes", () => {
  it("move a price by a percentage to the fil, half up", () => {
    expect(scalePrice("10.000", 10)).toBe("11.000");
    expect(scalePrice("24.375", -20)).toBe("19.500");
    /* 1.005 × 1.5 = 1.5075, half up to 1.508. */
    expect(scalePrice("1.005", 50)).toBe("1.508");
    expect(scalePrice("9.999", 12.5)).toBe("11.249");
  });

  it("refuse no change, a cut to nothing and anything that is not a number", () => {
    expect(percentProblem(0)).toBe("admin.bulkPercentInvalid");
    expect(percentProblem(-95)).toBe("admin.bulkPercentInvalid");
    expect(percentProblem(Number.NaN)).toBe("admin.bulkPercentInvalid");
    expect(percentProblem(-90)).toBeNull();
    expect(percentProblem(15)).toBeNull();
  });

  it("add stock in whole units only", () => {
    expect(restockProblem(0)).toBe("admin.bulkRestockInvalid");
    expect(restockProblem(2.5)).toBe("admin.bulkRestockInvalid");
    expect(restockProblem(12)).toBeNull();
  });
});

describe("setting a brand on many products", () => {
  it("adds the Brand row the filter reads, and replaces an earlier one wherever it sat", () => {
    const rows = [
      { namespace: "reviews", key: "brand", label: "Brand", value: "kept: a review's own" },
      { namespace: "spec", key: "material", label: "Material", value: "Gold" },
    ];
    expect(withBrand(rows, "  Gemellry ")).toEqual([...rows, { namespace: "spec", key: "brand", label: "Brand", value: "Gemellry" }]);

    const twice = [
      { namespace: "spec", key: "brand", label: "Brand", value: "Old" },
      { namespace: "spec", key: "material", label: "Material", value: "Gold" },
      { namespace: "custom", key: "brand", label: "Brand", value: "Older" },
    ];
    expect(withBrand(twice, "Gemellry")).toEqual([
      { namespace: "spec", key: "brand", label: "Brand", value: "Gemellry" },
      { namespace: "spec", key: "material", label: "Material", value: "Gold" },
    ]);
  });

  it("refuses nothing, too long, and a brand that is really a phone number or a link", () => {
    expect(brandProblem("Gemellry")).toBeNull();
    expect(brandProblem("جيميلري")).toBeNull();
    expect(brandProblem("   ")).toBe("admin.bulkBrandInvalid");
    expect(brandProblem("x".repeat(61))).toBe("admin.bulkBrandInvalid");
    expect(brandProblem("Call 99887766")).toBe("admin.bulkBrandInvalid");
    expect(brandProblem("shop.example.com")).toBe("admin.bulkBrandInvalid");
  });
});
