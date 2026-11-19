import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { CardGallery } from "./CardGallery";

function draw(images: { url: string; altText: string | null }[]) {
  const gallery = createElement(CardGallery, {
    images, href: "/products/lamp", title: "Brass lamp",
    frameClassName: "bg-white", photoClassName: "aspect-square bg-white object-contain",
  });
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/" }, gallery));
}

describe("CardGallery", () => {
  /* A product with no photo yet said "Image processing" on its card: a
     status report, and nothing was processing. It is a bag on the card's
     white now, as the bag's own lines draw one. */
  it("draws a bag, not a sentence, for a product with no photo", () => {
    const html = draw([]);
    expect(html).toContain("lucide-shopping-bag");
    expect(html).not.toMatch(/processing|تجهيز/i);
    expect(html).not.toContain("<img");
  });

  it("draws the first photo, named, when there is one", () => {
    const html = draw([{ url: "/media/lamp.webp", altText: null }]);
    expect(html).toContain('src="/media/lamp.webp"');
    expect(html).toContain('alt="Brass lamp"');
  });
});
