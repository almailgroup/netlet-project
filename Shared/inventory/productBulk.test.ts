import { describe, expect, it } from "vitest";
import { percentProblem, restockProblem, scalePrice } from "./productBulk";

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
