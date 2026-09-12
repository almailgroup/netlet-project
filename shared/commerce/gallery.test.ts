import { describe, expect, it } from "vitest";
import { canUseGalleryKeyboard, galleryIndex } from "./gallery.js";

describe("product gallery navigation", () => {
  it("wraps previous and next navigation across gallery images", () => {
    expect(galleryIndex(0, 3, "previous")).toBe(2);
    expect(galleryIndex(2, 3, "next")).toBe(0);
    expect(galleryIndex(0, 1, "next")).toBe(0);
  });

  it("does not capture arrow keys while a form control has focus", () => {
    expect(canUseGalleryKeyboard(null)).toBe(true);
    const inputLikeTarget = { closest: () => ({}) } as unknown as EventTarget;
    expect(canUseGalleryKeyboard(inputLikeTarget)).toBe(false);
  });
});
