import { describe, expect, it } from "vitest";
import {
  collapseObservations,
  complementsFor,
  MIN_LIFT,
  MIN_SUPPORT,
  PAIR_WEIGHT,
  type Pairing,
} from "./together.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function product(id: string, over: Partial<Product> = {}): Product {
  return {
    id, handle: id, title: over.title ?? id, description: "", descriptionHtml: "",
    productType: null, vendor: null, vendorBadges: [], tags: [], attributes: [],
    images: [], options: [], priceRange: { min: money("5.000"), max: money("5.000") },
    variants: [{
      id: `${id}-v`, title: "Default", sku: null, price: money("5.000"),
      compareAtPrice: null, availableForSale: true, selectedOptions: [],
    }],
    ...over,
  };
}

const phone = product("phone", { title: "Phone", vendor: "Byte Co" });
const kase = product("case", { title: "Phone case", vendor: "Accessory Co" });
const glass = product("glass", { title: "Screen protector", vendor: "Byte Co" });
const batteries = product("batteries", { title: "Batteries", vendor: "Byte Co" });

const catalog = new Map([phone, kase, glass, batteries].map(p => [p.id, p]));

describe("ranking complements", () => {
  /*
   * The whole point. Batteries are in more baskets than the case, but they
   * are in *everyone's* basket — so the case is the complement and the
   * batteries are just a bestseller. Ranking on raw co-occurrence gets this
   * exactly backwards, which is why the score is lift.
   */
  it("prefers a true complement over a bestseller that co-occurs with everything", () => {
    const universe = 100;
    const anchorTotal = 10;           // ten baskets held the phone
    const pairings: Pairing[] = [
      // 7 of the 10 phone baskets, and the case is rare otherwise.
      { productId: "case", together: 7, total: 9 },
      // In 8 of the 10 — more baskets than the case — but in 60 of the 100
      // overall, so barely better than chance.
      { productId: "batteries", together: 8, total: 60 },
    ];

    const ranked = complementsFor(phone, anchorTotal, universe, pairings, catalog);
    // Batteries appear in *more* of the phone's baskets and still rank below:
    // that is the difference between co-occurrence and association.
    expect(ranked.map(entry => entry.product.id)).toEqual(["case", "batteries"]);
    // 7/10 ÷ 9/100 ≈ 7.8 against 8/10 ÷ 60/100 ≈ 1.33
    expect(ranked[0].lift).toBeCloseTo(7.78, 1);
    expect(ranked[1].lift).toBeCloseTo(1.33, 2);
    expect(ranked[0].confidence).toBeCloseTo(0.7);
  });

  it("drops a pairing no more likely than chance", () => {
    const pairings: Pairing[] = [{ productId: "batteries", together: 5, total: 50 }];
    // 5/10 ÷ 50/100 = 1.0, which is exactly chance.
    expect(complementsFor(phone, 10, 100, pairings, catalog)).toEqual([]);
    expect(MIN_LIFT).toBeGreaterThan(1);
  });

  /* Two people buying a rug and a kettle on one afternoon is a coincidence. */
  it("refuses a pairing seen fewer than MIN_SUPPORT times, however strong", () => {
    const barelySeen: Pairing[] = [{ productId: "case", together: MIN_SUPPORT - 1, total: 1 }];
    expect(complementsFor(phone, 10, 100, barelySeen, catalog)).toEqual([]);

    const seenEnough: Pairing[] = [{ productId: "case", together: MIN_SUPPORT, total: 3 }];
    expect(complementsFor(phone, 10, 100, seenEnough, catalog)).toHaveLength(1);
  });

  /* The requirement asks for cross-vendor explicitly; it is where the value is. */
  it("keeps a complement from another seller and says so", () => {
    const pairings: Pairing[] = [
      { productId: "case", together: 7, total: 9 },     // Accessory Co
      { productId: "glass", together: 6, total: 8 },    // Byte Co, same as phone
    ];
    const ranked = complementsFor(phone, 10, 100, pairings, catalog);
    const byId = new Map(ranked.map(entry => [entry.product.id, entry]));
    expect(byId.get("case")!.crossVendor).toBe(true);
    expect(byId.get("glass")!.crossVendor).toBe(false);
  });

  it("never recommends the product back to itself", () => {
    const pairings: Pairing[] = [{ productId: "phone", together: 99, total: 99 }];
    expect(complementsFor(phone, 10, 100, pairings, catalog)).toEqual([]);
  });

  /* The same two refusals the recommender makes, at a third door. */
  it("refuses a sold-out complement and one priced at nothing", () => {
    const soldOut = product("sold-out", { variants: [{ id: "v", title: "D", sku: null, price: money("5.000"), compareAtPrice: null, availableForSale: false, selectedOptions: [] }] });
    const free = product("free", { variants: [{ id: "v", title: "D", sku: null, price: money("0.000"), compareAtPrice: null, availableForSale: true, selectedOptions: [] }] });
    const wider = new Map(catalog);
    wider.set(soldOut.id, soldOut);
    wider.set(free.id, free);

    const pairings: Pairing[] = [
      { productId: "sold-out", together: 9, total: 9 },
      { productId: "free", together: 9, total: 9 },
    ];
    expect(complementsFor(phone, 10, 100, pairings, wider)).toEqual([]);
  });

  it("ignores a pairing for a product that has left the catalog", () => {
    const pairings: Pairing[] = [{ productId: "withdrawn", together: 9, total: 9 }];
    expect(complementsFor(phone, 10, 100, pairings, catalog)).toEqual([]);
  });

  it("returns nothing rather than padding when the shop has no history", () => {
    expect(complementsFor(phone, 0, 100, [{ productId: "case", together: 7, total: 9 }], catalog)).toEqual([]);
    expect(complementsFor(phone, 10, 0, [{ productId: "case", together: 7, total: 9 }], catalog)).toEqual([]);
    expect(complementsFor(phone, 10, 100, [], catalog)).toEqual([]);
  });

  it("is stable: equal scores break on title, not on input order", () => {
    const pairings: Pairing[] = [
      { productId: "case", together: 6, total: 9 },
      { productId: "glass", together: 6, total: 9 },
    ];
    const forward = complementsFor(phone, 10, 100, pairings, catalog).map(e => e.product.id);
    const backward = complementsFor(phone, 10, 100, [...pairings].reverse(), catalog).map(e => e.product.id);
    expect(forward).toEqual(backward);
  });

  it("honours the limit", () => {
    const pairings: Pairing[] = [
      { productId: "case", together: 7, total: 9 },
      { productId: "glass", together: 6, total: 8 },
      { productId: "batteries", together: 9, total: 12 },
    ];
    expect(complementsFor(phone, 10, 100, pairings, catalog, 2)).toHaveLength(2);
  });
});

