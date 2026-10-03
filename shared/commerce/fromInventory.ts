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
import { buyable, maxQuantityFor, offerFor } from "./preorder.js";
import { discountAllowed, type DiscountLicence } from "../inventory/discountLicence.js";
import { savingPercent } from "./subscriptions.js";
import { resolveSpeed } from "./deliverySpeed.js";
import { chartProblem, type SizeChart } from "./sizeGuide.js";

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
  /** Absent on a caller that predates pre-order, which means no allowance. */
  preorderStock?: number | null;
  preorderReleaseAt?: Date | string | null;
  options: Record<string, string>;
  /* Optional so a caller that predates the grocery shelf still type-checks. */
  unit?: string | null;
  stepAmount?: string | number | null;
};

export type InventoryImageRow = {
  url: string;
  altText: string | null;
  /** Absent on a caller that predates video, which means a photograph. */
  kind?: "image" | "video" | null;
  posterUrl?: string | null;
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
  /** The seller's size chart (3.1.20). Absent for nearly everything. */
  sizeChart?: SizeChart | null;
  /** Optional extras the seller offers (3.1.2). Absent for nearly everything. */
  addons?: { id: number; kind: string; label: string; labelAr: string | null; price: string }[];
};

export type ProductContext = {
  /** Display name of the vendor that owns the product. */
  vendorName?: string | null;
  vendorNameAr?: string | null;
  /** Awarded badges, unfiltered — `visibleBadges` drops anything unknown. */
  vendorBadges?: string[] | null;
  /* The store's usual band, which this product may override (3.2.5). */
  vendorDeliverySpeed?: string | null;
  /* Who the store ships with (3.4.13), shown as the seller typed it. */
  vendorDeliveryProvider?: string | null;
  /**
   * The vendor's Kuwaiti discount permit, checked on every read.
   *
   * Absent means unchecked rather than invalid, so a caller that predates this
   * keeps its old answer — but every storefront read passes it, because a
   * permit expires on a date with no write happening and a check only at save
   * time would leave the shop advertising a saving it may no longer advertise.
   */
  vendorDiscountLicence?: DiscountLicence | null;
  /** The store's Subscribe & Save percentage (3.1.19); null when it offers none. */
  vendorSubscriptionPercent?: string | null;
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

/**
 * Whether this product may show a struck-through price at all.
 *
 * Applied here rather than at three call sites, so the strikethrough, the
 * `−27%` badge and the savings line disappear together: they all read
 * `compareAtPrice`, and dropping it is the one change that reaches all of
 * them. The price itself does not move and the product is not hidden — an
 * expired permit means the shop may not call it a discount, not that the thing
 * cannot be sold, and pulling it off the shelf would punish a shopper for a
 * vendor's paperwork.
 */
function mayAdvertiseDiscount(context: ProductContext): boolean {
  return context.vendorDiscountLicence === undefined
    ? true
    : discountAllowed(context.vendorDiscountLicence).allowed;
}

function toVariant(row: InventoryVariantRow, allowDiscount = true): ProductVariant {
  const levels = {
    stock: row.stock,
    preorderStock: row.preorderStock ?? 0,
    preorderReleaseAt: row.preorderReleaseAt ?? null,
  };
  const offer = offerFor(levels);

  return {
    id: String(row.id),
    title: row.title,
    sku: row.sku,
    price: money(row.price),
    compareAtPrice: allowDiscount && row.compareAtPrice ? money(row.compareAtPrice) : null,
    // There is still no "continue selling when out of stock" flag, because
    // overselling a marketplace's vendors is a support ticket rather than a
    // sale. A pre-order is not that flag: it is a second, bounded pool the
    // vendor chose the size of, and `preorder.ts` owns the rule.
    availableForSale: buyable(levels),
    preorder: offer.kind === "preorder"
      ? { releaseAt: offer.releaseAt ? offer.releaseAt.toISOString() : null }
      : null,
    maxQuantity: maxQuantityFor(levels),
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
  const allowDiscount = mayAdvertiseDiscount(context);
  const variants = [...row.variants].map(variant => toVariant(variant, allowDiscount));
  const description = pick(locale, row.description, row.descriptionAr);
  const title = pick(locale, row.title, row.titleAr);

  const media = row.images.map(item => ({
    url: item.url,
    altText: item.altText ?? title,
    kind: item.kind === "video" ? ("video" as const) : ("image" as const),
    posterUrl: item.posterUrl ?? null,
  }));

  return {
    id: String(row.id),
    handle: row.handle,
    title,
    description,
    descriptionHtml: toHtml(description),
    productType: pick(locale, context.categoryName, context.categoryNameAr) || null,
    vendor: pick(locale, context.vendorName, context.vendorNameAr) || null,
    vendorBadges: visibleBadges(context.vendorBadges),
    /* Resolved here, once, so no page has to know the override rule — the
       same reason `images` is derived from `media` rather than filtered at
       every call site. */
    deliverySpeed: resolveSpeed(context.vendorDeliverySpeed, (row as { deliverySpeed?: string | null }).deliverySpeed),
    deliveryProvider: context.vendorDeliveryProvider?.trim() || null,
    tags: row.tags ?? [],
    attributes: row.attributes ?? [],
    /*
     * `media` is the gallery as the vendor arranged it; `images` is the same
     * list with the video taken out. Cards, rails, thumbnails and saved tiles
     * all read `images`, so none of them can render a video frame — the rule
     * holds by construction rather than by each of them remembering it.
     */
    media,
    images: media.filter(item => item.kind === "image").map(({ url, altText }) => ({ url, altText })),
    priceRange: priceRange(variants),
    options: optionsFromVariants(row.variants),
    variants,
    /* Nothing is filtered out here: a free extra is refused where a seller
       records it, so anything that reached the database is sellable. The
       label follows the reader's language when the seller gave both. */
    addons: (row.addons ?? []).map(addon => ({
      id: String(addon.id),
      kind: addon.kind,
      label: pick(locale, addon.label, addon.labelAr) || addon.label,
      price: money(addon.price),
    })),
    /* Only a chart that still passes the rules reaches a page: one written
       before a rule tightened is absent rather than recommending wrongly. */
    sizeChart: row.sizeChart && chartProblem(row.sizeChart) === null ? row.sizeChart : null,
    /* The saving obeys the permit for the reason the strikethrough does. */
    subscription: (() => {
      const percent = savingPercent(context.vendorSubscriptionPercent, allowDiscount);
      return percent === null ? null : { savingPercent: percent };
    })(),
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
