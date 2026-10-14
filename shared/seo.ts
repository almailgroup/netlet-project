/**
 * Page metadata and structured data.
 *
 * Pure functions, so what a shopper sees when they paste a NetLet link into
 * WhatsApp is testable rather than something you discover after sharing it.
 * The client applies the result to the document; nothing here touches the DOM.
 */
import { isExpressEligible, productRating } from "./commerce/productDetail.js";
import type { Product } from "./commerce/types.js";
import { categorySlug } from "./commerce/browse.js";

export type PageMeta = {
  title: string;
  description: string;
  /** Absolute URL of this page. Omitted when the page should not be indexed. */
  canonical?: string;
  /** Absolute URL of the share image. */
  image?: string;
  type: "website" | "product";
  /** True for pages that must never appear in search results. */
  noindex?: boolean;
};

const SITE_NAME = "NetLet";
const DEFAULT_DESCRIPTION =
  "NetLet is a Kuwait marketplace for home, technology and everyday things — with delivery across all six governorates.";

/** Trailing slashes doubled up produce URLs that read as broken. */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Collapses a description to something a preview card can show.
 *
 * Product descriptions here carry newline-separated spec blocks, which render
 * as one unbroken run in a share card; the newlines become separators, and the
 * result is cut on a word boundary rather than mid-word.
 */
