import { describe, expect, it } from "vitest";
import { DEAL_SHELF_SIZE, dealShelves } from "./deals.js";
import type { Product, ProductVariant } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function variant(price: string, was: string): ProductVariant {
  return { id: `v-${price}-${was}`, title: "Default Title", sku: null, price: money(price), compareAtPrice: money(was), availableForSale: true, selectedOptions: [] };
}

/** A deal: `saving` percent off ten dinars. */
function deal(id: string, productType: string | null, subcategory: string | null, saving = 10): Product {
  const variants = [variant(String(10 - saving / 10), "10")];
  return {
    id, handle: id, title: id, description: "", descriptionHtml: "", productType, vendor: null, tags: [], attributes: [],
    images: [], options: [], priceRange: { min: variants[0].price, max: variants[0].price }, variants,
    ...(subcategory ? { subcategory } : {}),
  } as Product;
}

describe("the Deals page's shelves", () => {
  it("is a shelf per kind of thing, the fullest first", () => {
    const shelves = dealShelves([
      deal("phone-a", "Electronics", "phones"),
      deal("rice", "Grocery", "pantry"),
      deal("phone-b", "Electronics", "phones"),
      deal("oil", "Grocery", "pantry"),
      deal("dates", "Grocery", "pantry"),
    ], { deepestFirst: false });
    expect(shelves.map(shelf => shelf.key)).toEqual(["grocery/pantry", "electronics/phones"]);
    expect(shelves[0]).toMatchObject({ department: "grocery", subcategory: "pantry", total: 3 });
  });

  it("puts a kind with one deal on its department's own shelf, after the department's kinds", () => {
    const shelves = dealShelves([
      deal("phone-a", "Electronics", "phones"),
      deal("phone-b", "Electronics", "phones"),
      deal("tablet", "Electronics", "tablets"),
      deal("cable", "Electronics", null),
    ], { deepestFirst: false });
    expect(shelves.map(shelf => [shelf.key, shelf.products.map(product => product.id)])).toEqual([
      ["electronics/phones", ["phone-a", "phone-b"]],
      ["electronics", ["tablet", "cable"]],
    ]);
    expect(shelves[1].subcategory).toBeNull();
  });

  it("leads each shelf with the deepest saving unless an order was chosen", () => {
    const products = [deal("small", "Electronics", "phones", 10), deal("deep", "Electronics", "phones", 40), deal("mid", "Electronics", "phones", 20)];
    expect(dealShelves(products, { deepestFirst: true })[0].products.map(product => product.id)).toEqual(["deep", "mid", "small"]);
    expect(dealShelves(products, { deepestFirst: false })[0].products.map(product => product.id)).toEqual(["small", "deep", "mid"]);
  });

  it("puts what is in no department NetLet keeps last, and cuts a shelf to its size", () => {
    const many = Array.from({ length: DEAL_SHELF_SIZE + 3 }, (_, index) => deal(`p${index}`, "Beauty", "makeup"));
    const shelves = dealShelves([...many, deal("odd-1", "Gadgets", null), deal("odd-2", null, null)], { deepestFirst: false });
    const last = shelves[shelves.length - 1];
    expect(last).toMatchObject({ key: "other", department: null, subcategory: null, total: 2 });
    const beauty = shelves.find(shelf => shelf.department === "beauty");
    expect(beauty?.total).toBe(DEAL_SHELF_SIZE + 3);
    expect(beauty?.products).toHaveLength(DEAL_SHELF_SIZE);
  });

  it("ignores a kind the department does not have", () => {
    const shelves = dealShelves([deal("a", "Electronics", "nonsense"), deal("b", "Electronics", "nonsense")], { deepestFirst: false });
    expect(shelves.map(shelf => shelf.key)).toEqual(["electronics"]);
  });
});
