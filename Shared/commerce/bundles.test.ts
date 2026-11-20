import { describe, expect, it } from "vitest";
import {
  BUNDLE_NOTE_MAX, bundleAgreement, bundleAnswerProblem, bundleChangeNeedsAsking,
  bundleComplete, chargedTotal, isCrossVendor, isSellableBundle, savingOf, separatelyTotal,
  splitBundlePrice, type Bundle, type BundleMember,
} from "./bundles.js";
import { compareMoney } from "../money.js";

const member = (over: Partial<BundleMember> & { unitPrice: string }): BundleMember => ({
  variantId: 1, vendorId: 1, quantity: 1, ...over,
});

const bundle = (over: Partial<Bundle> = {}): Bundle => ({
  id: 1,
  name: "Sofa and lamp",
  nameAr: null,
  vendorId: null,
  bundlePrice: "216.000",
  members: [
    member({ variantId: 1, vendorId: 1, unitPrice: "200.000" }),
    member({ variantId: 2, vendorId: 2, unitPrice: "40.000" }),
  ],
  ...over,
});

describe("what it is worth", () => {
  it("adds the members up at their own prices", () => {
    expect(separatelyTotal(bundle().members)).toBe("240.000");
    expect(savingOf(bundle())).toBe("24.000");
  });

  it("counts quantity", () => {
    const pair = bundle({ members: [member({ unitPrice: "10.000", quantity: 3 })], bundlePrice: "25.000" });
    expect(separatelyTotal(pair.members)).toBe("30.000");
    expect(savingOf(pair)).toBe("5.000");
  });

  /* A bundle that saves nothing is a set of products with a heading, and a
     badge on it would claim a saving that is not there. */
  it("is not a bundle when it saves nothing, or holds one thing", () => {
    expect(isSellableBundle(bundle({ bundlePrice: "240.000" }))).toBe(false);
    expect(isSellableBundle(bundle({ bundlePrice: "300.000" }))).toBe(false);
    expect(isSellableBundle(bundle({ members: [member({ unitPrice: "10.000" })], bundlePrice: "5.000" }))).toBe(false);
    expect(isSellableBundle(bundle())).toBe(true);
  });

  it("knows when it spans two shops", () => {
    expect(isCrossVendor(bundle().members)).toBe(true);
    expect(isCrossVendor([member({ vendorId: 1, unitPrice: "1.000" }), member({ vendorId: 1, unitPrice: "2.000" })])).toBe(false);
  });
});

describe("splitting the price across the shops", () => {
  /*
   * The rule the cross-vendor case turns on: taking the whole saving off the
   * lamp would have the lamp's seller paying for the sofa seller's promotion.
   */
  it("takes the same share from each seller, not the whole saving from one", () => {
    const split = splitBundlePrice(bundle());
    expect(split.map(line => line.lineTotal)).toEqual(["180.000", "36.000"]);
    /* Ten percent off each, which is ten percent off the bundle. */
    expect(split.every(line => Number(line.lineTotal) / Number(line.separately) === 0.9)).toBe(true);
  });

  /*
   * The whole reason the split is per unit: everything downstream is
   * `unitPrice × quantity`, so a share that does not divide by the quantity is
   * a line total nothing can reproduce.
   */
  it("prices each unit, so the line total is the unit times the quantity", () => {
    const set = bundle({
      bundlePrice: "27.000",
      members: [member({ variantId: 1, unitPrice: "10.000", quantity: 3 })],
    });
    const [line] = splitBundlePrice(set);
    expect(line.bundleUnitPrice).toBe("9.000");
    expect(line.lineTotal).toBe("27.000");
  });

  /*
   * No exact allocation exists in general — with two members of quantity two
   * there is no way to spend an odd fil, because raising either unit costs
   * two — so the error is taken in the shopper's favour, never the shop's.
   */
  it("never charges more than the bundle says, and is at most a few fils under", () => {
    const awkward = bundle({
      bundlePrice: "10.001",
      members: [
        member({ variantId: 1, unitPrice: "3.000", quantity: 2 }),
        member({ variantId: 2, unitPrice: "4.000", quantity: 2 }),
      ],
    });
    const charged = chargedTotal(splitBundlePrice(awkward));
    expect(compareMoney(charged, "10.001")).toBeLessThanOrEqual(0);
    expect(Number("10.001") - Number(charged)).toBeLessThan(0.01);
  });

  it("is exact when the shares divide cleanly", () => {
    expect(chargedTotal(splitBundlePrice(bundle()))).toBe("216.000");
  });

  it("leaves a set of free things alone rather than dividing by nothing", () => {
    const free = bundle({ bundlePrice: "5.000", members: [member({ unitPrice: "0.000" }), member({ variantId: 2, unitPrice: "0.000" })] });
    expect(splitBundlePrice(free).map(line => line.lineTotal)).toEqual(["0.000", "0.000"]);
  });
});

