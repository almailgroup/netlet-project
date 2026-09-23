import { describe, expect, it } from "vitest";
import { addonsTotal, isSellableAddon, resolveAddons, type Addon } from "./addons.js";

const offered: Addon[] = [
  { id: 1, kind: "installation", label: "Fitting at your address", labelAr: null, price: "5.000", position: 0 },
  { id: 2, kind: "warranty", label: "Two extra years", labelAr: null, price: "12.500", position: 1 },
];

describe("what the extras cost", () => {
  /* Two fridges need two fittings; charging per line makes a shopper buying
     three pay for one and argue about it on the doorstep. */
  it("charges per unit, not per line", () => {
    const chosen = resolveAddons(offered, [1]);
    expect(addonsTotal(chosen, 1)).toBe("5.000");
    expect(addonsTotal(chosen, 3)).toBe("15.000");
  });

  it("adds several extras together before multiplying", () => {
    expect(addonsTotal(resolveAddons(offered, [1, 2]), 2)).toBe("35.000");
  });

  it("is nothing when nothing was chosen", () => {
    expect(addonsTotal([], 4)).toBe("0.000");
  });

  /* The dinar has three decimal places, and a shop that rounds a fitting fee
     is a shop that argues about 5 fils. */
  it("keeps the third decimal place exactly", () => {
    const odd: Addon[] = [{ ...offered[0], price: "0.375" }];
    expect(addonsTotal(resolveAddons(odd, [1]), 8)).toBe("3.000");
  });
});

describe("resolving what the shopper sent", () => {
  /* An id is all the client may send: anything it says about money is thrown
     away, which is the whole reason this resolves rather than trusts. */
  it("takes the price from the catalog", () => {
    expect(resolveAddons(offered, [2])).toEqual([
      { id: 2, kind: "warranty", label: "Two extra years", price: "12.500" },
    ]);
  });

  /* A seller may withdraw an extra between the page rendering and the button,
     and losing the sale over it fixes nothing the shopper did. */
  it("drops an id the seller does not offer rather than refusing", () => {
    expect(resolveAddons(offered, [1, 99])).toHaveLength(1);
  });

  it("chooses nothing by default", () => {
    expect(resolveAddons(offered, [])).toEqual([]);
  });
});

describe("what a seller may offer", () => {
  it("refuses a free extra, which is a feature rather than an add-on", () => {
    expect(isSellableAddon({ label: "Gift wrap", price: "0.000" })).toBe(false);
  });

  it("refuses one with no name", () => {
    expect(isSellableAddon({ label: "  ", price: "5.000" })).toBe(false);
  });

  it("takes a real one", () => {
    expect(isSellableAddon({ label: "Fitting", price: "5.000" })).toBe(true);
  });
});
