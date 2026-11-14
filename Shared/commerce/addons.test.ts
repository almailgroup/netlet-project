import { describe, expect, it } from "vitest";
import {
  addonProblems,
  addonsTotal,
  addonTitle,
  draftOf,
  resolveAddons,
  storedAddon,
  withOneWarranty,
  type Addon,
  type AddonDraft,
} from "./addons.js";

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

const draft = (over: Partial<AddonDraft>): AddonDraft => ({ kind: "installation", label: "", labelAr: "", price: "5.000", warrantyMonths: null, ...over });

describe("what a seller may offer", () => {
  /* A free extra is a feature of the product, and a check box that changes
     no figure is the dead-control rule. */
  it("refuses a free extra and a price that is not one", () => {
    expect(addonProblems([draft({ price: "0.000" })])).toEqual([["price"]]);
    expect(addonProblems([draft({ price: "abc" })])).toEqual([["price"]]);
    expect(addonProblems([draft({ price: "1.2345" })])).toEqual([["price"]]);
  });

  it("names installation and a plan with a length for the seller, and nothing else", () => {
    expect(addonProblems([draft({})])).toEqual([[]]);
    expect(addonProblems([draft({ kind: "warranty", warrantyMonths: 24 })])).toEqual([[]]);
    expect(addonProblems([draft({ kind: "other" })])).toEqual([["name"]]);
    expect(addonProblems([draft({ kind: "other", labelAr: "تغليف هدية" })])).toEqual([[]]);
  });

  /* A plan with no length and no name says nothing a shopper can compare;
     one named before plans had lengths still reads as its name says. */
  it("asks a warranty plan for its length unless it has a name of its own", () => {
    expect(addonProblems([draft({ kind: "warranty" })])).toEqual([["warrantyLength"]]);
    expect(addonProblems([draft({ kind: "warranty", label: "Two extra years" })])).toEqual([[]]);
  });

  it("refuses two plans of one length, on the second", () => {
    expect(addonProblems([
      draft({ kind: "warranty", warrantyMonths: 12 }),
      draft({ kind: "warranty", warrantyMonths: 24 }),
      draft({ kind: "warranty", warrantyMonths: 12, price: "9.000" }),
    ])).toEqual([[], [], ["warrantyTwice"]]);
  });

  it("refuses a length that is not offered and a name past the column", () => {
    expect(addonProblems([draft({ kind: "warranty", warrantyMonths: 7 })])).toEqual([["warrantyLength"]]);
    expect(addonProblems([draft({ kind: "other", label: "x".repeat(161) })])).toEqual([["nameLong"]]);
  });
});

describe("what an extra is called", () => {
  it("stores a blank name as the default in both languages", () => {
    expect(storedAddon(draft({}))).toEqual({ kind: "installation", label: "Installation", labelAr: "التركيب", price: "5.000", warrantyMonths: null });
    expect(storedAddon(draft({ kind: "warranty", warrantyMonths: 24, price: "12.500" }))).toEqual({
      kind: "warranty", label: "2-year extended warranty", labelAr: "ضمان ممتد لمدة سنتين", price: "12.500", warrantyMonths: 24,
    });
  });

  it("keeps a length on a warranty alone, and a name typed in one language for both", () => {
    expect(storedAddon(draft({ kind: "installation", warrantyMonths: 24, label: "Wall mounting" }))).toEqual({
      kind: "installation", label: "Wall mounting", labelAr: null, price: "5.000", warrantyMonths: null,
    });
    expect(storedAddon(draft({ kind: "other", labelAr: "تغليف هدية" })).label).toBe("تغليف هدية");
  });

  /* The editor shows a default name blank again, so a new length renames the plan. */
  it("shows a default name as blank in the editor, and a seller's own as typed", () => {
    expect(draftOf(storedAddon(draft({ kind: "warranty", warrantyMonths: 24 })))).toEqual(draft({ kind: "warranty", warrantyMonths: 24 }));
    expect(draftOf({ kind: "warranty", label: "Gold care", labelAr: null, price: "9.000", warrantyMonths: 36 }))
      .toEqual(draft({ kind: "warranty", label: "Gold care", price: "9.000", warrantyMonths: 36 }));
  });

  it("counts a plan's length in the page's language", () => {
    const plan = (months: number) => storedAddon(draft({ kind: "warranty", warrantyMonths: months }));
    expect(addonTitle(plan(12), "en")).toBe("1-year extended warranty");
    expect(addonTitle(plan(12), "ar")).toBe("ضمان ممتد لمدة سنة");
    expect(addonTitle(plan(36), "ar")).toBe("ضمان ممتد لمدة 3 سنوات");
    expect(addonTitle(plan(6), "en")).toBe("6-month extended warranty");
    expect(addonTitle(plan(6), "ar")).toBe("ضمان ممتد لمدة 6 أشهر");
  });

  /* A price with no length is not a plan anybody can compare. */
  it("says how long a plan with its own name runs", () => {
    const gold = { kind: "warranty", label: "Gold care", labelAr: "العناية الذهبية", warrantyMonths: 24 };
    expect(addonTitle(gold, "en")).toBe("Gold care, 2 years");
    expect(addonTitle(gold, "ar")).toBe("العناية الذهبية، سنتان");
    expect(addonTitle({ ...gold, labelAr: null }, "ar")).toBe("Gold care، سنتان");
  });

  it("reads an extra from before plans had lengths as its name", () => {
    expect(addonTitle({ kind: "warranty", label: "Two extra years", labelAr: null, warrantyMonths: null }, "en")).toBe("Two extra years");
  });
});

describe("one warranty plan on a line", () => {
  const offeredPlans = [
    { id: 1, kind: "installation" },
    { id: 2, kind: "warranty" },
    { id: 3, kind: "warranty" },
  ];

  it("keeps the first plan the shopper sent", () => {
    expect(withOneWarranty(offeredPlans, [3, 1, 2]).map(addon => addon.id)).toEqual([1, 3]);
    expect(withOneWarranty(offeredPlans, [2, 3]).map(addon => addon.id)).toEqual([1, 2]);
  });

  it("leaves a line with one plan or none alone", () => {
    expect(withOneWarranty(offeredPlans.slice(0, 2), [1, 2])).toHaveLength(2);
  });
});
