import { describe, expect, it } from "vitest";
import { adviseForFit, chartProblem, cleanChart, fitTendency, recommendSize, sizeFromPurchases, sizeOnChart, type SizeChart } from "./sizeGuide.js";

const shirts: SizeChart = {
  axis: "Size",
  measures: ["chest", "waist"],
  rows: [
    { size: "S", ranges: { chest: [86, 91], waist: [71, 76] } },
    { size: "M", ranges: { chest: [92, 97], waist: [77, 82] } },
    { size: "L", ranges: { chest: [98, 103], waist: [83, 88] } },
    { size: "XL", ranges: { chest: [104, 109], waist: [89, 94] } },
  ],
};

describe("a chart", () => {
  it("is accepted when every size gives every declared range", () => {
    expect(chartProblem(shirts)).toBeNull();
  });

  it("is refused for what would make a recommendation wrong", () => {
    expect(chartProblem({ ...shirts, measures: [] })).toBe("sizeGuide.noMeasures");
    expect(chartProblem({ ...shirts, rows: [] })).toBe("sizeGuide.noRows");
    expect(chartProblem({ ...shirts, rows: [...shirts.rows, { size: "m", ranges: shirts.rows[1].ranges }] })).toBe("sizeGuide.duplicateSize");
    expect(chartProblem({ ...shirts, rows: [{ size: "S", ranges: { chest: [86, 91] } }] })).toBe("sizeGuide.missingRange");
    expect(chartProblem({ ...shirts, rows: [{ size: "S", ranges: { chest: [91, 86], waist: [71, 76] } }] })).toBe("sizeGuide.badRange");
    expect(chartProblem({ ...shirts, rows: [{ size: "S", ranges: { chest: [86, 900], waist: [71, 76] } }] })).toBe("sizeGuide.badRange");
    expect(chartProblem({ ...shirts, rows: [{ size: " ", ranges: shirts.rows[0].ranges }] })).toBe("sizeGuide.badSize");
    expect(chartProblem({ ...shirts, measures: ["chest", "shoulder" as never] })).toBe("sizeGuide.noMeasures");
  });

  it("drops a range for a measure it no longer declares, and trims", () => {
    const cleaned = cleanChart({ axis: " Size ", measures: ["chest"], rows: [{ size: " S ", ranges: { chest: [86.04, 91], waist: [71, 76] } }] });
    expect(cleaned).toEqual({ axis: "Size", measures: ["chest"], rows: [{ size: "S", ranges: { chest: [86, 91] } }] });
  });
});

describe("which size fits", () => {
  it("is the size that holds every measurement, with the comparison behind it", () => {
    const answer = recommendSize(shirts, { chest: 95, waist: 80 });
    expect(answer).toMatchObject({ kind: "fits", size: "M" });
    expect(answer.kind === "fits" && answer.comparisons.map(entry => entry.verdict)).toEqual(["within", "within"]);
  });

  it("works from one measurement when that is all the shopper has", () => {
    expect(recommendSize(shirts, { chest: 100 })).toMatchObject({ kind: "fits", size: "L" });
  });

  it("takes the size holding the most, larger on a tie, when the body is between sizes", () => {
    /* Chest says L, waist says M: one each, so the larger. */
    expect(recommendSize(shirts, { chest: 100, waist: 80 })).toMatchObject({ kind: "closest", size: "L" });
  });

  it("takes the nearest size when a measurement falls in a gap between two", () => {
    const gappy: SizeChart = { axis: "Size", measures: ["chest"], rows: [
      { size: "M", ranges: { chest: [92, 96] } }, { size: "L", ranges: { chest: [100, 104] } }, { size: "XL", ranges: { chest: [106, 110] } },
    ] };
    expect(recommendSize(gappy, { chest: 97 })).toMatchObject({ kind: "closest", size: "M" });
    expect(recommendSize(gappy, { chest: 99 })).toMatchObject({ kind: "closest", size: "L" });
  });

  it("says so rather than rounding when the body is off the chart", () => {
    expect(recommendSize(shirts, { chest: 70, waist: 60 })).toEqual({ kind: "belowChart" });
    expect(recommendSize(shirts, { chest: 130, waist: 120 })).toEqual({ kind: "aboveChart" });
  });

  it("has nothing to say without a measurement the chart uses", () => {
    expect(recommendSize(shirts, {})).toEqual({ kind: "nothingToCompare" });
    expect(recommendSize(shirts, { footLength: 27 })).toEqual({ kind: "nothingToCompare" });
    expect(recommendSize(shirts, { chest: Number.NaN })).toEqual({ kind: "nothingToCompare" });
  });
});

