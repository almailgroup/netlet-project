import type { Measure } from "./units.js";
import type { DeliverySpeed } from "./deliverySpeed.js";
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

/**
 * An optional extra a seller offers with a product (3.1.2).
 *
 * On the product rather than the variant: a fitting is the same visit
 * whichever colour was picked.
 */
export type ProductAddon = {
  id: string;
  kind: string;
  label: string;
  price: Money;
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
  /**
   * How soon the seller says this ships, as a band (3.2.5).
   *
   * Already resolved — the product's own answer over its store's — so no page
   * has to know the override rule, and null means the seller has said nothing
   * rather than "slow". The band is the seller's statement, not a computed
   * guarantee: NetLet has no carrier integration to compute one from.
   */
  deliverySpeed: DeliverySpeed | null;
  /**
   * Who the seller ships with (3.4.13), as they typed it.
   *
   * Shown and attributed, and it claims nothing about tracking — NetLet
   * integrates with no carrier, and a name beside a live-tracking promise the
   * shop cannot keep would be worse than no name.
   */
  deliveryProvider: string | null;
  /**
   * Optional extras the seller offers with this product (3.1.2) — installation,
   * an extended warranty. Empty for nearly everything, which is why it is a
   * list rather than two nullable fields.
   */
  addons: ProductAddon[];
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
  /**
   * The shelf price, when this shopper is paying less than it because the
   * seller agreed a special price with them (requirement 3.1.13). Null the
   * rest of the time, which is nearly always.
   *
   * Deliberately not `compareAtPrice`: that field drives the public
   * strikethrough and the `−27%` badge, which are an advertised claim and need
   * a Ministry of Commerce permit. This is a private answer to one shopper who
   * asked, and it is shown as what it is.
   */
  agreedFrom?: Money | null;
  quantity: number;
  /**
   * The optional extras this line carries (3.1.2) — a fitting, an extended
   * warranty. Priced from the catalog on every read, like everything else in a
   * basket: `cart_item_addons` stores which, never what they cost.
   */
  addons?: { id: string; label: string; kind: string; price: Money }[];
  /** Those extras across the whole line. Included in `lineTotal`. */
  addonsTotal?: Money | null;
  /**
   * The bundle this line is priced as part of (3.3.11), when one is.
   *
   * A name rather than a figure: the price is already `unitPrice`, and this is
   * so a shopper can see which set made it lower.
   */
  bundleName?: string | null;
  lineTotal: Money;
  /**
   * What the variant is sold in, so the bag can read "1.5 kg" beside a
   * quantity of 6. `{ unit: "each", stepAmount: 1 }` for everything counted,
   * which is every line in the shop today.
   */
  measure: Measure;
};

/** One seller's delivery charge on this basket (requirement 3.2.4). */
export type CartDeliveryLine = {
  vendorId: number | null;
  vendorName: string;
  /** What this seller's goods come to, which is what the threshold measures. */
  goods: Money;
  fee: Money;
  free: boolean;
  /**
   * What to add *at this seller* to stop paying, while that is still a nudge.
   * Null once cleared, and null when they have no threshold at all.
   */
  toFree: Money | null;
};

export type Cart = {
  id: string;
  /** Where checkout lives. A NetLet path, not an external host. */
  checkoutUrl: string;
  items: CartItem[];
  itemCount: number;
  subtotal: Money;
  /**
   * Delivery, per seller and summed.
   *
   * Per seller because a basket from three shops is three parcels, and one
   * averaged figure hides which seller is expensive. The shopper sees each.
   */
  delivery: { perVendor: CartDeliveryLine[]; total: Money };
  /**
   * Whether cash on delivery is available on this basket (3.2.2), and which
   * seller refused if not.
   *
   * Resolved on the server so the page cannot offer a method the API would
   * refuse — the rule the password floor already follows.
   */
  cod: { available: true } | { available: false; because: { kind: "seller"; vendorName: string } | { kind: "ceiling"; vendorName: string; ceiling: string } };
  /**
   * Whether this basket looks forgotten (3.1.17), and for how long.
   *
   * A count and an age, never a total: a cart stores no prices, so an old
   * basket is re-priced on every read and a reminder quoting a figure that has
   * since moved is a shop arguing with its own page.
   */
  recovery: { remind: true; itemCount: number; hours: number } | { remind: false };
  total: Money;
};
