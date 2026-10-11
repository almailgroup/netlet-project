import { describe, expect, it } from "vitest";
import { draftProblems, handleBase, photoUrlProblem, type ProductDraft } from "./productDraft.js";

const draft = (patch: Partial<ProductDraft> = {}): ProductDraft => ({
  title: "Walnut tray", titleAr: "", price: "9.750", compareAtPrice: "", sku: "", stock: "", description: "", ...patch,
});

describe("the add-a-product form's rules", () => {
  it("passes a named, priced product and nothing else is required", () => {
    expect(draftProblems(draft())).toEqual({});
  });

  it("asks for a name and a price, and says which", () => {
    expect(draftProblems(draft({ title: "  ", price: "" }))).toEqual({ title: "admin.newTitleRequired", price: "admin.newPriceRequired" });
  });

  it("holds the price to the router's shape: three decimals, no sign, more than zero", () => {
    expect(draftProblems(draft({ price: "9.7505" })).price).toBe("admin.newPriceShape");
    expect(draftProblems(draft({ price: "-1" })).price).toBe("admin.newPriceShape");
    expect(draftProblems(draft({ price: "1,5" })).price).toBe("admin.newPriceShape");
    /* Buyable for nothing the moment it is live — which publishing refuses. */
    expect(draftProblems(draft({ price: "0.000" })).price).toBe("admin.newPricePositive");
  });

  it("refuses a was-price that is not a saving, but not a blank one", () => {
    expect(draftProblems(draft({ compareAtPrice: "9.750" })).compareAtPrice).toBe("admin.newWasHigher");
    expect(draftProblems(draft({ compareAtPrice: "5" })).compareAtPrice).toBe("admin.newWasHigher");
    expect(draftProblems(draft({ compareAtPrice: "12.000" })).compareAtPrice).toBeUndefined();
    expect(draftProblems(draft({ compareAtPrice: "" })).compareAtPrice).toBeUndefined();
  });

  it("takes a whole number of items for stock, or nothing", () => {
    expect(draftProblems(draft({ stock: "2.5" })).stock).toBe("admin.newStockShape");
    expect(draftProblems(draft({ stock: "1000001" })).stock).toBe("admin.newStockShape");
    expect(draftProblems(draft({ stock: "12" })).stock).toBeUndefined();
  });

  it("accepts a pasted photo only where the gallery would", () => {
    expect(photoUrlProblem("https://example.test/a.jpg")).toBeNull();
    expect(photoUrlProblem("/media/abcdefghijklmnop.webp")).toBeNull();
    expect(photoUrlProblem("javascript:alert(1)")).toBe("admin.newPhotoUrl");
    expect(photoUrlProblem("ftp://example.test/a.jpg")).toBe("admin.newPhotoUrl");
  });

  it("previews the address the server makes", () => {
    expect(handleBase("Brass Lamp — 40 cm!")).toBe("brass-lamp-40-cm");
    /* An Arabic name has no ASCII to make an address from. */
    expect(handleBase("مصباح نحاسي")).toBe("product");
  });
});
