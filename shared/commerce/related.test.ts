import { describe, expect, it } from "vitest";
import { relatedProducts } from "./related.js";
import type { Product } from "./types.js";

function product(id: string, title: string, productType: string, tags: string[], vendor = "NetLet"): Product {
  return {
    id,
    title,
    handle: id,
    description: "",
    descriptionHtml: "",
    productType,
    vendor,
    tags,
    images: [],
    priceRange: { min: { amount: "10", currencyCode: "KWD" }, max: { amount: "10", currencyCode: "KWD" } },
    options: [],
    variants: [],
  };
}

describe("relatedProducts", () => {
  it("excludes the active product and ranks shared type and tags first", () => {
    const active = product("espresso", "Brew Mini Espresso Maker", "Home & Kitchen", ["coffee", "kitchen"]);
    const catalog = [
      active,
      product("kettle", "Kettle", "Home & Kitchen", ["kitchen"]),
      product("headphones", "Headphones", "Electronics", ["audio"]),
      product("grinder", "Coffee Grinder", "Home & Kitchen", ["coffee", "kitchen"]),
    ];

    /* The headphones share nothing but the shop, and are not related. */
    expect(relatedProducts(active, catalog).map(item => item.id)).toEqual(["grinder", "kettle"]);
  });

  it("never suggests something only because the same store sells it", () => {
    const phone = product("phone", "Galaxy S26", "Electronics", ["phone"], "Phone store Hawally");
    const processor = product("processor", "Food processor", "Home & Kitchen", [], "Phone store Hawally");
    const caseFor = product("case", "Galaxy S26 case", "Electronics", ["phone"], "Another shop");
    expect(relatedProducts(phone, [phone, processor, caseFor]).map(item => item.id)).toEqual(["case"]);
    expect(relatedProducts(phone, [phone, processor])).toEqual([]);
  });
});
