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

    expect(relatedProducts(active, catalog).map(item => item.id)).toEqual(["grinder", "kettle", "headphones"]);
  });
});
