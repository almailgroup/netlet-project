import { describe, expect, it } from "vitest";
import {
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
