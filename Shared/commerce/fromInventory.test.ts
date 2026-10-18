import { describe, expect, it } from "vitest";
import {
  CURRENCY,
  optionsFromVariants,
  toStorefrontCollection,
  toStorefrontProduct,
  type InventoryProductRow,
  type InventoryVariantRow,
} from "./fromInventory.js";

function variant(overrides: Partial<InventoryVariantRow> = {}): InventoryVariantRow {
  return {
    id: 1,
    sku: "SKU-1",
    title: "Default",
    price: "24.375",
    compareAtPrice: null,
    stock: 5,
    options: {},
    ...overrides,
  };
}

function product(overrides: Partial<InventoryProductRow> = {}): InventoryProductRow {
  return {
    id: 7,
    handle: "desk-lamp",
    title: "Desk Lamp",
    titleAr: null,
    description: "A lamp.",
    descriptionAr: null,
    tags: [],
    attributes: [],
    variants: [variant()],
    images: [],
    ...overrides,
  };
}

describe("toStorefrontProduct", () => {
  it("prices in dinar without rounding the third decimal away", () => {
    const shaped = toStorefrontProduct(product());
    expect(shaped.variants[0].price).toEqual({ amount: "24.375", currencyCode: CURRENCY });
    expect(shaped.priceRange.min.amount).toBe("24.375");
  });

  it("takes availability from stock, so a sold-out variant cannot be added", () => {
    const shaped = toStorefrontProduct(
      product({ variants: [variant({ id: 1, stock: 0 }), variant({ id: 2, stock: 3 })] }),
    );
    expect(shaped.variants.map(v => v.availableForSale)).toEqual([false, true]);
  });

  it("spans the price range across every variant", () => {
    const shaped = toStorefrontProduct(
      product({
        variants: [
          variant({ id: 1, price: "18.000" }),
          variant({ id: 2, price: "9.500" }),
          variant({ id: 3, price: "42.250" }),
        ],
      }),
    );
    expect(shaped.priceRange.min.amount).toBe("9.500");
    expect(shaped.priceRange.max.amount).toBe("42.250");
  });

  it("compares numerically, not as strings — 9 is cheaper than 18", () => {
    const shaped = toStorefrontProduct(
      product({ variants: [variant({ id: 1, price: "18.000" }), variant({ id: 2, price: "9.000" })] }),
    );
    // "18.000" < "9.000" lexically; the range must not believe that.
    expect(shaped.priceRange.min.amount).toBe("9.000");
  });

  it("carries a sale price through as compareAtPrice", () => {
    const shaped = toStorefrontProduct(
      product({ variants: [variant({ price: "20.000", compareAtPrice: "26.000" })] }),
    );
    expect(shaped.variants[0].compareAtPrice).toEqual({ amount: "26.000", currencyCode: CURRENCY });
  });

  it("prefers the Arabic title when the locale asks and the vendor supplied one", () => {
    const shaped = toStorefrontProduct(product({ titleAr: "مصباح مكتب" }), {}, "ar");
    expect(shaped.title).toBe("مصباح مكتب");
  });

  it("falls back to English when the Arabic column is empty rather than blanking the card", () => {
    const shaped = toStorefrontProduct(product({ titleAr: "   " }), {}, "ar");
    expect(shaped.title).toBe("Desk Lamp");
  });

  it("keeps English when the locale is English even if Arabic exists", () => {
    const shaped = toStorefrontProduct(product({ titleAr: "مصباح مكتب" }), {}, "en");
    expect(shaped.title).toBe("Desk Lamp");
  });

  it("maps the category onto productType, which is what browse filters on", () => {
    const shaped = toStorefrontProduct(product(), { categoryName: "Home & Kitchen", vendorName: "Alghanim" });
    expect(shaped.productType).toBe("Home & Kitchen");
    expect(shaped.vendor).toBe("Alghanim");
  });

  it("leaves productType null rather than empty when the product has no category", () => {
    expect(toStorefrontProduct(product()).productType).toBeNull();
  });

  it("escapes merchant text before putting it in descriptionHtml", () => {
    const shaped = toStorefrontProduct(product({ description: 'A <script>alert("x")</script> lamp.' }));
    expect(shaped.descriptionHtml).not.toContain("<script>");
    expect(shaped.descriptionHtml).toContain("&lt;script&gt;");
  });

  it("turns blank lines into paragraphs and single breaks into <br>", () => {
    const shaped = toStorefrontProduct(product({ description: "One\nstill one\n\nTwo" }));
    expect(shaped.descriptionHtml).toBe("<p>One<br>still one</p><p>Two</p>");
  });

  it("falls back to the title for alt text, so no image is announced as nothing", () => {
    const shaped = toStorefrontProduct(product({ images: [{ url: "u", altText: null }] }));
    expect(shaped.images[0].altText).toBe("Desk Lamp");
  });

  it("survives a product with no variants instead of throwing on priceRange", () => {
    const shaped = toStorefrontProduct(product({ variants: [] }));
    expect(shaped.variants).toEqual([]);
    expect(shaped.priceRange.min.amount).toBe("0");
  });
});

