/**
 * What a shopper seems interested in, and which products fit it.
 *
 * Pure, for the same reason permissions and commission are pure: this decides
 * what a shopper is shown, which is the most visible thing NetLet does with
 * what it knows about them. A ranking you can only exercise by signing in as
 * somebody and staring at a rail is a ranking nobody checks — and the failure
 * mode is not a crash, it is a shop that quietly recommends the wrong things
 * to everybody for a month.
 *
 * **Every recommendation carries its reason**, as message keys rather than
 * sentences, the way `refusalFor` and `returnStateFor` do. That is not
 * decoration: "because you saved a brass lamp" is checkable by the shopper and
 * a bare list of products is not, and a reason the shopper can read is also a
 * reason a developer can debug. It is the same argument `vendorHealth` makes
 * for carrying the raw counts behind its score.
 *
 * The scoring here is deliberately simple and explainable. A language model
 * may reorder what this produces — `server/recommendations.ts` is where that
 * happens — but it never chooses the candidate set and it never invents a
 * product, because this is the floor and the floor is the thing that is
 * tested.
 */
import type { Money, Product } from "./types.js";
import { toFils } from "../money.js";

/** How a product came to be a signal, strongest first. */
export type SignalKind = "bought" | "bagged" | "saved" | "followed";

/**
 * What each kind of signal is worth.
 *
 * Bought outranks everything: money changed hands, which is the only signal
 * nobody sends by accident. Bagged is intent that has not completed. Saved is
 * interest with no commitment. Followed is the weakest *as taste* even though
 * it is a deliberate act — "tell me when this is cheaper" often means "I want
 * this and cannot have it", which says more about the price than the category.
 */
export const SIGNAL_WEIGHT: Record<SignalKind, number> = {
  bought: 4,
  bagged: 3,
  saved: 2,
  followed: 1,
};

export type TasteSignal = { productId: string; kind: SignalKind };

/** Why a product was recommended. Message keys, resolved by whoever draws it. */
export type TasteReason =
  | { key: "taste.becauseType"; value: string }
  | { key: "taste.becauseVendor"; value: string }
  | { key: "taste.becauseTag"; value: string }
  | { key: "taste.becausePrice" };

export type Recommendation = {
  product: Product;
  score: number;
  /** Most-specific first, and never more than two — a card has room for one. */
  reasons: TasteReason[];
};

export type TasteProfile = {
  /** Lowercased product type → accumulated weight. */
  types: Map<string, number>;
  vendors: Map<string, number>;
  tags: Map<string, number>;
  /** The middle of what they look at, in fils. Null when nothing is priced. */
  typicalFils: bigint | null;
  /** Everything that fed the profile, so it is never recommended back. */
  seen: Set<string>;
  /** Total weight behind the profile — how much it is worth trusting. */
  strength: number;
};

const clean = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

function bump(into: Map<string, number>, key: string, weight: number) {
  if (!key) return;
  into.set(key, (into.get(key) ?? 0) + weight);
}

function fils(money: Money | undefined): bigint | null {
  if (!money?.amount) return null;
  const value = toFils(money.amount);
  return value > 0n ? value : null;
}

/**
 * Below this, "personalised" is a word for something that is not happening.
 *
 * One saved product is a data point, not a taste. A rail headed "Picked for
 * you" off the back of a single tap is the kind of claim a shopper checks once
 * and never trusts again — the same reason there are no invented seller counts
 * on the sign-in wall. `personalised` on the result is what the page reads to
 * decide whether it may say "for you" at all.
 */
export const TASTE_FLOOR = 2;

