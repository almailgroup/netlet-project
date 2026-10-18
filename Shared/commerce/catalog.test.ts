import { describe, expect, it } from "vitest";
import { filterAndSortCatalog } from "@shared/commerce/catalog";
import type { Product } from "@shared/commerce/types";

function product(id: string, price: string, availableForSale: boolean, onOffer = false): Product {
  return {
    id,
    handle: id,
    title: id,
    description: "",
    descriptionHtml: "",
    productType: "Electronics",
    vendor: "NetLet",
    tags: [],
    images: [],
    priceRange: { min: { amount: price, currencyCode: "KWD" }, max: { amount: price, currencyCode: "KWD" } },
    options: [],
    variants: [{ id: `${id}-variant`, title: "Default Title", price: { amount: price, currencyCode: "KWD" }, compareAtPrice: onOffer ? { amount: "99.00", currencyCode: "KWD" } : null, availableForSale, selectedOptions: [] }],
  };
}

describe("catalog discovery", () => {
  const products = [product("premium", "60.00", true), product("offer", "20.00", true, true), product("unavailable", "10.00", false)];

  it("filters products by their live sale availability", () => {
    expect(filterAndSortCatalog(products, { availability: "available", sort: "catalog" }).map((item) => item.id)).toEqual(["premium", "offer"]);
    expect(filterAndSortCatalog(products, { availability: "unavailable", sort: "catalog" }).map((item) => item.id)).toEqual(["unavailable"]);
  });

  it("sorts only by authoritative product pricing and compare-at offers", () => {
    expect(filterAndSortCatalog(products, { availability: "all", sort: "price-low" }).map((item) => item.id)).toEqual(["unavailable", "offer", "premium"]);
    expect(filterAndSortCatalog(products, { availability: "all", sort: "price-high" }).map((item) => item.id)).toEqual(["premium", "offer", "unavailable"]);
    expect(filterAndSortCatalog(products, { availability: "all", sort: "offers" }).map((item) => item.id)[0]).toBe("offer");
  });
});