describe("collapsing observations", () => {
  it("weights a purchase above a basket", () => {
    expect(PAIR_WEIGHT.bought).toBeGreaterThan(PAIR_WEIGHT.bagged);
  });

  /*
   * One basket holding two variants of the same product is one basket. Without
   * this, a shopper buying a shirt in two sizes would double the evidence for
   * every pairing that basket contains.
   */
  it("counts a product once per basket, however many lines it filled", () => {
    const totals = collapseObservations([
      { basketId: "b1", productId: "shirt", kind: "bagged" },
      { basketId: "b1", productId: "shirt", kind: "bagged" },
      { basketId: "b1", productId: "shirt", kind: "bagged" },
    ]);
    expect(totals.get("shirt")).toBe(PAIR_WEIGHT.bagged);
  });

  it("takes the strongest kind when a basket both bagged and bought it", () => {
    const totals = collapseObservations([
      { basketId: "b1", productId: "lamp", kind: "bagged" },
      { basketId: "b1", productId: "lamp", kind: "bought" },
    ]);
    expect(totals.get("lamp")).toBe(PAIR_WEIGHT.bought);
  });

  it("adds a product's weight across separate baskets", () => {
    const totals = collapseObservations([
      { basketId: "b1", productId: "lamp", kind: "bought" },
      { basketId: "b2", productId: "lamp", kind: "bagged" },
    ]);
    expect(totals.get("lamp")).toBe(PAIR_WEIGHT.bought + PAIR_WEIGHT.bagged);
  });
});
