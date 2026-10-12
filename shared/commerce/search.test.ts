import { describe, expect, it } from "vitest";
import { correctionFor, editDistance, matchesSearch, rankBySearch, searchScore, tokensOf } from "./search.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    handle: id,
    title: id,
    description: "",
    descriptionHtml: "",
    productType: null,
    vendor: null,
    tags: [],
    attributes: [],
    images: [],
    options: [],
    priceRange: { min: money("10"), max: money("10") },
    variants: [{ id: `${id}-v`, title: "Default", sku: null, price: money("10"), compareAtPrice: null, availableForSale: true, selectedOptions: [] }],
    ...overrides,
  } as Product;
}

const brand = (value: string) => ({ namespace: "specs", key: "brand", label: "Brand", value });

const phone = product("galaxy", { title: "Samsung Galaxy S26 Ultra phone", productType: "Electronics", vendor: "Phone store Hawally", attributes: [brand("Samsung")] });
const processor = product("processor", { title: "Philips food processor", productType: "Home & Kitchen", vendor: "Phone store Hawally", attributes: [brand("Philips")] });
const holder = product("holder", { title: "Car mount", productType: "Electronics", description: "Holds any phone on the dashboard." });
const shade = product("shade", { title: "Linen lampshade", productType: "Home & Kitchen" });
const lamp = product("lamp", { title: "Brass lamp", productType: "Home & Kitchen" });

describe("what a search finds", () => {
  it("never matches on the seller's name", () => {
    expect(matchesSearch(processor, "phone")).toBe(false);
    expect(matchesSearch(processor, "hawally")).toBe(false);
    expect(matchesSearch(phone, "phone")).toBe(true);
  });

  it("ranks the title above the brand above the description", () => {
    expect(rankBySearch([holder, processor, phone], "phone").map(p => p.id)).toEqual(["galaxy", "holder"]);
    expect(searchScore(phone, "phone")).toBeGreaterThan(searchScore(holder, "phone"));
  });

  it("puts a whole word ahead of a word it starts", () => {
    expect(rankBySearch([shade, lamp], "lamp").map(p => p.id)).toEqual(["lamp", "shade"]);
  });

  it("needs every word, found somewhere", () => {
    expect(matchesSearch(lamp, "brass lamp")).toBe(true);
    expect(matchesSearch(shade, "brass lamp")).toBe(false);
  });

  it("finds a product by its department in either language", () => {
    expect(matchesSearch(holder, "electronics")).toBe(true);
    expect(matchesSearch(holder, "إلكترونيات")).toBe(true);
  });

  it("reads Arabic-Indic digits as digits", () => {
    expect(tokensOf("S٢٦")).toEqual(["s26"]);
  });
});

describe("a misspelling", () => {
  it("counts a swap as one edit", () => {
    expect(editDistance("samsng", "samsung")).toBe(1);
    expect(editDistance("smasung", "samsung")).toBe(1);
    expect(editDistance("lamp", "lamp")).toBe(0);
  });

  it("is corrected to the catalogue's own spelling", () => {
    expect(correctionFor("samsng", [phone, processor])).toBe("Samsung");
    expect(correctionFor("philps processor", [phone, processor])).toBe("Philips processor");
  });

  it("is left alone when it is a real word, or when nothing is close", () => {
    expect(correctionFor("samsung", [phone])).toBeNull();
    expect(correctionFor("zzqx", [phone])).toBeNull();
    /* Too short to guess at: "tv" is one edit from far too much. */
    expect(correctionFor("ty", [phone])).toBeNull();
  });
});
