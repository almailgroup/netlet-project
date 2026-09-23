import { describe, expect, it } from "vitest";
import { MAX_BOOST, placementBoost, savingPercentOf, withPlacement } from "./placement.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

const product = (id: string, over: { price?: string; was?: string | null; inStock?: boolean } = {}): Product => ({
  id, handle: id, title: id, description: "", descriptionHtml: "", productType: null, vendor: null,
  vendorBadges: [], tags: [], attributes: [], images: [], media: [],
  priceRange: { min: money(over.price ?? "100.000"), max: money(over.price ?? "100.000") },
  options: [], deliverySpeed: null, deliveryProvider: null,
  variants: [{
    id: `${id}-v`, title: "Default", sku: null,
    price: money(over.price ?? "100.000"),
    compareAtPrice: over.was === null || over.was === undefined ? null : money(over.was),
    availableForSale: over.inStock ?? true,
    selectedOptions: [], image: null, measure: { unit: "each", stepAmount: 1 }, preorder: null,
  }] as Product["variants"],
});

describe("what a saving is worth", () => {
  it("reads the deepest live saving across the variants", () => {
    expect(savingPercentOf(product("a", { price: "75.000", was: "100.000" }))).toBe(25);
  });

  /*
   * An expired permit cannot earn placement, and it is not checked here
   * because it cannot arrive here: `fromInventory` has already dropped
   * `compareAtPrice`, so an unlicensed offer is indistinguishable from none.
   */
  it("earns nothing without a compare-at price", () => {
    expect(placementBoost(product("a"))).toBe(0);
  });

  /* A rounding difference is not an offer. */
  it("ignores a saving too small to be one", () => {
    expect(placementBoost(product("a", { price: "98.000", was: "100.000" }))).toBe(0);
  });

  it("ignores a compare-at price at or below the price", () => {
    expect(savingPercentOf(product("a", { price: "100.000", was: "100.000" }))).toBe(0);
    expect(savingPercentOf(product("a", { price: "100.000", was: "80.000" }))).toBe(0);
  });

  /* The dead-control rule at the size of a shelf. */
  it("lifts nothing that cannot be bought", () => {
    expect(placementBoost(product("a", { price: "40.000", was: "100.000", inStock: false }))).toBe(0);
  });

  /* Beyond a point a bigger number is a clearance sale, not a better shop. */
  it("scales with depth and then stops", () => {
    const shallow = placementBoost(product("a", { price: "90.000", was: "100.000" }));
    const deep = placementBoost(product("b", { price: "60.000", was: "100.000" }));
    const deeper = placementBoost(product("c", { price: "10.000", was: "100.000" }));
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(deeper).toBe(MAX_BOOST);
    expect(deeper).toBe(placementBoost(product("d", { price: "1.000", was: "100.000" })));
  });
});

describe("reordering a page", () => {
  it("puts a discounting seller ahead of one that is not", () => {
    const page = withPlacement([product("plain"), product("cut", { price: "60.000", was: "100.000" })]);
    expect(page.map(p => p.id)).toEqual(["cut", "plain"]);
  });

  /*
   * Stable: a page that shuffles equal items changes under somebody reloading
   * it, which is indistinguishable from a bug.
   */
  it("keeps the merchant's own order among equals", () => {
    const page = withPlacement([product("a"), product("b"), product("c")]);
    expect(page.map(p => p.id)).toEqual(["a", "b", "c"]);

    const mixed = withPlacement([
      product("a", { price: "60.000", was: "100.000" }),
      product("b", { price: "60.000", was: "100.000" }),
    ]);
    expect(mixed.map(p => p.id)).toEqual(["a", "b"]);
  });

  it("orders deeper savings first", () => {
    const page = withPlacement([
      product("small", { price: "90.000", was: "100.000" }),
      product("big", { price: "50.000", was: "100.000" }),
    ]);
    expect(page.map(p => p.id)).toEqual(["big", "small"]);
  });
});
