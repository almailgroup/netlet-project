/**
 * Moving through a product's gallery, and what "the gallery" is.
 *
 * `galleryOf` matters more than it looks. A product carries two lists: `media`
 * is what the product page shows, video included, and `images` is the same list
 * with the video removed for every card and rail. The page's own index was
 * bounded by `images.length` while both of its galleries rendered `media`, so
 * the moment a vendor added a clip the arrows and the next button wrapped one
 * short of it — the video was reachable only by clicking its thumbnail — and
 * with the clip first in the order, the "3 / 5" counter and the picture on
 * screen stopped agreeing about which item this was.
 *
 * That is the failure `Shared/commerce/types.ts` already warns about in prose:
 * "the moment a video is in the set, image 4 would otherwise mean two different
 * things on the two surfaces". It happened anyway, because the derivation was
 * written out at each surface and the count was taken somewhere else. One
 * function, so the page cannot disagree with itself about how long its own
 * gallery is.
 */
import type { Image, ProductMedia } from "./types.js";

/**
 * A product's gallery, in the order the vendor arranged it.
 *
 * Falls back to the photographs when `media` is empty, which is what an older
 * row and the demo fixtures both look like: a gallery of photographs is a
 * gallery, and refusing to draw one over a missing column would be refusing the
 * product.
 */
export function galleryOf(product: { media: ProductMedia[]; images: Image[] }): ProductMedia[] {
  return product.media.length
    ? product.media
    : product.images.map(image => ({ ...image, kind: "image" as const, posterUrl: null }));
}

export function galleryIndex(current: number, imageCount: number, direction: "previous" | "next") {
  if (imageCount <= 1) return 0;
  return direction === "next" ? (current + 1) % imageCount : (current - 1 + imageCount) % imageCount;
}

export function canUseGalleryKeyboard(target: EventTarget | null) {
  const maybeElement = target as { closest?: (selector: string) => unknown } | null;
  if (!maybeElement || typeof maybeElement.closest !== "function") return true;
  return !maybeElement.closest("input, textarea, select, button, [contenteditable='true']");
}
