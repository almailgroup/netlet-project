import { describe, expect, it } from "vitest";
import { chooseLines, chooseOnly, choiceOf, chosenLineIds, isChosen, pruneSkip, skippedLineIds, untickPlan } from "./cartChoice";

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

  /* Unticking moves to Saved for later, on the owner's word. The same bag,
     with products: line 2 carries an extra, 5 has no product said, and 6 and
     7 are a set (bundle 8) whose second line has none. */
  const shelf = [
    { lineId: "1", productId: "p1" },
    { lineId: "2", productId: "p2", addons: [{ id: "a" }] },
    { lineId: "3", productId: "p3", bundleId: "9", bundleName: "Desk set" },
    { lineId: "4", productId: "p4", bundleId: "9", bundleName: "Desk set" },
    { lineId: "5", productId: null },
    { lineId: "6", productId: "p6", bundleId: "8" },
    { lineId: "7", bundleId: "8" },
    { lineId: "8", productId: "p1" },
  ];

  it("moves an unticked plain line to Saved, with Undo", () => {
    expect(untickPlan(shelf, ["1"])).toEqual({ move: ["1"], productIds: ["p1"], leave: [], undoable: true });
  });

  it("moves a line with extras without Undo, and a set whole without Undo", () => {
    expect(untickPlan(shelf, ["2"])).toEqual({ move: ["2"], productIds: ["p2"], leave: [], undoable: false });
    expect(untickPlan(shelf, ["4"])).toEqual({ move: ["3", "4"], productIds: ["p3", "p4"], leave: [], undoable: false });
  });

  it("leaves out of checkout what cannot be saved, and keeps such a set together", () => {
    expect(untickPlan(shelf, ["5"])).toEqual({ move: [], productIds: [], leave: ["5"], undoable: false });
    expect(untickPlan(shelf, ["6"])).toEqual({ move: [], productIds: [], leave: ["6", "7"], undoable: false });
  });

  it("saves a product once when two of its lines move, and ignores ids the bag no longer has", () => {
    expect(untickPlan(shelf, ["1", "8", "77"])).toEqual({ move: ["1", "8"], productIds: ["p1"], leave: [], undoable: true });
    expect(untickPlan(shelf, [])).toEqual({ move: [], productIds: [], leave: [], undoable: false });
  });

  it("moves everything when All is unticked, leaving only what cannot be saved", () => {
    const all = untickPlan(shelf, shelf.map(line => line.lineId));
    expect(all.move).toEqual(["1", "2", "3", "4", "8"]);
    expect(all.productIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(all.leave).toEqual(["5", "6", "7"]);
    expect(all.undoable).toBe(false);
  });
});
