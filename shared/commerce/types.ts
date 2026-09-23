import type { Measure } from "./units.js";
/**
 * Backend-agnostic commerce types.
 *
 * These shapes are the ONLY thing the frontend imports for commerce data, and
 * they expose nothing about the store behind them — no row ids typed as
 * numbers, no table names, no status enums. `shared/commerce/fromInventory.ts`
 * is what turns NetLet's own inventory rows into them; a different store
 * would mean a different mapper and no change here.
 *
 * Keep `Money.amount` as a `string` — it mirrors what every commerce backend
 * returns and avoids float-precision risk on totals. The UI converts to a
 * number only when calling `Intl.NumberFormat`.
 */

export type Money = {
  amount: string; // decimal string, e.g. "385.00"
  currencyCode: string; // ISO 4217, e.g. "USD"
};

export type Image = {
  url: string;
  altText: string | null;
  width?: number;
  height?: number;
};

/**
 * One item in a product's gallery: a photograph, or a video beside them.
 *
 * `posterUrl` is the still shown before a video plays and in the thumbnail
 * strip. Null is ordinary — a vendor may have the clip and no poster — and the
 * player then shows its own first frame rather than the product refusing to
 * render.
 */
export type ProductMedia = Image & {
  kind: "image" | "video";
  posterUrl: string | null;
};

export type ProductOption = {
  name: string; // e.g. "Size"
  values: string[]; // e.g. ["Small", "Medium", "Large"]
};

export type SelectedOption = {
  name: string;
  value: string;
};

export type ProductVariant = {
  /** Opaque variant identifier — pass back to addItem / cart mutations as-is. */
  id: string;
  /**
   * Human label such as "Medium / Charcoal". A product with nothing to choose
   * gets DEFAULT_VARIANT_TITLE, which the UI hides rather than prints.
   */
  title: string;
  /** Merchant stock-keeping code. Null when the store leaves it blank. */
  sku: string | null;
  price: Money;
  compareAtPrice: Money | null;
  /**
   * Whether this can be bought at all, from either pool.
   *
   * True for a variant with nothing on the shelf but a pre-order allowance
   * behind it — the buy button works, it just promises a later parcel. What
   * kind of promise is `preorder`.
   */
  availableForSale: boolean;
  /**
   * Non-null exactly when buying this is a pre-order rather than a purchase
   * off the shelf. `releaseAt` is an ISO date, or null when the vendor has
   * committed to no date — which is also what a date that has already passed
   * becomes, because a stale date reads as a shop that stopped paying
   * attention. See `shared/commerce/preorder.ts`.
   */
  preorder: { releaseAt: string | null } | null;
  /** The most that may be taken in one line. The two pools do not add up. */
  maxQuantity: number;
  /**
   * What this variant is sold in, when it is not simply counted.
   *
   * `{ unit: "each", stepAmount: 1 }` for every product in the shop today, so
   * a page that ignores this keeps working. `{ unit: "g", stepAmount: 250 }`
   * is a quarter-kilo step — `price` is then the price of one step and
   * `unitPrice` derives the per-kilo figure a shopper compares on.
   */
  measure: Measure;
  /** Flat list of selected options — sized for variant pickers. */
  selectedOptions: SelectedOption[];
};

export type ProductAttribute = {
  namespace: string;
  key: string;
  label: string;
  value: string;
};

export type Product = {
  id: string;
  /** URL-friendly slug used as the route param on PDP. */
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string | null;
  vendor: string | null;
  /**
   * Trust badges the vendor has been awarded, as plain keys the client
   * translates. They are here rather than on a vendor object because the
   * storefront never loads a vendor — it loads products, and this is the one
   * place a shopper is told who they are buying from.
   */
  vendorBadges: string[];
  tags: string[];
  /**
   * Spec rows and the review score, from `products.attributes`. The
   * "reviews"/"rating" namespace is the score; anything else is a spec row.
   */
  attributes: ProductAttribute[];
  /**
   * The photographs, and only the photographs.
   *
   * Every card, rail, thumbnail and saved-item tile reads this, and each of
   * them wants a still picture: a card that renders a video is a rail that
   * cannot be scanned. Derived from `media` rather than stored separately, so
   * the rule holds by construction instead of by everybody remembering it.
   */
  images: Image[];
  /**
   * The gallery in the order the vendor arranged it, video included.
   *
   * The product page reads this. Nothing else needs to, which is why `images`
   * stays rather than every consumer learning to filter.
   */
  media: ProductMedia[];
  /** Min / max across all variants — useful for "from $X" pricing. */
  priceRange: { min: Money; max: Money };
  /** Available option dimensions (e.g. Size, Color) for the variant picker. */
  options: ProductOption[];
  variants: ProductVariant[];
};

export type Collection = {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: Image | null;
};

export type CartItem = {
  /** Cart-line identifier — required for update/remove. */
  lineId: string;
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  image: Image | null;
  unitPrice: Money;
  quantity: number;
  lineTotal: Money;
  /**
   * What the variant is sold in, so the bag can read "1.5 kg" beside a
   * quantity of 6. `{ unit: "each", stepAmount: 1 }` for everything counted,
   * which is every line in the shop today.
   */
  measure: Measure;
};

export type Cart = {
  id: string;
  /** Where checkout lives. A NetLet path, not an external host. */
  checkoutUrl: string;
  items: CartItem[];
  itemCount: number;
  subtotal: Money;
  total: Money;
};
