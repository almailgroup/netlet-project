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
  availableForSale: boolean;
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
  images: Image[];
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
