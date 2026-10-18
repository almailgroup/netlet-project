import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyFilters,
  browse,
  categoryFromSlug,
  categorySlug,
  EMPTY_FILTERS,
  facetsFor,
  filtersFromSearch,
  productsInCategory,
  searchFromFilters,
  sortProducts,
  type BrowseFilters,
} from "./browse.js";
import type { Product, ProductVariant } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function variant(price: string, options: { was?: string; sold?: boolean } = {}): ProductVariant {
  return {
    id: `v-${price}-${options.was ?? ""}`,
    title: "Default Title",
    sku: null,
    price: money(price),
    compareAtPrice: options.was ? money(options.was) : null,
    availableForSale: options.sold !== true,
    selectedOptions: [],
  };
}

function product(overrides: Partial<Product> & { id: string }): Product {
  const variants = overrides.variants ?? [variant("10")];
  return {
    handle: overrides.id,
    title: overrides.id,
    description: "",
    descriptionHtml: "",
    productType: null,
    vendor: null,
    tags: [],
    attributes: [],
    images: [],
    options: [],
    priceRange: { min: variants[0].price, max: variants[0].price },
    ...overrides,
    variants,
  };
}

const catalog: Product[] = [
  product({
    id: "lamp",
    productType: "Home & Kitchen",
    vendor: "Lumen",
    variants: [variant("24.5", { was: "31" })],
    priceRange: { min: money("24.5"), max: money("24.5") },
    options: [{ name: "Colour", values: ["Silver", "Black"] }],
    attributes: [{ namespace: "reviews", key: "rating", label: "Rating", value: "4.6" }],
    tags: ["netlet express"],
  }),
  product({
    id: "kettle",
    productType: "Home & Kitchen",
    vendor: "Brew",
    variants: [variant("12")],
    priceRange: { min: money("12"), max: money("12") },
    options: [{ name: "Colour", values: ["Black"] }],
  }),
  product({
    id: "tv",
    productType: "Electronics",
    vendor: "Horizon",
    variants: [variant("129.5", { was: "200", sold: true })],
    priceRange: { min: money("129.5"), max: money("129.5") },
    attributes: [{ namespace: "reviews", key: "rating", label: "Rating", value: "3.2" }],
  }),
];

describe("category slugs", () => {
  it("makes a merchant's category name readable in a URL", () => {
    expect(categorySlug("Home & Kitchen")).toBe("home-and-kitchen");
    expect(categorySlug("Health & Nutrition")).toBe("health-and-nutrition");
    expect(categorySlug("Laptops & Desktops")).toBe("laptops-and-desktops");
  });

  it("resolves a slug back through the catalog rather than by inverting it", () => {
    const categories = ["Home & Kitchen", "Electronics"];
    expect(categoryFromSlug("home-and-kitchen", categories)).toBe("Home & Kitchen");
    expect(categoryFromSlug("electronics", categories)).toBe("Electronics");
  });

  it("falls back to everything for a slug nothing matches", () => {
    // A dead category link should show the catalog, not an empty page.
    expect(categoryFromSlug("typo", ["Electronics"])).toBe("all");
    expect(categoryFromSlug("all", ["Electronics"])).toBe("all");
    expect(categorySlug("!!!")).toBe("all");
  });
});

describe("category membership", () => {
  it("matches on product type or tag, so a curated tag behaves like a department", () => {
    expect(productsInCategory(catalog, "Home & Kitchen").map(p => p.id)).toEqual(["lamp", "kettle"]);
    expect(productsInCategory(catalog, "netlet express").map(p => p.id)).toEqual(["lamp"]);
    expect(productsInCategory(catalog, "all")).toHaveLength(3);
  });
});

