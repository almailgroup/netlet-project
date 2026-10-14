import { describe, expect, it } from "vitest";
import { absoluteUrl, breadcrumbJsonLd, productJsonLd, productMeta, storeMeta, toPreviewText } from "./seo.js";
import type { Product } from "./commerce/types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  handle: "horizon-65-qled",
  title: 'Horizon 65" QLED Smart TV',
  description: "Display: 65\" QLED\nHDR: Dolby Vision\nSound: 40W",
  descriptionHtml: "",
  productType: "Electronics",
  vendor: "Horizon Vision",
  tags: ["Television"],
  attributes: [],
  images: [{ url: "https://cdn.example/a.jpg", altText: null }],
  priceRange: { min: money("289.00"), max: money("289.00") },
  options: [],
  variants: [
    { id: "v1", title: "Default", sku: "NL-001", price: money("289.00"), compareAtPrice: null, availableForSale: true, selectedOptions: [] },
  ],
  ...over,
});

describe("absoluteUrl", () => {
  it("joins without doubling or dropping the separator", () => {
    expect(absoluteUrl("https://netlet.com/", "/products/x")).toBe("https://netlet.com/products/x");
    expect(absoluteUrl("https://netlet.com", "products/x")).toBe("https://netlet.com/products/x");
    expect(absoluteUrl("https://netlet.com///", "///a")).toBe("https://netlet.com/a");
  });
});

describe("toPreviewText", () => {
  it("turns a newline spec block into one readable run", () => {
    expect(toPreviewText("Display: 65\"\nHDR: Dolby Vision")).toBe('Display: 65" · HDR: Dolby Vision');
  });

  it("cuts on a word boundary rather than mid-word", () => {
    const text = "A ".repeat(120);
    const preview = toPreviewText(text, 40);
    expect(preview.length).toBeLessThanOrEqual(40);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).not.toMatch(/\s…$/);
  });

  it("leaves short text alone", () => {
    expect(toPreviewText("A lamp.")).toBe("A lamp.");
  });
});

describe("productMeta", () => {
  it("puts the product name before the brand, since phones truncate the end", () => {
    const meta = productMeta(product(), "https://netlet.com");
    expect(meta.title).toBe('Horizon 65" QLED Smart TV — NetLet');
    expect(meta.canonical).toBe("https://netlet.com/products/horizon-65-qled");
    expect(meta.image).toBe("https://cdn.example/a.jpg");
  });

  it("falls back to a written sentence when there is no description", () => {
    const meta = productMeta(product({ description: "  " }), "https://netlet.com");
    expect(meta.description).toBe('Horizon 65" QLED Smart TV by Horizon Vision on NetLet.');
  });

  it("falls back to the share cover when the product has no image", () => {
    const meta = productMeta(product({ images: [] }), "https://netlet.com");
    expect(meta.image).toBe("https://netlet.com/brand/og-cover.png");
  });

  it("never offers a data: URL as the share image", () => {
    // WhatsApp and X fetch the card image from their own servers, so anything
    // that is not a public http(s) URL renders as no image at all.
    const inlineArt = product({ images: [{ url: "data:image/svg+xml,%3Csvg/%3E", altText: null }] });
    expect(productMeta(inlineArt, "https://netlet.com").image).toBe("https://netlet.com/brand/og-cover.png");
    const blob = product({ images: [{ url: "blob:https://netlet.com/abc", altText: null }] });
    expect(productMeta(blob, "https://netlet.com").image).toBe("https://netlet.com/brand/og-cover.png");
  });
});

