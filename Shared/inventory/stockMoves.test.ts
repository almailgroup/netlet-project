import { describe, expect, it } from "vitest";
import { stockMoveProblem } from "./stockMoves.js";

describe("which way a stock change may go", () => {
  it("adds for received and returned, and takes away for sold and damaged", () => {
    expect(stockMoveProblem(12, "received")).toBeNull();
    expect(stockMoveProblem(1, "returned")).toBeNull();
    expect(stockMoveProblem(-2, "sold")).toBeNull();
    expect(stockMoveProblem(-1, "damaged")).toBeNull();
  });

  it("refuses a reason pointing the other way, so the log cannot say what did not happen", () => {
    expect(stockMoveProblem(-1, "received")).toBe("stock.wrongDirection");
    expect(stockMoveProblem(5, "damaged")).toBe("stock.wrongDirection");
    expect(stockMoveProblem(3, "sold")).toBe("stock.wrongDirection");
  });

  it("lets a correction go either way, and refuses a change of nothing", () => {
    expect(stockMoveProblem(-4, "correction")).toBeNull();
    expect(stockMoveProblem(4, "correction")).toBeNull();
    expect(stockMoveProblem(0, "correction")).toBe("stock.zeroChange");
    expect(stockMoveProblem(1.5, "received")).toBe("stock.zeroChange");
  });
});
