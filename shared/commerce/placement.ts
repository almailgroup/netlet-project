/**
 * Who gets shown first, and why.
 *
 * Requirement 3.4.20: sellers who take part in a discount earn better
 * placement. Pure, for the reason the recommendation ranking is pure — this
 * decides what a shopper sees before they have chosen anything, and a ranking
 * you can only exercise by staring at a category page is one nobody checks.
 *
 * ## The rules
 *
 * **Only a permitted, live saving earns anything.** `fromInventory` already
 * drops `compareAtPrice` when the Ministry of Commerce permit is not valid
 * *now*, so an unlicensed offer arrives here indistinguishable from no offer
 * and earns nothing by construction — not by this function remembering to
 * check. That is the same reason the strikethrough and the badge vanish
 * together.
 *
 * **It sharpens, it never overturns.** The boost reorders products that were
 * already going to be shown; it cannot lift something out of a category it
 * does not belong to, and it never outranks the shopper's own sort. A shop
 * where "discounting" beats "what you asked for" is an advert.
 *
 * **Nothing unbuyable is lifted.** The same rule `isRecommendable` applies: a
 * row promoting four things that cannot be bought is the dead-control rule at
 * the size of a shelf. A sold-out product earns no boost however deep its
 * discount.
 *
 * **The depth matters, but only up to a point.** A 5% saving and a 60% saving
 * are not the same commitment, so the boost scales — and it is capped, because
 * beyond a point a bigger number is a clearance sale rather than a better
 * shop, and letting it run would sort the catalogue by desperation.
 */
import type { Product } from "./types.js";
import { toFils } from "../money.js";

/** The most a discount can move a product, as a share of the ranking score. */
export const MAX_BOOST = 0.3;

/** Below this, a saving is a rounding difference rather than an offer. */
export const MIN_SAVING_PERCENT = 5;

/** Where the boost stops growing. A deeper cut earns no more than this. */
export const FULL_BOOST_PERCENT = 40;

/** The best live saving across a product's variants, as a percentage. */
export function savingPercentOf(product: Product): number {
  let best = 0;
  for (const variant of product.variants) {
    /* `compareAtPrice` is already null unless the permit is valid now, so an
       expired permit cannot earn placement — it is not checked here because
       it cannot arrive here. */
    if (!variant.compareAtPrice) continue;
    if (!variant.availableForSale) continue;
    const was = toFils(variant.compareAtPrice.amount);
    const now = toFils(variant.price.amount);
    if (was <= now || was <= 0n) continue;
    const percent = Number(((was - now) * 100n) / was);
    if (percent > best) best = percent;
  }
  return best;
}

/**
 * What this product's discount is worth to its position, from 0 to `MAX_BOOST`.
 *
 * Zero for everything with no live saving, which is most of a catalogue — so
 * the ordinary case is untouched and the boost is a tie-breaker rather than a
 * rewrite.
 */
export function placementBoost(product: Product): number {
  const saving = savingPercentOf(product);
  if (saving < MIN_SAVING_PERCENT) return 0;
  const scaled = Math.min(saving, FULL_BOOST_PERCENT) / FULL_BOOST_PERCENT;
  return MAX_BOOST * scaled;
}

/**
 * Reorder a page so discounting sellers come first among equals.
 *
 * **Stable**: products with the same boost keep the order they arrived in,
 * which for the default sort is the merchant's own arrangement. A sort that
 * shuffles equal items makes a category page change under somebody reloading
 * it, and that is indistinguishable from a bug.
 */
export function withPlacement<T extends Product>(products: T[]): T[] {
  return products
    .map((product, index) => ({ product, index, boost: placementBoost(product) }))
    .sort((a, b) => b.boost - a.boost || a.index - b.index)
    .map(entry => entry.product);
}