describe("facets", () => {
  it("counts over the products given, not the whole catalog", () => {
    const facets = facetsFor(productsInCategory(catalog, "Home & Kitchen"));
    /* The store is the seller; a brand comes only from the product's own Brand row. */
    expect(facets.brands).toEqual([]);
    expect(facets.sellers).toEqual([
      { value: "Brew", count: 1 },
      { value: "Lumen", count: 1 },
    ]);
    expect(facets.categories).toEqual([{ value: "Home & Kitchen", count: 2 }]);
  });

  it("drops an option facet with only one value, which could not change anything", () => {
    const facets = facetsFor([catalog[1]]);
    expect(facets.options).toEqual([]);
  });

  it("keeps an option facet that can actually narrow, most common first", () => {
    const facets = facetsFor(catalog);
    expect(facets.options).toEqual([
      { name: "Colour", values: [{ value: "Black", count: 2 }, { value: "Silver", count: 1 }] },
    ]);
  });

  it("reports price bounds as whole units so a control can step over them", () => {
    expect(facetsFor(catalog).priceBounds).toEqual({ min: 12, max: 130 });
  });

  it("counts ratings cumulatively, since '4 and up' includes 5", () => {
    const facets = facetsFor(catalog);
    expect(facets.ratings).toEqual([
      { value: "4", count: 1 },
      { value: "3", count: 2 },
      { value: "2", count: 2 },
      { value: "1", count: 2 },
    ]);
  });

  it("drops a rating row that matches everything, which could not narrow", () => {
    // Both products are rated 4+, so every threshold would read the same and
    // ticking any of them would change nothing.
    const allHighlyRated = [catalog[0], { ...catalog[0], id: "lamp-2" }];
    expect(facetsFor(allHighlyRated).ratings).toEqual([]);
  });

  it("counts the three toggles", () => {
    const facets = facetsFor(catalog);
    expect({ inStock: facets.inStock, onOffer: facets.onOffer, express: facets.express })
      .toEqual({ inStock: 2, onOffer: 2, express: 1 });
  });
});

describe("filtering", () => {
  const withFilters = (patch: Partial<BrowseFilters>) => ({ ...EMPTY_FILTERS, ...patch });

  it("ORs values inside a facet and ANDs across facets", () => {
    // Either brand, but only the one that is in stock.
    const filters = withFilters({ sellers: ["Lumen", "Horizon"], inStock: true });
    expect(applyFilters(catalog, filters).map(p => p.id)).toEqual(["lamp"]);
  });

  it("filters on a merchant-configured option", () => {
    const filters = withFilters({ options: { Colour: ["Silver"] } });
    expect(applyFilters(catalog, filters).map(p => p.id)).toEqual(["lamp"]);
  });

  it("ignores an option entry with nothing selected", () => {
    expect(applyFilters(catalog, withFilters({ options: { Colour: [] } }))).toHaveLength(3);
  });

  it("bounds price inclusively at both ends", () => {
    expect(applyFilters(catalog, withFilters({ minPrice: 12, maxPrice: 24.5 })).map(p => p.id))
      .toEqual(["lamp", "kettle"]);
  });

  it("treats a rating threshold as 'and up', normalised to five", () => {
    expect(applyFilters(catalog, withFilters({ minRating: 4 })).map(p => p.id)).toEqual(["lamp"]);
    expect(applyFilters(catalog, withFilters({ minRating: 3 })).map(p => p.id)).toEqual(["lamp", "tv"]);
  });

  it("filters on offers and on express separately", () => {
    expect(applyFilters(catalog, withFilters({ onOffer: true })).map(p => p.id)).toEqual(["lamp", "tv"]);
    expect(applyFilters(catalog, withFilters({ express: true })).map(p => p.id)).toEqual(["lamp"]);
  });
});

describe("sorting", () => {
  it("leaves the merchant's own order alone for relevance", () => {
    expect(sortProducts(catalog, "relevance").map(p => p.id)).toEqual(["lamp", "kettle", "tv"]);
  });

  it("orders by price both ways", () => {
    expect(sortProducts(catalog, "price-low").map(p => p.id)).toEqual(["kettle", "lamp", "tv"]);
    expect(sortProducts(catalog, "price-high").map(p => p.id)).toEqual(["tv", "lamp", "kettle"]);
  });

  it("puts the deepest discount first, not merely the cheapest", () => {
    // The TV is 35% off and the lamp ~21%, though the lamp is far cheaper.
    expect(sortProducts(catalog, "discount").map(p => p.id)).toEqual(["tv", "lamp", "kettle"]);
  });

  it("orders by rating, falling back to price so the result is stable", () => {
    expect(sortProducts(catalog, "rating").map(p => p.id)).toEqual(["lamp", "tv", "kettle"]);
  });

  it("does not mutate the array it was given", () => {
    const original = catalog.map(p => p.id);
    sortProducts(catalog, "price-high");
    expect(catalog.map(p => p.id)).toEqual(original);
  });
});

describe("the whole pipeline", () => {
  it("narrows by category, then by filter, then orders", () => {
    const filters: BrowseFilters = { ...EMPTY_FILTERS, category: "Home & Kitchen", sort: "price-low" };
    expect(browse(catalog, filters).map(p => p.id)).toEqual(["kettle", "lamp"]);
  });
});

