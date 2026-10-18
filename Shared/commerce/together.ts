/**
 * What people buy *with* a thing, and which of those are worth showing.
 *
 * Pure, for the reason `taste.ts` is pure: this decides what a shopper is
 * shown next to the product they are looking at, and a ranking you can only
 * exercise by placing a hundred real orders is one nobody checks. The failure
 * mode is not a crash — it is a shop recommending a phone case to somebody
 * buying a rug, quietly, for a month.
 *
 * **Raw co-occurrence is the trap, and avoiding it is the whole module.**
 * Counting how often two products appear in the same basket surfaces the
 * shop's bestsellers beside everything, because a bestseller co-occurs with
 * everything by definition. The signal for a *complement* is not "often seen
 * together" but "seen together far more than chance would give you" — a case
 * appears with a phone most times a phone is bought and rarely otherwise,
 * while batteries appear with everything and mean nothing.
 *
 * So the score is **lift**: how much more likely this pairing is than the two
 * products being independent. `confidence` rides along because it is the
 * number a merchant can actually read — "7 of the 10 people who bought the
 * phone also took the case".
 *
 * Cross-vendor pairings are kept and flagged rather than filtered, because the
 * requirement asks for them explicitly and they are where most of the value
 * is: the phone vendor does not sell the case.
 */
import type { Product } from "./types.js";
import { isRecommendable } from "./taste.js";

/**
 * How a pairing was observed, and what it is worth.
 *
 * The same ordering `taste.ts` uses and for the same reason: money changing
 * hands is the only signal nobody sends by accident, and a basket is intent
 * that has not completed. Weighting them equally would let a shop with one
 * order and four hundred abandoned carts rank on the carts.
 */
export const PAIR_WEIGHT = { bought: 3, bagged: 1 } as const;
export type PairKind = keyof typeof PAIR_WEIGHT;

/**
 * How many baskets a pairing needs before it is allowed to mean anything.
 *
 * Two people buying a rug and a kettle on the same afternoon is a
 * coincidence, and a shop that calls it a recommendation is one whose
 * recommendations are noise. Three is low enough to start working on a new
 * catalog and high enough that a single shopper's habits cannot drive it.
 */
export const MIN_SUPPORT = 3;

/** Nothing below this is a complement; it is two things that both sell. */
export const MIN_LIFT = 1.2;

/** One observed pairing, already collapsed to a weight by the caller. */
export type Pairing = {
  productId: string;
  /** Weighted number of baskets holding both this and the anchor. */
  together: number;
  /** Weighted number of baskets holding this product at all. */
  total: number;
};

export type Complement = {
  product: Product;
  /** How much more often than chance. Above 1 is a real association. */
  lift: number;
  /** Share of the anchor's baskets that also held this. 0 to 1. */
  confidence: number;
  /** True when it comes from a different seller — worth saying on the card. */
  crossVendor: boolean;
};

/**
 * Rank the complements of one product.
 *
 * `anchorTotal` is how many weighted baskets held the anchor at all, and
 * `universe` is how many baskets there are. Both are needed because lift is a
 * ratio of ratios: the chance of seeing B given A, over the chance of seeing B
 * at all.
 *
 * Returns an empty list rather than a padded one when nothing clears the bar.
 * A "frequently bought together" row carrying two products nobody has ever
 * bought together is the dead-control rule at the size of a shelf — and it is
 * worse than an empty rail, because it is a claim.
 */
export function complementsFor(
  anchor: Product,
  anchorTotal: number,
  universe: number,
  pairings: Pairing[],
  catalog: Map<string, Product>,
  limit = 4,
): Complement[] {
  if (anchorTotal <= 0 || universe <= 0) return [];

  const out: Complement[] = [];

  for (const pairing of pairings) {
    if (pairing.productId === anchor.id) continue;
    if (pairing.together < MIN_SUPPORT) continue;

    const product = catalog.get(pairing.productId);
    if (!product) continue;
    // The same two refusals the recommender makes, at a third door: a
    // complement nobody can buy is not a complement.
    if (!isRecommendable(product)) continue;

    const confidence = pairing.together / anchorTotal;
    const baseRate = pairing.total / universe;
    if (baseRate <= 0) continue;

    const lift = confidence / baseRate;
    if (lift < MIN_LIFT) continue;

    out.push({
      product,
      lift,
      confidence,
      crossVendor: normaliseVendor(product.vendor) !== normaliseVendor(anchor.vendor),
    });
  }

  return out
    .sort((left, right) => right.lift - left.lift
      || right.confidence - left.confidence
      || left.product.title.localeCompare(right.product.title))
    .slice(0, limit);
}

const normaliseVendor = (vendor: string | null | undefined) => vendor?.trim().toLowerCase() ?? "";

/**
 * Collapse raw observations into one weighted count per product.
 *
 * Exposed and tested separately because it is where double counting would
 * hide: one basket holding two variants of the same product is one basket, not
 * two, and a shopper who bagged a thing and then bought it has said one thing
 * about it rather than two.
 */
export function collapseObservations(
  observations: Array<{ basketId: string; productId: string; kind: PairKind }>,
): Map<string, number> {
  // Strongest kind per (basket, product), then summed per product.
  const strongest = new Map<string, { productId: string; kind: PairKind }>();
  for (const observation of observations) {
    const key = `${observation.basketId}\u0000${observation.productId}`;
    const current = strongest.get(key);
    if (!current || PAIR_WEIGHT[observation.kind] > PAIR_WEIGHT[current.kind]) {
      strongest.set(key, { productId: observation.productId, kind: observation.kind });
    }
  }

  const totals = new Map<string, number>();
  for (const { productId, kind } of strongest.values()) {
    totals.set(productId, (totals.get(productId) ?? 0) + PAIR_WEIGHT[kind]);
  }
  return totals;
}
