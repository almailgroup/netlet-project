import { describe, expect, it } from "vitest";
import { chooseLines, chooseOnly, choiceOf, chosenLineIds, isChosen, pruneSkip, skippedLineIds } from "./cartChoice";

/* A bag of four: two plain lines, and a set of two (bundle 9). The Swift app's
   `CartChoiceTests` runs these same cases. */
const bag = [
  { lineId: "1" },
  { lineId: "2", bundleId: null },
  { lineId: "3", bundleId: "9" },
  { lineId: "4", bundleId: "9" },
];

describe("cart choice", () => {
  it("chooses everything until something is left out", () => {
    expect(chosenLineIds(bag, [])).toEqual(["1", "2", "3", "4"]);
    expect(choiceOf(bag, [])).toBe("all");
  });

  it("leaves a line out, and a set whole", () => {
    expect(chosenLineIds(bag, ["2"])).toEqual(["1", "3", "4"]);
    expect([...skippedLineIds(bag, ["3"])].sort()).toEqual(["3", "4"]);
    expect(isChosen(bag, ["3"], "4")).toBe(false);
  });

  it("toggles a line, a set by either member, and puts them back", () => {
    const off = chooseLines(bag, [], ["1"], false);
    expect(off).toEqual(["1"]);
    const setOff = chooseLines(bag, off, ["4"], false);
    expect(setOff).toEqual(["1", "3", "4"]);
    expect(chooseLines(bag, setOff, ["3"], true)).toEqual(["1"]);
    expect(chooseLines(bag, setOff, ["1", "2", "3", "4"], true)).toEqual([]);
  });

  it("says all, none or some for a group and for the bag", () => {
    expect(choiceOf(bag, ["1"], ["1", "2"])).toBe("some");
    expect(choiceOf(bag, ["1", "2"], ["1", "2"])).toBe("none");
    expect(choiceOf(bag, ["1"])).toBe("some");
    expect(choiceOf(bag, ["1", "2", "3"])).toBe("none");
    expect(choiceOf([], [])).toBe("none");
  });

  it("chooses one line alone for Buy now, and a line not yet in the bag by leaving everything out", () => {
    expect(chooseOnly(bag, ["2"])).toEqual(["1", "3", "4"]);
    expect(chooseOnly(bag, [])).toEqual(["1", "2", "3", "4"]);
    // A set member asked for alone brings its set with it.
    expect(chooseOnly(bag, ["3"])).toEqual(["1", "2"]);
  });

  it("forgets ids the bag no longer has, and keeps a set whole", () => {
    expect(pruneSkip(bag, ["1", "77"])).toEqual(["1"]);
    expect(pruneSkip(bag, ["4"])).toEqual(["3", "4"]);
    expect(pruneSkip([], ["1"])).toEqual([]);
  });
});