export function toPreviewText(text: string, limit = 160): string {
  const flat = text.replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function homeMeta(siteUrl: string): PageMeta {
  return {
    title: "NetLet — a Kuwait marketplace for the everyday",
    description: DEFAULT_DESCRIPTION,
    canonical: absoluteUrl(siteUrl, "/"),
    image: absoluteUrl(siteUrl, "/brand/og-cover.png"),
    type: "website",
  };
}

/**
 * A share card image has to be fetchable by a third party — WhatsApp, X and
 * Facebook all request it from their own servers. A data: or blob: URL, which
 * is what a locally generated placeholder produces, renders as no image at all.
 */
function shareableImage(url: string | undefined, siteUrl: string): string {
  /* WhatsApp, Instagram and most preview cards draw no SVG, and an SVG here is
     the placeholder art a product without a photo carries. */
  if (url && /\.svg(?:[?#]|$)/i.test(url)) return absoluteUrl(siteUrl, "/brand/og-cover.png");
  if (url && /^https?:\/\//i.test(url)) return url;
  /* A photo uploaded to NetLet is served from its own origin as `/media/…`;
     a preview needs the whole address. */
  if (url && url.startsWith("/media/")) return absoluteUrl(siteUrl, url);
  return absoluteUrl(siteUrl, "/brand/og-cover.png");
}

/** A department's page, by NetLet's own name for it. */
export function departmentMeta(name: string, slug: string, siteUrl: string): PageMeta {
  return {
    title: `${name} — ${SITE_NAME}`,
    description: `Shop ${name.toLowerCase()} in Kuwait on NetLet, with delivery across all six governorates and cash on delivery.`,
    canonical: absoluteUrl(siteUrl, `/category/${encodeURIComponent(slug)}`),
    image: absoluteUrl(siteUrl, "/brand/og-cover.png"),
    type: "website",
  };
}

/**
 * A store's public page. The store's own description when it wrote one, a
 * plain sentence otherwise; its logo as the share picture when the logo is one
 * a preview card can fetch.
 */
export function storeMeta(
  store: { slug: string; name: string; description: string | null; logoUrl: string | null; products: number },
  siteUrl: string,
): PageMeta {
  const description = store.description?.trim()
    ? toPreviewText(store.description)
    : `Shop ${store.name} on NetLet: ${store.products === 1 ? "1 product" : `${store.products} products`}, with delivery across Kuwait and cash on delivery.`;
  return {
    title: `${store.name} — ${SITE_NAME}`,
    description,
    canonical: absoluteUrl(siteUrl, `/stores/${encodeURIComponent(store.slug)}`),
    image: shareableImage(store.logoUrl ?? undefined, siteUrl),
    type: "website",
  };
}

/** Every department on NetLet, the page the phone's Categories tab opens. */
export function categoriesMeta(siteUrl: string): PageMeta {
  return {
    title: `Categories — ${SITE_NAME}`,
    description: "Every department on NetLet, Kuwait's marketplace — electronics, home and kitchen, beauty, style and grocery, delivered across all six governorates.",
    canonical: absoluteUrl(siteUrl, "/categories"),
    image: absoluteUrl(siteUrl, "/brand/og-cover.png"),
    type: "website",
  };
}

/** Every store on NetLet. */
export function storesMeta(siteUrl: string): PageMeta {
  return {
    title: `Stores — ${SITE_NAME}`,
    description: "Every store selling on NetLet, Kuwait's marketplace — each with its own shelf, delivery terms and reviews.",
    canonical: absoluteUrl(siteUrl, "/stores"),
    image: absoluteUrl(siteUrl, "/brand/og-cover.png"),
    type: "website",
  };
}

export function productMeta(product: Product, siteUrl: string): PageMeta {
  const description = product.description.trim()
    ? toPreviewText(product.description)
    : `${product.title}${product.vendor ? ` by ${product.vendor}` : ""} on NetLet.`;
  return {
    // The brand goes last: a phone truncates the end of a title, and the
    // product name is the half that tells a shopper what they are looking at.
    title: `${product.title} — ${SITE_NAME}`,
    description,
    canonical: absoluteUrl(siteUrl, `/products/${encodeURIComponent(product.handle)}`),
    image: shareableImage(product.images[0]?.url, siteUrl),
    type: "product",
  };
}

/** Cart, checkout and account pages: private, and useless as search results. */
export function privatePageMeta(title: string): PageMeta {
  return { title: `${title} — ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, type: "website", noindex: true };
}

/**
 * schema.org Product JSON-LD.
 *
 * This is what turns a search result into one carrying a price, a stock state
 * and a star rating. Availability and price come from the selected variant, so
 * a sold-out product does not advertise itself as in stock.
 */
export function productJsonLd(product: Product, siteUrl: string): Record<string, unknown> {
  /* The option a shopper can actually buy, when there is one. The first
     variant alone made a product whose first size had sold out tell search
     engines the whole product was out of stock. */
  const variant = product.variants.find(entry => entry.availableForSale) ?? product.variants[0];
  const price = variant?.price ?? product.priceRange.min;
  const rating = productRating(product.attributes);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: toPreviewText(product.description, 5000),
    image: product.images.map((image) => image.url),
    ...(product.vendor ? { brand: { "@type": "Brand", name: product.vendor } } : {}),
    ...(variant?.sku ? { sku: variant.sku } : {}),
    ...(product.productType ? { category: product.productType } : {}),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(siteUrl, `/products/${encodeURIComponent(product.handle)}`),
      priceCurrency: price.currencyCode,
      price: price.amount,
      availability: variant?.availableForSale
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      ...(isExpressEligible(product) ? { deliveryLeadTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" } } : {}),
    },
    ...(rating && rating.count
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: rating.value,
            bestRating: rating.scaleMax,
            reviewCount: rating.count,
          },
        }
      : {}),
  };
}

/** Breadcrumb trail, so search results show Home › Category › Product. */
export function breadcrumbJsonLd(product: Product, siteUrl: string): Record<string, unknown> {
  const trail = [
    { name: "Home", url: absoluteUrl(siteUrl, "/") },
    /* The department's own page, which is what the step names; it pointed
       at the home page, so the middle of the trail led nowhere it said. */
    ...(product.productType ? [{ name: product.productType, url: absoluteUrl(siteUrl, `/category/${categorySlug(product.productType)}`) }] : []),
    { name: product.title, url: absoluteUrl(siteUrl, `/products/${encodeURIComponent(product.handle)}`) },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