describe("learning from returns", () => {
  it("says nothing on too few returns, or on a split vote", () => {
    expect(fitTendency({ tooSmall: 2, tooLarge: 0 })).toBeNull();
    expect(fitTendency({ tooSmall: 3, tooLarge: 3 })).toBeNull();
    expect(fitTendency({ tooSmall: 4, tooLarge: 1 })).toBe("runsSmall");
    expect(fitTendency({ tooSmall: 0, tooLarge: 3 })).toBe("runsLarge");
  });

  it("moves a shopper near the top of their size up when it runs small, and leaves the middle alone", () => {
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 96 }), "runsSmall")).toBe("L");
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 93 }), "runsSmall")).toBeNull();
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 93 }), "runsLarge")).toBe("S");
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 100, waist: 80 }), "runsSmall")).toBe("XL");
  });

  it("has nowhere to move past either end of the chart", () => {
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 108 }), "runsSmall")).toBeNull();
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 87 }), "runsLarge")).toBeNull();
    expect(adviseForFit(shirts, recommendSize(shirts, { chest: 96 }), null)).toBeNull();
  });
});

describe("learning from the shopper's own purchases", () => {
  it("reads the size out of a variant's title, whole and without case", () => {
    expect(sizeOnChart(shirts, "M")).toBe("M");
    expect(sizeOnChart(shirts, "Navy / xl")).toBe("XL");
    expect(sizeOnChart(shirts, "Large")).toBeNull();
    expect(sizeOnChart(shirts, null)).toBeNull();
  });

  it("suggests the size they kept, with the counts behind it", () => {
    expect(sizeFromPurchases(shirts, [
      { variantTitle: "M", outcome: "kept", at: "2026-05-01" },
      { variantTitle: "White / M", outcome: "kept", at: "2026-07-01" },
      { variantTitle: "L", outcome: "kept", at: "2026-02-01" },
    ])).toEqual({ size: "M", kept: 2, tooSmall: 0, tooLarge: 0 });
  });

  it("moves up from one sent back too small, and down from one too large", () => {
    expect(sizeFromPurchases(shirts, [{ variantTitle: "S", outcome: "tooSmall", at: "2026-05-01" }]))
      .toEqual({ size: "M", kept: 0, tooSmall: 1, tooLarge: 0 });
    expect(sizeFromPurchases(shirts, [{ variantTitle: "XL", outcome: "tooLarge", at: "2026-05-01" }]))
      .toEqual({ size: "L", kept: 0, tooSmall: 0, tooLarge: 1 });
    /* Nothing above the largest: no vote, rather than a guess. */
    expect(sizeFromPurchases(shirts, [{ variantTitle: "XL", outcome: "tooSmall", at: "2026-05-01" }])).toBeNull();
  });

  it("breaks a tie with the most recent, and says nothing from sizes this chart lacks", () => {
    expect(sizeFromPurchases(shirts, [
      { variantTitle: "M", outcome: "kept", at: "2026-01-01" },
      { variantTitle: "L", outcome: "kept", at: "2026-09-01" },
    ])?.size).toBe("L");
    expect(sizeFromPurchases(shirts, [{ variantTitle: "42", outcome: "kept", at: "2026-01-01" }])).toBeNull();
    expect(sizeFromPurchases(shirts, [])).toBeNull();
  });
});
