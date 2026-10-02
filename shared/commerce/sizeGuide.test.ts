import { describe, expect, it } from "vitest";
import { chartProblem, cleanChart, recommendSize, type SizeChart } from "./sizeGuide.js";

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