/** Build the profile from the signals, resolved against the live catalog. */
export function buildTaste(signals: TasteSignal[], catalog: Product[]): TasteProfile {
  const byId = new Map(catalog.map(product => [product.id, product]));
  const profile: TasteProfile = {
    types: new Map(),
    vendors: new Map(),
    tags: new Map(),
    typicalFils: null,
    seen: new Set(),
    strength: 0,
  };

  const prices: bigint[] = [];

  /*
   * Strongest kind per product, not the sum. Somebody who saved a lamp, bagged
   * it and then bought it has told us one thing about lamps, and counting it
   * three times would let a single decisive purchase drown out the four other
   * products they actually browse.
   */
  const strongest = new Map<string, SignalKind>();
  for (const signal of signals) {
    const current = strongest.get(signal.productId);
    if (!current || SIGNAL_WEIGHT[signal.kind] > SIGNAL_WEIGHT[current]) {
      strongest.set(signal.productId, signal.kind);
    }
  }

  for (const [productId, kind] of strongest) {
    profile.seen.add(productId);
    const product = byId.get(productId);
    // A signal for something no longer on the shelf still counts as seen — we
    // must not recommend it back — but it can teach nothing, so it stops here.
    if (!product) continue;

    const weight = SIGNAL_WEIGHT[kind];
    profile.strength += weight;

    bump(profile.types, clean(product.productType), weight);
    bump(profile.vendors, clean(product.vendor), weight);
    for (const tag of product.tags) bump(profile.tags, clean(tag), weight);

    const price = fils(product.priceRange.min);
    if (price !== null) prices.push(price);
  }

  if (prices.length) {
    /*
     * The median rather than the mean. One aspirational look at a KWD 500 rug
     * drags a mean across the whole catalog and starts recommending furniture
     * to somebody who buys coffee — a middle value ignores the outlier instead
     * of being moved by it.
     */
    prices.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    profile.typicalFils = prices[Math.floor(prices.length / 2)];
  }

  return profile;
}

/**
 * How close two prices are, from 1 (the same) to 0 (an order of magnitude out).
 *
 * A ratio rather than a difference, because KWD 2 against KWD 4 is a different
 * shopper and KWD 200 against KWD 202 is the same one — and a rule written on
 * subtraction gets that backwards at both ends.
 */
export function priceAffinity(candidateFils: bigint, typicalFils: bigint): number {
  if (candidateFils <= 0n || typicalFils <= 0n) return 0;
  const low = candidateFils < typicalFils ? candidateFils : typicalFils;
  const high = candidateFils < typicalFils ? typicalFils : candidateFils;
  const ratio = Number(low) / Number(high);
  return ratio;
}

/**
 * Whether a product is worth putting in front of somebody at all.
 *
 * Two refusals, and both were found by looking at a real rail rather than by
 * reasoning about one. **Sold out**: a "picked for you" row where three of the
 * four cannot be bought is the dead-control rule at the size of a shelf —
 * somebody reads it once and stops reading it. Following a sold-out product is
 * a real thing a shopper may want, but it is what the product page is for, not
 * what a recommendation is.
 *
 * **Priced at zero**: the same money rule `assertPriced` puts on the two doors
 * onto the shelf, applied at the third. Anything at 0.000 is buyable for
 * nothing the moment it is live, and a recommender that pushes it to the front
 * of the home page turns a data problem into a refund.
 */
export function isRecommendable(product: Product): boolean {
  const buyable = product.variants.filter(variant => variant.availableForSale);
  if (buyable.length === 0) return false;
  return buyable.some(variant => toFils(variant.price.amount) > 0n);
}

/**
 * Rank the catalog against a profile.
 *
 * Nothing already in `seen` comes back, and nothing `isRecommendable` refuses:
 * recommending a shopper the thing sitting in their own bag is the single
 * fastest way to make a rail look broken, and recommending four things they
 * cannot buy is the second. A candidate that matches nothing scores zero and is dropped rather
 * than padded in — a rail of six where two are relevant teaches somebody to
 * stop reading it, which is the browse rule again.
 */