describe("productJsonLd", () => {
  it("advertises the real price, currency and stock state", () => {
    const ld = productJsonLd(product(), "https://netlet.com") as any;
    expect(ld["@type"]).toBe("Product");
    expect(ld.offers.price).toBe("289.00");
    expect(ld.offers.priceCurrency).toBe("KWD");
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.sku).toBe("NL-001");
  });

  it("never advertises a sold-out product as in stock", () => {
    const soldOut = product({
      variants: [{ id: "v1", title: "Default", sku: null, price: money("289.00"), compareAtPrice: null, availableForSale: false, selectedOptions: [] }],
    });
    const ld = productJsonLd(soldOut, "https://netlet.com") as any;
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(ld.sku).toBeUndefined();
  });

  it("advertises the option that can be bought, not merely the first", () => {
    const firstSoldOut = product({
      variants: [
        { id: "v1", title: "Small", sku: "S", price: money("289.00"), compareAtPrice: null, availableForSale: false, selectedOptions: [] },
        { id: "v2", title: "Large", sku: "L", price: money("299.00"), compareAtPrice: null, availableForSale: true, selectedOptions: [] },
      ],
    });
    const ld = productJsonLd(firstSoldOut, "https://netlet.com") as any;
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.offers.price).toBe("299.00");
    expect(ld.sku).toBe("L");
  });

  it("includes a rating only when there is a review count behind it", () => {
    const rated = product({
      attributes: [
        { namespace: "reviews", key: "rating", label: "Rating", value: '{"scale_max":"5.0","value":"4.5"}' },
        { namespace: "reviews", key: "rating_count", label: "Count", value: "96" },
      ],
    });
    expect((productJsonLd(rated, "https://netlet.com") as any).aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      bestRating: 5,
      reviewCount: 96,
    });
    // A score with no count is not an aggregate, and Google rejects it as one.
    const scoreOnly = product({
      attributes: [{ namespace: "reviews", key: "rating", label: "Rating", value: "4.5" }],
    });
    expect((productJsonLd(scoreOnly, "https://netlet.com") as any).aggregateRating).toBeUndefined();
  });

  it("serialises to valid JSON, since it is embedded in a script tag", () => {
    expect(() => JSON.parse(JSON.stringify(productJsonLd(product(), "https://netlet.com")))).not.toThrow();
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from one and ends at the product", () => {
    const ld = breadcrumbJsonLd(product(), "https://netlet.com") as any;
    expect(ld.itemListElement.map((i: any) => [i.position, i.name])).toEqual([
      [1, "Home"],
      [2, "Electronics"],
      [3, 'Horizon 65" QLED Smart TV'],
    ]);
  });

  it("links the department step to the department's page", () => {
    const ld = breadcrumbJsonLd(product(), "https://netlet.com") as any;
    expect(ld.itemListElement[1].item).toBe("https://netlet.com/category/electronics");
  });

  it("skips the category step when the product has none", () => {
    const ld = breadcrumbJsonLd(product({ productType: null }), "https://netlet.com") as any;
    expect(ld.itemListElement).toHaveLength(2);
  });
});

describe("storeMeta", () => {
  const store = { slug: "dar-home", name: "Dar Home", description: null, logoUrl: null, products: 5 };

  it("names the store, links its page and says what it sells when it wrote nothing", () => {
    const meta = storeMeta(store, "https://netlet.example");
    expect(meta.title).toBe("Dar Home — NetLet");
    expect(meta.canonical).toBe("https://netlet.example/stores/dar-home");
    expect(meta.description).toContain("5 products");
    expect(meta.image).toBe("https://netlet.example/brand/og-cover.png");
  });

  it("uses the store's own words and a logo a preview card can fetch", () => {
    const meta = storeMeta({ ...store, description: "Linen and lamps\nmade in Kuwait.", logoUrl: "/media/abc.webp" }, "https://netlet.example");
    expect(meta.description).toBe("Linen and lamps · made in Kuwait.");
    expect(meta.image).toBe("https://netlet.example/media/abc.webp");
  });

  it("never uses an SVG logo as the share picture", () => {
    expect(storeMeta({ ...store, logoUrl: "https://cdn.example/logo.svg" }, "https://netlet.example").image).toBe("https://netlet.example/brand/og-cover.png");
  });
});
