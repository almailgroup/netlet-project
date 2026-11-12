import { describe, expect, it } from "vitest";
import { departmentFacts, departmentWays, MIN_RATED, TOP_BRANDS } from "./categoryGuide.js";
import type { Product, ProductVariant } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function variant(price: string, was?: string): ProductVariant {
  return {
    id: `v-${price}-${was ?? ""}`,
    title: "Default Title",
    sku: null,
    price: money(price),
    compareAtPrice: was ? money(was) : null,
    availableForSale: true,
    selectedOptions: [],
  };
}

function product(id: string, overrides: Partial<Product> = {}): Product {
  const variants = overrides.variants ?? [variant("10")];
  return {
    handle: id,
    title: id,
    description: "",
    descriptionHtml: "",
    productType: "Electronics",
    vendor: null,
    tags: [],
    attributes: [],
    images: [],
    options: [],
    priceRange: { min: variants[0].price, max: variants[0].price },
    ...overrides,
    id,
    variants,
  };
}

const brand = (name: string) => ({ namespace: "spec", key: "brand", label: "Brand", value: name });
const stars = { namespace: "reviews", key: "rating", label: "Rating", value: "4.5" };

describe("departmentFacts", () => {
  const shelf = [
    product("phone", { subcategory: "phones", variants: [variant("100", "120")], attributes: [brand("Samsung"), stars] }),
    product("case", { subcategory: "phones", attributes: [brand("Samsung")] }),
    product("watch", { subcategory: "wearables", variants: [variant("40", "50")], attributes: [brand("Apple")] }),
    product("laptop", { subcategory: "laptops", reviewSummary: { average: 4.2, count: 3 } }),
    product("lamp", { productType: "Home & Kitchen", variants: [variant("5", "9")] }),
  ];

  it("counts the department's own products and nothing of another's", () => {
    const facts = departmentFacts(shelf, "Electronics");
    expect(facts.products).toBe(4);
    expect(facts.deals).toBe(2);
    expect(facts.rated).toBe(2);
  });

  it("names its brands, the most products first, ties by name", () => {
    expect(departmentFacts(shelf, "Electronics").brands).toEqual([
      { name: "Samsung", count: 2 },
      { name: "Apple", count: 1 },
    ]);
  });

  it("holds the brands to the top few", () => {
    const many = Array.from({ length: TOP_BRANDS + 3 }, (_, index) => product(`p${index}`, { attributes: [brand(`B${index}`)] }));
    expect(departmentFacts(many, "Electronics").brands).toHaveLength(TOP_BRANDS);
  });

  it("counts the deals in each subcategory, and leaves out one with none", () => {
    expect(departmentFacts(shelf, "Electronics").subDeals).toEqual({ phones: 1, wearables: 1 });
  });

  it("is empty for a department with nothing on the shelf", () => {
    expect(departmentFacts(shelf, "Beauty")).toEqual({ products: 0, deals: 0, rated: 0, brands: [], subDeals: {} });
  });
});

describe("departmentWays", () => {
  it("offers deals only with a deal, the newest from two, top rated from enough stars", () => {
    expect(departmentWays(departmentFacts([], "Electronics"))).toEqual([]);
    expect(departmentWays({ products: 1, deals: 1, rated: 1, brands: [], subDeals: {} })).toEqual(["deals"]);
    expect(departmentWays({ products: 5, deals: 0, rated: MIN_RATED, brands: [], subDeals: {} })).toEqual(["newest", "rating"]);
  });
});