describe("optionsFromVariants", () => {
  it("derives the option dimensions from the variants that exist", () => {
    const options = optionsFromVariants([
      variant({ id: 1, options: { Size: "Small", Colour: "Navy" } }),
      variant({ id: 2, options: { Size: "Medium", Colour: "Navy" } }),
    ]);
    expect(options).toEqual([
      { name: "Size", values: ["Small", "Medium"] },
      { name: "Colour", values: ["Navy"] },
    ]);
  });

  it("keeps the vendor's order rather than sorting Large before Medium", () => {
    const options = optionsFromVariants([
      variant({ id: 1, options: { Size: "Small" } }),
      variant({ id: 2, options: { Size: "Medium" } }),
      variant({ id: 3, options: { Size: "Large" } }),
    ]);
    expect(options[0].values).toEqual(["Small", "Medium", "Large"]);
  });

  it("returns nothing for a product whose single variant has no options", () => {
    expect(optionsFromVariants([variant()])).toEqual([]);
  });
});

describe("toStorefrontCollection", () => {
  it("shapes a category as a collection, slug becoming the handle", () => {
    const collection = toStorefrontCollection({ id: 3, slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" });
    expect(collection).toMatchObject({ id: "3", handle: "electronics", title: "Electronics" });
  });

  it("takes the Arabic name when asked", () => {
    const collection = toStorefrontCollection(
      { id: 3, slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" },
      "ar",
    );
    expect(collection.title).toBe("إلكترونيات");
  });
});

/*
 * The rule the video feature rests on: `media` is the vendor's gallery and
 * `images` is the same list with the video taken out. Every card, rail,
 * thumbnail and saved tile reads `images`, so a card that renders a video
 * frame is impossible by construction rather than by everybody remembering.
 */
describe("product media", () => {
  const gallery = [
    { url: "https://cdn.test/front.jpg", altText: "Front" },
    { url: "https://cdn.test/demo.mp4", altText: "In use", kind: "video" as const, posterUrl: "https://cdn.test/poster.jpg" },
    { url: "https://cdn.test/back.jpg", altText: null },
  ];

  it("keeps the video in the gallery, in the vendor's order", () => {
    const mapped = toStorefrontProduct(product({ images: gallery }));
    expect(mapped.media.map(item => item.kind)).toEqual(["image", "video", "image"]);
    expect(mapped.media[1].posterUrl).toBe("https://cdn.test/poster.jpg");
  });

  it("never lets a video into images", () => {
    const mapped = toStorefrontProduct(product({ images: gallery }));
    expect(mapped.images).toHaveLength(2);
    expect(mapped.images.every(image => !image.url.endsWith(".mp4"))).toBe(true);
  });

  it("treats a row with no kind as a photograph, which is every row written before video", () => {
    const mapped = toStorefrontProduct(product({ images: [{ url: "https://cdn.test/a.jpg", altText: null }] }));
    expect(mapped.media[0].kind).toBe("image");
    expect(mapped.media[0].posterUrl).toBeNull();
    expect(mapped.images).toHaveLength(1);
  });

  it("falls back to the product title for a missing alt, on video as on images", () => {
    const mapped = toStorefrontProduct(product({
      images: [{ url: "https://cdn.test/demo.mp4", altText: null, kind: "video" as const, posterUrl: null }],
    }));
    expect(mapped.media[0].altText).toBe("Desk Lamp");
  });
});
