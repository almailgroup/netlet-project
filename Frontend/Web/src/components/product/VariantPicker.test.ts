import { describe, expect, it } from "vitest";
import { choiceMode, imageIndexForVariant } from "./VariantPicker";
import type { Product, ProductVariant } from "@shared/commerce/types";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function variant(id: string, options: [string, string][]): ProductVariant {
  return {
    id, title: id, sku: null,
    price: money("10"), compareAtPrice: null, availableForSale: true,
    selectedOptions: options.map(([name, value]) => ({ name, value })),
  };
}

function product(images: (string | null)[], variants: ProductVariant[]): Product {
  return {
    id: "p", handle: "p", title: "Lamp", description: "", descriptionHtml: "",
    productType: null, vendor: null, tags: [], attributes: [],
    images: images.map((altText, i) => ({ url: `img-${i}.jpg`, altText })),
    priceRange: { min: money("10"), max: money("10") },
    options: [], variants,
  };
}

describe("imageIndexForVariant", () => {
  it("finds the photo whose alt text names the variant", () => {
    const charcoal = variant("v2", [["Colour", "Charcoal"]]);
    const p = product(["Aurora Desk Lamp – Silver", "Aurora Desk Lamp – Charcoal"], [charcoal]);
    expect(imageIndexForVariant(p, charcoal)).toBe(1);
  });

  it("matches case-insensitively, since merchants write alt text by hand", () => {
    const v = variant("v1", [["Colour", "CHARCOAL"]]);
    expect(imageIndexForVariant(product(["lamp in charcoal"], [v]), v)).toBe(0);
  });

  it("matches on any of the variant's options, not only the first", () => {
    const v = variant("v1", [["Size", "Large"], ["Colour", "Oak"]]);
    expect(imageIndexForVariant(product(["Shelf, oak finish"], [v]), v)).toBe(0);
  });

  // Jumping to an unrelated photo is worse than leaving the gallery alone: the
  // shopper reads the change as "this is the one you picked".
  it("answers null rather than guessing when no alt text matches", () => {
    const v = variant("v1", [["Colour", "Charcoal"]]);
    expect(imageIndexForVariant(product(["Aurora Desk Lamp"], [v]), v)).toBeNull();
  });

  it("answers null when the images carry no alt text at all", () => {
    const v = variant("v1", [["Colour", "Charcoal"]]);
    expect(imageIndexForVariant(product([null, null], [v]), v)).toBeNull();
  });

  it("matches whole words, so a size of S is not every photo with an s in it", () => {
    const small = variant("v1", [["Size", "S"]]);
    expect(imageIndexForVariant(product(["Linen shirt, sand"], [small]), small)).toBeNull();
    const red = variant("v2", [["Colour", "Red"]]);
    expect(imageIndexForVariant(product(["Redwood finish", "In red"], [red]), red)).toBe(1);
  });

  it("looks for the colour when there is one, never the size beside it", () => {
    const v = variant("v1", [["Size", "M"], ["Colour", "Navy"]]);
    expect(imageIndexForVariant(product(["Shirt M size chart", "Shirt in navy"], [v]), v)).toBe(1);
  });

  it("finds an Arabic colour behind the article", () => {
    const v = variant("v1", [["اللون", "أسود"]]);
    expect(imageIndexForVariant(product(["ساعة ذكية", "ساعة ذكية باللون الأسود"], [v]), v)).toBe(1);
  });

  it("answers null for a product with no real options", () => {
    const v = variant("v1", []);
    expect(imageIndexForVariant(product(["anything"], [v]), v)).toBeNull();
    expect(imageIndexForVariant(product(["anything"], []), undefined)).toBeNull();
  });
});

describe("choiceMode", () => {
  const titled = (id: string, title: string, options: [string, string][] = []): ProductVariant => ({ ...variant(id, options), title });
  const withOptions = (p: Product, options: Product["options"]): Product => ({ ...p, options });

  it("chooses by name when the variants carry no option values", () => {
    expect(choiceMode(product([], [titled("a", "Green"), titled("b", "Blue")]))).toBe("titles");
  });

  it("chooses by name when the options cannot tell two variants apart, or miss one", () => {
    const half = withOptions(product([], [titled("a", "S", [["Size", "S"]]), titled("b", "M"), titled("c", "L", [["Size", "L"]])]), [{ name: "Size", values: ["S", "L"] }]);
    expect(choiceMode(half)).toBe("titles");
  });

  it("uses the option rows when they cover every variant once", () => {
    const full = withOptions(product([], [titled("a", "S", [["Size", "S"]]), titled("b", "L", [["Size", "L"]])]), [{ name: "Size", values: ["S", "L"] }]);
    expect(choiceMode(full)).toBe("options");
  });

  it("names a lone variant, and draws nothing for a lone Default", () => {
    expect(choiceMode(product([], [titled("a", "Green")]))).toBe("single");
    expect(choiceMode(product([], [titled("a", "Default")]))).toBe("none");
  });

  it("matches a named variant's photo by its name", () => {
    const green = titled("a", "Green");
    expect(imageIndexForVariant(product(["Lamp in blue", "Lamp in green"], [green]), green)).toBe(1);
  });
});
