/**
 * Inventory rows → the storefront's `Product` contract.
 *
 * This is the seam that used to be the Shopify adapter. Everything the
 * storefront renders goes through here, so the pages never learn what the
 * tables look like — swapping the store out again would mean rewriting this
 * file and nothing else.
 *
 * It is pure on purpose: no database handle, no `getDb`, nothing async. The
 * caller does the reading, this does the shaping, and the tests can therefore
 * cover the shaping without a Postgres anywhere near them.
 */

import type {
  Collection,
  Money,
  Product,
  ProductAttribute,
  ProductOption,
  ProductVariant,
} from "./types.js";
import { visibleBadges } from "../inventory/vendorHealth.js";
import type { Measure } from "./units.js";

/**
 * The dinar, everywhere.
 *
 * NetLet prices in one currency, so this is a constant rather than a column.
 * When a second currency arrives it belongs on the vendor or the product, and
 * this constant becomes the fallback — but inventing that column now would be
 * three unused joins for a case that does not exist.
 */
export const CURRENCY = "KWD";

/**
 * The title of the variant a product gets when it has no real options.
 *
 * Every product needs at least one variant to carry a price, so a product
 * with nothing to choose still has one — and its title is a placeholder, not
 * a label. Anywhere a variant title is shown to a shopper has to skip it, or
 * every simple product reads "Desk Lamp — Default".
 *
 * Matches `productVariants.title`'s default in the schema. One constant so
 * the two cannot drift.
 */
export const DEFAULT_VARIANT_TITLE = "Default";

/** True when a variant title is the placeholder rather than a real label. */
export function isDefaultVariantTitle(title: string): boolean {
  return title.trim() === DEFAULT_VARIANT_TITLE;
}

export type LocalePick = "en" | "ar";

/** Rows as the tables give them, narrowed to what the shaping actually reads. */
export type InventoryVariantRow = {
  id: number;
  sku: string | null;
  title: string;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  options: Record<string, string>;
  /* Optional so a caller that predates the grocery shelf still type-checks. */
  unit?: string | null;
  stepAmount?: string | number | null;
};

export type InventoryImageRow = {
  url: string;
  altText: string | null;
};

export type InventoryProductRow = {
  id: number;
  handle: string;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  tags: string[];
  attributes: ProductAttribute[] | null;
  variants: InventoryVariantRow[];
  images: InventoryImageRow[];
};

export type ProductContext = {
  /** Display name of the vendor that owns the product. */
  vendorName?: string | null;
  vendorNameAr?: string | null;
  /** Awarded badges, unfiltered — `visibleBadges` drops anything unknown. */
  vendorBadges?: string[] | null;
  /** Display name of its category — what the storefront calls productType. */
  categoryName?: string | null;
  categoryNameAr?: string | null;
};

/**
 * Prefer the Arabic column, fall back to English.
 *
 * A vendor may not have translated every product, and an empty Arabic title
 * must not blank the card — an English title inside an Arabic page is a
 * merchant's omission, a blank one is our bug.
 */
function pick(locale: LocalePick, en: string | null | undefined, ar: string | null | undefined): string {
  if (locale === "ar") {
    const trimmed = ar?.trim();
    if (trimmed) return trimmed;
  }
  return en?.trim() ?? "";
}

function money(amount: string): Money {
  return { amount, currencyCode: CURRENCY };
}

/** Escape before interpolating: a merchant's `<` is text, not markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Plain description → the HTML the contract promises.
 *
 * Vendors type into a textarea, so blank lines are the only structure there
 * is; each block becomes a paragraph and everything in it is escaped.
 */
function toHtml(description: string): string {
  const blocks = description
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
  return blocks.map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * Option dimensions, derived from the variants that exist.
 *
 * Nothing is declared up front: if two variants differ by "Colour" then
 * Colour is an option, and the picker gets exactly the values that can
 * actually be bought. First-seen order is kept, because a vendor entering
 * Small / Medium / Large means that order and sorting it would give
 * Large / Medium / Small.
 */
export function optionsFromVariants(variants: InventoryVariantRow[]): ProductOption[] {
  const seen = new Map<string, string[]>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(variant.options ?? {})) {
      if (!name || !value) continue;
      const values = seen.get(name);
      if (!values) seen.set(name, [value]);
      else if (!values.includes(value)) values.push(value);
    }
  }
  return [...seen].map(([name, values]) => ({ name, values }));
}

function toVariant(row: InventoryVariantRow): ProductVariant {
  return {
    id: String(row.id),
    title: row.title,
    sku: row.sku,
    price: money(row.price),
    compareAtPrice: row.compareAtPrice ? money(row.compareAtPrice) : null,
    // Stock is the whole of availability here. There is no "continue selling
    // when out of stock" flag, because overselling a marketplace's vendors is
    // a support ticket rather than a sale.
    availableForSale: row.stock > 0,
    // Defaults to `each` for every product that predates the grocery shelf.
    measure: {
      unit: (row.unit ?? "each") as Measure["unit"],
      stepAmount: Number(row.stepAmount ?? 1),
    },
    selectedOptions: Object.entries(row.options ?? {}).map(([name, value]) => ({ name, value })),
  };
}

/**
 * The price range shown as "from X".
 *
 * Computed over every variant rather than only the buyable ones: a card that
 * says "from 12.000" and then offers nothing at that price because the cheap
 * size sold out is a bait, but so is silently jumping the headline price the
 * moment one variant runs low. Showing the true range and marking the sold
 * out variant in the picker is the honest pair.
 */
function priceRange(variants: ProductVariant[]): { min: Money; max: Money } {
  if (!variants.length) return { min: money("0"), max: money("0") };
  let min = variants[0].price;
  let max = variants[0].price;
  for (const variant of variants) {
    if (Number.parseFloat(variant.price.amount) < Number.parseFloat(min.amount)) min = variant.price;
    if (Number.parseFloat(variant.price.amount) > Number.parseFloat(max.amount)) max = variant.price;
  }
  return { min, max };
}

/** One inventory product, shaped for the storefront. */
export function toStorefrontProduct(
  row: InventoryProductRow,
  context: ProductContext = {},
  locale: LocalePick = "en",
): Product {
  const variants = [...row.variants].map(toVariant);
  const description = pick(locale, row.description, row.descriptionAr);
  const title = pick(locale, row.title, row.titleAr);
  return {
    id: String(row.id),
    handle: row.handle,
    title,
    description,
    descriptionHtml: toHtml(description),
    productType: pick(locale, context.categoryName, context.categoryNameAr) || null,
    vendor: pick(locale, context.vendorName, context.vendorNameAr) || null,
    vendorBadges: visibleBadges(context.vendorBadges),
    tags: row.tags ?? [],
    attributes: row.attributes ?? [],
    images: row.images.map(image => ({ url: image.url, altText: image.altText ?? title })),
    priceRange: priceRange(variants),
    options: optionsFromVariants(row.variants),
    variants,
  };
}

export type InventoryCategoryRow = {
  id: number;
  slug: string;
  name: string;
  nameAr: string | null;
};

/** A category, shaped as the storefront's `Collection`. */
export function toStorefrontCollection(
  row: InventoryCategoryRow,
  locale: LocalePick = "en",
  image: { url: string; altText: string | null } | null = null,
): Collection {
  return {
    id: String(row.id),
    handle: row.slug,
    title: pick(locale, row.name, row.nameAr),
    description: "",
    image,
  };
}
