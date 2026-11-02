import { describe, expect, it } from "vitest";
import { categoryRail, dealsDrawn, departmentTabs, homeRailDefinitions, MAX_OCCASIONS, MAX_SHELF_PRODUCTS, MAX_TABBED_PRODUCTS, MEGA_DEAL_PERCENT, MIN_SHELF_PRODUCTS, shelvesFor } from "./homeLayout";
import { en, type MessageKey } from "@shared/i18n/dictionary";
import type { Product } from "@shared/commerce/types";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

const product = (id: string, was: string | null = null, type: string | null = null, tags: string[] = []): Product => ({
  id, handle: id, title: id, description: "", descriptionHtml: "", productType: type, vendor: null,
  vendorBadges: [], tags, attributes: [], images: [], media: [],
  priceRange: { min: money("10.000"), max: money("10.000") },
  options: [], deliverySpeed: null, deliveryProvider: null,
  variants: [{
    id: `${id}-v`, title: "Default", sku: null, price: money("10.000"),
    compareAtPrice: was ? money(was) : null, availableForSale: true,
    selectedOptions: [], image: null, measure: { unit: "each", stepAmount: 1 }, preorder: null,
  }] as Product["variants"],
});

const plain = (count: number, from = 0, type: string | null = null) => Array.from({ length: count }, (_, i) => product(`p${from + i}`, null, type));
/* Half off: a mega deal. */
const offers = (count: number) => Array.from({ length: count }, (_, i) => product(`d${i}`, "20.000"));
/* Ten per cent off: a deal, never a mega one. */
const small = (count: number) => Array.from({ length: count }, (_, i) => product(`s${i}`, "11.111"));