describe("filters in the URL", () => {
  it("leaves an untouched page with a clean query string", () => {
    expect(searchFromFilters(EMPTY_FILTERS)).toBe("");
  });

  it("round-trips every filter", () => {
    const filters: BrowseFilters = {
      category: "Electronics",
      brands: ["Samsung"],
      sellers: ["Lumen", "Brew"],
      speeds: ["same_day", "next_day"],
      options: { Colour: ["Silver", "Black"], "Ram Size": ["16 GB"] },
      minPrice: 10,
      maxPrice: 250,
      minRating: 4,
      inStock: true,
      onOffer: true,
      express: true,
      sort: "price-high",
    };
    const restored = filtersFromSearch(searchFromFilters(filters), "Electronics");
    expect(restored).toEqual(filters);
  });

  it("namespaces options so a merchant option cannot collide with a reserved key", () => {
    const filters: BrowseFilters = { ...EMPTY_FILTERS, options: { sort: ["A"], brand: ["B"] } };
    const restored = filtersFromSearch(searchFromFilters(filters));
    expect(restored.options).toEqual({ sort: ["A"], brand: ["B"] });
    expect(restored.sort).toBe("relevance");
    expect(restored.brands).toEqual([]);
  });

  it("ignores values a hand-edited URL got wrong rather than rendering nothing", () => {
    const restored = filtersFromSearch("?sort=sideways&min=abc&max=-5&rating=");
    expect(restored.sort).toBe("relevance");
    expect(restored.minPrice).toBeNull();
    expect(restored.maxPrice).toBeNull();
    expect(restored.minRating).toBeNull();
  });
});

describe("activeFilterCount", () => {
  it("is zero for an untouched page and counts each selected value", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({
      ...EMPTY_FILTERS,
      brands: ["A", "B"],
      options: { Colour: ["Red"] },
      minPrice: 5,
      inStock: true,
    })).toBe(5);
  });

  // Sort is an ordering, not a narrowing: counting it would put a badge on a
  // page showing everything.
  it("does not count sort", () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, sort: "price-low" })).toBe(0);
  });
});

/* Requirement 3.4.20: a seller who is actually discounting comes first among
   equals — and only where the shopper has not asked for an order of their own. */
describe("discount placement", () => {
  const discounted = (id: string, price: string, was?: string) =>
    product({ id, variants: [variant(price, was ? { was } : {})] });

  it("lifts a discounting seller on the default view", () => {
    const page = browse([discounted("plain", "100.000"), discounted("cut", "60.000", "100.000")], EMPTY_FILTERS);
    expect(page.map(p => p.id)).toEqual(["cut", "plain"]);
  });

  /*
   * A "price low to high" that quietly puts discounters first is not price low
   * to high. The shopper's own choice wins outright.
   */
  it("does not touch an order the shopper asked for", () => {
    const page = browse(
      [discounted("cheap", "10.000"), discounted("cut", "60.000", "100.000")],
      { ...EMPTY_FILTERS, sort: "price-low" },
    );
    expect(page.map(p => p.id)).toEqual(["cheap", "cut"]);
  });
});

describe("brand, seller and delivery speed", () => {
  const branded = (id: string, brand: string, vendor: string, speed: Product["deliverySpeed"]) =>
    product({ id, vendor, deliverySpeed: speed, attributes: [{ namespace: "specs", key: "brand", label: "Brand", value: brand }] });
  const shelf = [
    branded("s26", "Samsung", "Phone store Hawally", "next_day"),
    branded("a56", "Samsung", "Gadget House", "two_to_four"),
    branded("pixel", "Google", "Gadget House", "same_day"),
  ];

  it("are three facets, not one", () => {
    const facets = facetsFor(shelf);
    expect(facets.brands).toEqual([{ value: "Samsung", count: 2 }, { value: "Google", count: 1 }]);
    expect(facets.sellers).toEqual([{ value: "Gadget House", count: 2 }, { value: "Phone store Hawally", count: 1 }]);
    /* Fastest first, whatever the counts. */
    expect(facets.speeds.map(entry => entry.value)).toEqual(["same_day", "next_day", "two_to_four"]);
  });

  it("each narrows by its own field", () => {
    expect(applyFilters(shelf, { ...EMPTY_FILTERS, brands: ["Samsung"] }).map(p => p.id)).toEqual(["s26", "a56"]);
    expect(applyFilters(shelf, { ...EMPTY_FILTERS, sellers: ["Gadget House"] }).map(p => p.id)).toEqual(["a56", "pixel"]);
    expect(applyFilters(shelf, { ...EMPTY_FILTERS, speeds: ["same_day", "next_day"] }).map(p => p.id)).toEqual(["s26", "pixel"]);
  });

  it("drops a speed a hand-edited URL invented", () => {
    expect(filtersFromSearch("?speed=same_day,teleport").speeds).toEqual(["same_day"]);
  });
});
