import { describe, expect, it } from "vitest";
import { normaliseFigure, proposalFigureProblem, storeRateFor } from "./commissionProposals.js";

describe("a proposed commission (3.3.2)", () => {
  it("is one figure, a percentage up to 100 or an amount in dinars", () => {
    expect(proposalFigureProblem({ percent: "8", fixed: null })).toBeNull();
    expect(proposalFigureProblem({ percent: null, fixed: "0.500" })).toBeNull();
    expect(proposalFigureProblem({ percent: "8", fixed: "1" })).toBe("commission.oneFigure");
    expect(proposalFigureProblem({ percent: " ", fixed: null })).toBe("commission.oneFigure");
    expect(proposalFigureProblem({ percent: "101", fixed: null })).toBe("commission.badPercent");
    expect(proposalFigureProblem({ percent: "8.123", fixed: null })).toBe("commission.badPercent");
    expect(proposalFigureProblem({ percent: null, fixed: "1.2345" })).toBe("commission.badFixed");
  });

  it("is stored at its own precision, and a store-wide amount stands alone", () => {
    expect(normaliseFigure({ percent: "8", fixed: null })).toEqual({ percent: "8.00", fixed: null });
    expect(normaliseFigure({ percent: null, fixed: ".5" })).toEqual({ percent: null, fixed: "0.500" });
    expect(storeRateFor({ percent: null, fixed: "0.500" })).toEqual({ percent: "0.00", fixed: "0.500" });
    expect(storeRateFor({ percent: "9.50", fixed: null })).toEqual({ percent: "9.50", fixed: null });
  });
});