export function rankByTaste(profile: TasteProfile, catalog: Product[], limit = 8): Recommendation[] {
  const typeTotal = Math.max(1, ...profile.types.values());
  const vendorTotal = Math.max(1, ...profile.vendors.values());
  const tagTotal = Math.max(1, ...profile.tags.values());

  const scored: Recommendation[] = [];

  for (const product of catalog) {
    if (profile.seen.has(product.id)) continue;
    if (!isRecommendable(product)) continue;

    const reasons: TasteReason[] = [];
    let score = 0;

    const type = clean(product.productType);
    const typeWeight = type ? profile.types.get(type) ?? 0 : 0;
    if (typeWeight > 0) {
      score += 3 * (typeWeight / typeTotal);
      reasons.push({ key: "taste.becauseType", value: product.productType ?? "" });
    }

    const vendor = clean(product.vendor);
    const vendorWeight = vendor ? profile.vendors.get(vendor) ?? 0 : 0;
    if (vendorWeight > 0) {
      score += 1.5 * (vendorWeight / vendorTotal);
      reasons.push({ key: "taste.becauseVendor", value: product.vendor ?? "" });
    }

    /*
     * The best-matching tag names the reason, not every tag that overlapped.
     * "Because you like ceramic, stoneware, handmade, kitchen" is a list of
     * our own metadata read out loud; one word is a sentence a person says.
     */
    let bestTag = "";
    let bestTagWeight = 0;
    let tagScore = 0;
    for (const raw of product.tags) {
      const tag = clean(raw);
      const weight = tag ? profile.tags.get(tag) ?? 0 : 0;
      if (weight <= 0) continue;
      tagScore += 2 * (weight / tagTotal);
      if (weight > bestTagWeight) {
        bestTagWeight = weight;
        bestTag = raw;
      }
    }
    if (tagScore > 0) {
      score += tagScore;
      reasons.push({ key: "taste.becauseTag", value: bestTag });
    }

    /*
     * Price never lifts a product on its own — it only sharpens something that
     * already matched. Otherwise the cheapest half of the shop would be
     * "recommended" to anybody who has ever bought anything cheap.
     */
    if (score > 0 && profile.typicalFils !== null) {
      const candidate = fils(product.priceRange.min);
      if (candidate !== null) {
        const affinity = priceAffinity(candidate, profile.typicalFils);
        score += affinity;
        if (affinity > 0.6) reasons.push({ key: "taste.becausePrice" });
      }
    }

    if (score <= 0) continue;
    scored.push({ product, score, reasons: reasons.slice(0, 2) });
  }

  return scored
    .sort((left, right) => right.score - left.score || left.product.title.localeCompare(right.product.title))
    .slice(0, limit);
}

/**
 * The words handed to a language model to describe this shopper.
 *
 * Interest terms and nothing else: no name, no address, no email, no account
 * id, no order reference. What leaves NetLet is "kitchen, ceramic, under KWD
 * 10" — true of thousands of people and identifying none of them. A
 * personalisation feature that ships a customer's identity to a third party to
 * get a better rail has made a trade nobody asked it to make.
 */
export function tasteTerms(profile: TasteProfile, limit = 8): string[] {
  const merged = new Map<string, number>();
  for (const [type, weight] of profile.types) bump(merged, type, weight * 3);
  for (const [tag, weight] of profile.tags) bump(merged, tag, weight * 2);
  for (const [vendor, weight] of profile.vendors) bump(merged, vendor, weight);

  return [...merged.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

/**
 * Apply a model's preferred order to a ranking we already trust.
 *
 * The model returns product ids. Anything not in the candidate set is dropped
 * on the floor — **a model must never be able to add a product to a shop**,
 * and "it returned an id we did not send it" is either a hallucination or an
 * injection, neither of which should reach a shopper. Anything it omits keeps
 * its own order behind what it did choose, so a truncated or partial reply
 * degrades to the deterministic ranking rather than to a short rail.
 */
export function applyModelOrder(ranked: Recommendation[], order: string[]): Recommendation[] {
  const known = new Map(ranked.map(entry => [entry.product.id, entry]));
  const taken = new Set<string>();
  const out: Recommendation[] = [];

  for (const id of order) {
    const entry = known.get(id);
    if (!entry || taken.has(id)) continue;
    taken.add(id);
    out.push(entry);
  }
  for (const entry of ranked) {
    if (!taken.has(entry.product.id)) out.push(entry);
  }
  return out;
}
