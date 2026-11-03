/**
 * Frequently bought, the pure half (migration 0073, on the owner's word):
 * the products a shopper buys again and again, each at the size or option
 * they buy and the amount they usually take.
 *
 * It is the third of three lists, and each answers its own question — a
 * wishlist is what somebody would like, Saved is what they keep to come back
 * to, and this is what they already buy and want back quickly. **Nothing here
 * buys anything**: an item only ever becomes a line in the bag, and checkout
 * is still the shopper's own press. That is what "reorder" means on this
 * page, and the page says so.
 *
 * `Backend/src/services/frequentItems.ts` is the database half.
 */
import { MAX_LINE_QUANTITY } from "./types.js";

/** How many products one account may keep on the list — more than any household restocks. */
export const MAX_FREQUENT_ITEMS = 100;

/** How many of the shopper's own past purchases the page offers to add. */
export const FREQUENT_SUGGESTIONS = 12;

/** The amount kept for an item: a whole number from one to the bag's line ceiling. */
export function frequentQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.round(value)));
}

/** One line the shopper bought, as the suggestion reads it. */
export type PastPurchase = {
  productId: number;
  variantId: number;
  orderId: number;
  placedAt: Date;
  quantity: number;
};

export type FrequentSuggestion = {
  productId: number;
  variantId: number;
  /** In how many separate orders it was bought — what "regularly" means. */
  timesBought: number;
  /** The amount the shopper took the last time, offered as the usual amount. */
  lastQuantity: number;
  lastBought: Date;
};

/**
 * What the shopper has bought before and has not put on the list yet, most
 * often bought first, then most recently — so somebody setting the list up
 * does not have to go back through their orders to remember what they buy.
 *
 * Counted by order, not by line or unit: twelve bottles in one order is one
 * purchase, and the same bottle in three orders is a habit. The usual amount
 * offered is what they took the last time.
 */
export function suggestFrequent(
  purchases: readonly PastPurchase[],
  onList: ReadonlySet<string>,
  limit = FREQUENT_SUGGESTIONS,
): FrequentSuggestion[] {
  const byVariant = new Map<string, { productId: number; variantId: number; orders: Set<number>; last: PastPurchase }>();
  for (const line of purchases) {
    const key = frequentKey(line.productId, line.variantId);
    if (onList.has(key)) continue;
    const seen = byVariant.get(key);
    if (!seen) {
      byVariant.set(key, { productId: line.productId, variantId: line.variantId, orders: new Set([line.orderId]), last: line });
      continue;
    }
    seen.orders.add(line.orderId);
    if (line.placedAt.getTime() > seen.last.placedAt.getTime()) seen.last = line;
  }
  return [...byVariant.values()]
    .map(entry => ({
      productId: entry.productId,
      variantId: entry.variantId,
      timesBought: entry.orders.size,
      lastQuantity: frequentQuantity(entry.last.quantity),
      lastBought: entry.last.placedAt,
    }))
    .sort((a, b) => b.timesBought - a.timesBought || b.lastBought.getTime() - a.lastBought.getTime() || b.variantId - a.variantId)
    .slice(0, Math.max(0, limit));
}

/** The one key an item is known by on both sides: its product and its variant. */
export function frequentKey(productId: number | string, variantId: number | string): string {
  return `${productId}:${variantId}`;
}

/** Whether an item can go in the bag now, and if not, why — what its row says. */
export type FrequentState = "ready" | "soldOut" | "gone";

/**
 * Where an item stands: gone when its product is no longer on sale or the
 * variant chosen no longer exists, sold out when there is none to sell, ready
 * otherwise. A gone item stays on the list with a way to take it off, rather
 * than vanishing from under somebody who put it there.
 */
export function frequentState(
  product: { variants: readonly { id: string; availableForSale: boolean }[] } | null,
  variantId: string,
): FrequentState {
  if (!product) return "gone";
  const variant = product.variants.find(candidate => candidate.id === variantId);
  if (!variant) return "gone";
  return variant.availableForSale ? "ready" : "soldOut";
}

/**
 * How many of an item one press puts in the bag: the usual amount, held to
 * what there is less what the bag already holds of that variant. Zero when
 * there is no room — the row says so rather than asking the server for what
 * it would refuse.
 */
export function frequentAddable(usual: number, maxQuantity: number, inBag: number): number {
  const room = Math.min(MAX_LINE_QUANTITY, maxQuantity) - inBag;
  return Math.max(0, Math.min(frequentQuantity(usual), room));
}
