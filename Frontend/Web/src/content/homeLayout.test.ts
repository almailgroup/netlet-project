import { describe, expect, it } from "vitest";
import { categoryRail, homeRailDefinitions, MAX_SHELF_PRODUCTS, MIN_SHELF_PRODUCTS, shelvesFor } from "./homeLayout";
import { en, type MessageKey } from "@shared/i18n/dictionary";
import type { Product } from "@shared/commerce/types";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

const product = (id: string, was: string | null = null): Product => ({
  id, handle: id, title: id, description: "", descriptionHtml: "", productType: null, vendor: null,
  vendorBadges: [], tags: [], attributes: [], images: [], media: [],
  priceRange: { min: money("10.000"), max: money("10.000") },
  options: [], deliverySpeed: null, deliveryProvider: null,
  variants: [{
    id: `${id}-v`, title: "Default", sku: null, price: money("10.000"),
    compareAtPrice: was ? money(was) : null, availableForSale: true,
    selectedOptions: [], image: null, measure: { unit: "each", stepAmount: 1 }, preorder: null,
  }] as Product["variants"],
});

const plain = (count: number, from = 0) => Array.from({ length: count }, (_, i) => product(`p${from + i}`));
const offers = (count: number) => Array.from({ length: count }, (_, i) => product(`d${i}`, "20.000"));

describe("NetLet home layout content", () => {
  it("keeps three shelves, each with its own reason to exist", () => {
    expect(homeRailDefinitions.map((rail) => en[rail.title])).toEqual(["Deals", "Bestsellers", "New arrivals"]);
  });

  it("keeps the category section available", () => {
    expect(categoryRail).toHaveLength(6);
  });

  // Every string on the home page comes out of the dictionary, so a key that
  // is not in it renders as the key itself in both languages.
  it("references only keys the dictionary actually defines", () => {
    const keys: MessageKey[] = [
      ...categoryRail.map((category) => category.key),
      ...homeRailDefinitions.map((rail) => rail.title),
    ];
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });
});

describe("what each shelf shows", () => {
  it("hides a shelf below the floor rather than drawing two or three cards", () => {
    const shelves = shelvesFor([...offers(MIN_SHELF_PRODUCTS - 1), ...plain(8)]);
    expect(shelves.deals).toEqual([]);
    /* What the hidden shelf did not show is free for the next one. */
    expect(shelves.newest).toHaveLength(8 + MIN_SHELF_PRODUCTS - 1);
  });

  it("never shows a product on both shelves", () => {
    const shelves = shelvesFor([...offers(5), ...plain(6)]);
    expect(shelves.deals.map((p) => p.id).sort()).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    expect(shelves.newest.map((p) => p.id).filter((id) => id.startsWith("d"))).toEqual([]);
    expect(shelves.newest).toHaveLength(6);
  });

  it("puts only discounted products on Deals", () => {
    expect(shelvesFor(plain(20)).deals).toEqual([]);
  });

  it("caps a shelf, and New arrivals takes whatever Deals left", () => {
    const shelves = shelvesFor([...offers(15), ...plain(3)]);
    expect(shelves.deals).toHaveLength(MAX_SHELF_PRODUCTS);
    /* Three left over plus three plain is six. */
    expect(shelves.newest).toHaveLength(6);
    expect(shelvesFor([...offers(12), ...plain(3)]).newest).toHaveLength(3);
    expect(shelvesFor(offers(12)).newest).toEqual([]);
  });

  it("draws Bestsellers from what sold, after Deals and never twice", () => {
    const sold = [product("d0", "20.000"), ...plain(5, 100)];
    const shelves = shelvesFor([...offers(5), ...plain(3)], sold);
    /* d0 is on Deals, so Bestsellers is the five others. */
    expect(shelves.bestsellers.map(p => p.id)).toEqual(["p100", "p101", "p102", "p103", "p104"]);
    expect(shelvesFor(plain(3), plain(3, 100)).bestsellers).toEqual([]);
    expect(shelvesFor(plain(3)).bestsellers).toEqual([]);
  });

  /* A shop with three products live opened on its departments and nothing
     else, because both shelves were held to the four-product floor. */
  it("shows every product of a small shop under New arrivals", () => {
    const shelves = shelvesFor([...offers(2), ...plain(1)]);
    expect(shelves.deals).toEqual([]);
    expect(shelves.newest.map(p => p.id).sort()).toEqual(["d0", "d1", "p0"]);
    expect(shelvesFor([]).newest).toEqual([]);
  });
});
