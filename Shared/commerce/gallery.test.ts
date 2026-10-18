import { describe, expect, it } from "vitest";
import { canUseGalleryKeyboard, galleryIndex, galleryOf } from "./gallery.js";

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

const photo = (url: string) => ({ url, altText: null });
const clip = (url: string) => ({ url, altText: null, kind: "video" as const, posterUrl: null });
const still = (url: string) => ({ url, altText: null, kind: "image" as const, posterUrl: null });

describe("what the gallery is", () => {
  it("is the vendor's own order, video included", () => {
    const product = { media: [still("a.jpg"), clip("b.mp4"), still("c.jpg")], images: [photo("a.jpg"), photo("c.jpg")] };
    expect(galleryOf(product).map(item => item.kind)).toEqual(["image", "video", "image"]);
  });

  /*
   * The whole reason this is a function. The page bounded its index by
   * `images.length` while both of its galleries rendered `media`, so a product
   * with a clip had one item the arrows could never reach — and with the clip
   * first, the counter and the picture named different things.
   */
  it("counts the video, which `images` does not", () => {
    const product = { media: [clip("v.mp4"), still("a.jpg"), still("b.jpg")], images: [photo("a.jpg"), photo("b.jpg")] };
    expect(galleryOf(product)).toHaveLength(3);
    expect(product.images).toHaveLength(2);
    // Stepping through the gallery reaches every item, the clip included.
    const seen = new Set<number>();
    let index = 0;
    for (let step = 0; step < galleryOf(product).length; step += 1) {
      seen.add(index);
      index = galleryIndex(index, galleryOf(product).length, "next");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("falls back to the photographs when there is no media list", () => {
    const product = { media: [], images: [photo("a.jpg"), photo("b.jpg")] };
    expect(galleryOf(product)).toEqual([still("a.jpg"), still("b.jpg")]);
  });

  it("is empty for a product with no pictures at all", () => {
    expect(galleryOf({ media: [], images: [] })).toEqual([]);
  });
});