describe("NetLet home layout content", () => {
  it("keeps the computed shelves in the owner's order, each with its own reason to exist", () => {
    expect(homeRailDefinitions.map((rail) => en[rail.title])).toEqual(["Mega deals", "Deals", "Trending", "Bestsellers", "New arrivals"]);
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
  it("hides a strip below the floor rather than drawing two or three cards", () => {
    const shelves = shelvesFor([...offers(MIN_SHELF_PRODUCTS - 1), ...plain(8)]);
    expect(shelves.mega).toEqual([]);
    expect(shelves.deals).toEqual([]);
    /* What the hidden shelves did not show is free for the next one. */
    expect(shelves.newest).toHaveLength(8 + MIN_SHELF_PRODUCTS - 1);
  });

  it("never shows a product on two shelves", () => {
    const shelves = shelvesFor([...offers(5), ...plain(6)]);
    expect(shelves.mega.map((p) => p.id).sort()).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    expect(shelves.deals).toEqual([]);
    expect(shelves.newest.map((p) => p.id).filter((id) => id.startsWith("d"))).toEqual([]);
    expect(shelves.newest).toHaveLength(6);
  });

  it("puts only discounted products on the deals shelves", () => {
    const shelves = shelvesFor(plain(20));
    expect(shelves.mega).toEqual([]);
    expect(shelves.deals).toEqual([]);
  });

  /* The owner asked for major deals and general deals apart: a saving from
     MEGA_DEAL_PERCENT off leads the page as a mega deal, and a smaller one
     is a deal. */
  it("sorts the deep savings onto Mega deals and the rest onto Deals", () => {
    expect(MEGA_DEAL_PERCENT).toBe(30);
    const shelves = shelvesFor([...small(5), ...offers(4), ...plain(2)]);
    expect(shelves.mega.map((p) => p.id).sort()).toEqual(["d0", "d1", "d2", "d3"]);
    expect(shelves.deals.map((p) => p.id).sort()).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(shelves.newest.map((p) => p.id).sort()).toEqual(["p0", "p1"]);
    /* Deep savings the band could not hold are deals, not nothing. */
    const spill = shelvesFor(offers(MAX_SHELF_PRODUCTS + 4));
    expect(spill.mega).toHaveLength(MAX_SHELF_PRODUCTS);
    expect(spill.deals).toHaveLength(4);
    expect(spill.newest).toEqual([]);
  });

  it("caps a strip, and New arrivals takes whatever the deals left", () => {
    const shelves = shelvesFor([...offers(15), ...plain(3)]);
    expect(shelves.mega).toHaveLength(MAX_SHELF_PRODUCTS);
    /* Three deep savings left over are under the Deals floor, so they are free for New arrivals. */
    expect(shelves.deals).toEqual([]);
    expect(shelves.newest).toHaveLength(6);
    expect(shelvesFor([...offers(12), ...plain(3)]).newest).toHaveLength(3);
    expect(shelvesFor(offers(12)).newest).toEqual([]);
    /* A tabbed shelf keeps two dozen, so a department's tab is a shelf and not a pair. */
    expect(shelvesFor([...small(30)]).deals).toHaveLength(MAX_TABBED_PRODUCTS);
  });

  it("draws Trending, then Bestsellers, from the server's lists, after the deals and never twice", () => {
    const hot = [product("d0", "20.000"), ...plain(5, 100)];
    const sold = [product("p100"), product("p101"), ...plain(5, 200)];
    const shelves = shelvesFor([...offers(5), ...plain(3)], sold, hot);
    /* d0 is on Mega deals, so Trending is the five others. */
    expect(shelves.trending.map(p => p.id)).toEqual(["p100", "p101", "p102", "p103", "p104"]);
    /* Two of the bestsellers are trending already, so it is the five left. */
    expect(shelves.bestsellers.map(p => p.id)).toEqual(["p200", "p201", "p202", "p203", "p204"]);
    expect(shelvesFor(plain(3), plain(3, 100)).bestsellers).toEqual([]);
    expect(shelvesFor(plain(3), [], plain(3, 100)).trending).toEqual([]);
    expect(shelvesFor(plain(3)).bestsellers).toEqual([]);
  });

  /* A shop with three products live opened on its departments and nothing
     else, because both shelves were held to the four-product floor. */
  it("shows every product of a small shop under New arrivals", () => {
    const shelves = shelvesFor([...offers(2), ...plain(1)]);
    expect(shelves.mega).toEqual([]);
    expect(shelves.deals).toEqual([]);
    expect(shelves.newest.map(p => p.id).sort()).toEqual(["d0", "d1", "p0"]);
    expect(shelvesFor([]).newest).toEqual([]);
  });

  /* The seasons and the occasions, on the owner's word: the products the
     stores tagged for an occasion whose shopping is on today, after the
     deals and before Trending, at most two occasions, and nothing on a day
     with none. */
  it("draws an occasion's shelf from the stores' tags while its shopping is on", () => {
    const school = Array.from({ length: 5 }, (_, i) => product(`s${i}`, null, "Electronics", ["Back to School"]));
    const winter = Array.from({ length: 4 }, (_, i) => product(`w${i}`, null, null, ["winter"]));
    const newYear = Array.from({ length: 4 }, (_, i) => product(`n${i}`, null, null, ["new-year"]));
    const august = new Date("2026-08-20T09:00:00Z");
    const shelves = shelvesFor([...school, ...winter, ...plain(3)], [], [], august);
    expect(shelves.occasions.map(entry => entry.occasion.slug)).toEqual(["back-to-school"]);
    expect(shelves.occasions[0].products.map(p => p.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    /* What an occasion shows leaves the shelves below it. */
    expect(shelves.newest.map(p => p.id).filter(id => id.startsWith("s"))).toEqual([]);
    /* Off season, nothing — and a deal is a deal before it is seasonal. */
    expect(shelvesFor([...school, ...winter], [], [], new Date("2026-11-02T09:00:00Z")).occasions).toEqual([]);
    const sale = school.map(entry => ({ ...entry, variants: [{ ...entry.variants[0], compareAtPrice: { amount: "20.000", currencyCode: "KWD" } }] }));
    expect(shelvesFor(sale, [], [], august).occasions).toEqual([]);
    /* Under the floor it is not drawn, and the products are free for the next shelf. */
    expect(shelvesFor(school.slice(0, 3), [], [], august).occasions).toEqual([]);
    expect(shelvesFor(school.slice(0, 3), [], [], august).newest).toHaveLength(3);
    /* The end of the year has winter and the New Year; two is the most, and the table's order decides. */
    const december = shelvesFor([...winter, ...newYear], [], [], new Date("2026-12-25T09:00:00Z"));
    expect(december.occasions.map(entry => entry.occasion.slug)).toEqual(["winter", "new-year"]);
    expect(MAX_OCCASIONS).toBe(2);
  });

  it("says a deals shelf is drawn when either deals shelf is", () => {
    expect(dealsDrawn(shelvesFor(offers(4)))).toBe(true);
    expect(dealsDrawn(shelvesFor(small(4)))).toBe(true);
    expect(dealsDrawn(shelvesFor([...offers(3), ...plain(4)]))).toBe(false);
  });
});

describe("a shelf's department tabs", () => {
  it("offers the departments with two or more on the shelf, in the departments' order, keeping the shelf's order", () => {
    const shelf = [
      product("a", null, "Style"), product("b", null, "Electronics"), product("c", null, "Electronics"),
      product("d", null, "Beauty"), product("e", null, "Style"), product("f", null, "Acme widgets"),
    ];
    const tabs = departmentTabs(shelf);
    expect(tabs.map(tab => tab.slug)).toEqual(["electronics", "style"]);
    expect(tabs[1].products.map(p => p.id)).toEqual(["a", "e"]);
    expect(tabs[0].label).toBe("category.electronics");
  });

  it("offers no row that could change nothing", () => {
    expect(departmentTabs(plain(6, 0, "Beauty"))).toEqual([]);
    expect(departmentTabs(plain(6))).toEqual([]);
    expect(departmentTabs([...plain(6, 0, "Beauty"), product("x")]).map(tab => tab.slug)).toEqual(["beauty"]);
  });
});