describe("whether the basket still holds it", () => {
  /* Two thirds of a bundle is a discount nobody agreed to. */
  it("needs every member, at least at the quantity the bundle names", () => {
    const set = bundle();
    expect(bundleComplete(set, [{ variantId: 1, quantity: 1 }, { variantId: 2, quantity: 1 }])).toBe(true);
    expect(bundleComplete(set, [{ variantId: 1, quantity: 1 }])).toBe(false);
  });

  it("allows more than the bundle asks for", () => {
    expect(bundleComplete(bundle(), [{ variantId: 1, quantity: 4 }, { variantId: 2, quantity: 2 }])).toBe(true);
  });

  it("refuses a short quantity", () => {
    const pair = bundle({ members: [member({ variantId: 1, unitPrice: "10.000", quantity: 3 })] });
    expect(bundleComplete(pair, [{ variantId: 1, quantity: 2 }])).toBe(false);
  });
});

describe("sets made by arrangement", () => {
  const set = [{ vendorId: 1 }, { vendorId: 2 }, { vendorId: 2 }, { vendorId: 3 }];

  it("asks every other store once, waiting until it answers", () => {
    const view = bundleAgreement(1, set, []);
    expect(view.asked).toEqual([
      { vendorId: 2, state: "waiting" },
      { vendorId: 3, state: "waiting" },
    ]);
    expect(view.agreed).toBe(false);
    expect(view.declined).toBe(false);
  });

  it("is agreed only when every store asked has agreed", () => {
    expect(bundleAgreement(1, set, [{ vendorId: 2, state: "agreed" }]).agreed).toBe(false);
    expect(bundleAgreement(1, set, [{ vendorId: 2, state: "agreed" }, { vendorId: 3, state: "agreed" }]).agreed).toBe(true);
  });

  it("says when one store declined", () => {
    const view = bundleAgreement(1, set, [{ vendorId: 2, state: "agreed" }, { vendorId: 3, state: "declined" }]);
    expect(view.agreed).toBe(false);
    expect(view.declined).toBe(true);
  });

  it("ignores an answer from a store no longer in the set", () => {
    const view = bundleAgreement(1, [{ vendorId: 1 }, { vendorId: 4 }], [{ vendorId: 2, state: "agreed" }]);
    expect(view.asked).toEqual([{ vendorId: 4, state: "waiting" }]);
    expect(view.agreed).toBe(false);
  });

  it("asks nobody about a store's own set or NetLet's", () => {
    expect(bundleAgreement(1, [{ vendorId: 1 }, { vendorId: 1 }], [])).toEqual({ asked: [], agreed: true, declined: false });
    expect(bundleAgreement(null, set, [])).toEqual({ asked: [], agreed: true, declined: false });
  });

  it("asks again when the price or the items change, not the name", () => {
    const before = { bundlePrice: "90.000", members: [{ variantId: 1, quantity: 1 }, { variantId: 2, quantity: 2 }] };
    expect(bundleChangeNeedsAsking(before, { ...before })).toBe(false);
    expect(bundleChangeNeedsAsking(before, { ...before, bundlePrice: "90" })).toBe(false);
    expect(bundleChangeNeedsAsking(before, { ...before, bundlePrice: "89.500" })).toBe(true);
    expect(bundleChangeNeedsAsking(before, { ...before, members: [{ variantId: 2, quantity: 2 }, { variantId: 1, quantity: 1 }] })).toBe(false);
    expect(bundleChangeNeedsAsking(before, { ...before, members: [{ variantId: 1, quantity: 1 }, { variantId: 2, quantity: 3 }] })).toBe(true);
    expect(bundleChangeNeedsAsking(before, { ...before, members: [{ variantId: 1, quantity: 1 }, { variantId: 3, quantity: 2 }] })).toBe(true);
  });

  it("needs words to decline and none to agree", () => {
    expect(bundleAnswerProblem("agreed", null)).toBeNull();
    expect(bundleAnswerProblem("declined", "  ")).toBe("bundle.declineNeedsNote");
    expect(bundleAnswerProblem("declined", "Our margin is too thin")).toBeNull();
    expect(bundleAnswerProblem("agreed", "x".repeat(BUNDLE_NOTE_MAX + 1))).toBe("bundle.noteTooLong");
  });
});
