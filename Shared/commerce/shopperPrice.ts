/**
 * What one shopper pays for one unit, and why — the single answer.
 *
 * Four things can lower a line below the shelf: a bundle, a personally agreed
 * price (3.1.18), a subscriber's saving (3.1.19) and a member's price (4.1).
 * This decided in three places — the bag, checkout's lines and checkout's
 * free-delivery threshold — and they had already drifted: the threshold
 * ignored a subscriber's saving the line itself took. Three copies of a money
 * rule is how a summary comes to disagree with the bill, so there is one.
 *
 * **A bundle decides first**: it is a set at a set price, and a second
 * reduction stacked on it is two discounts neither of which knew about the
 * other. Otherwise **the lowest wins and nothing stacks** — each of the other
 * three is a reduction on the same line, and the shopper gets the best one,
 * never the sum. **A tie goes to the reduction that costs the shopper
 * nothing to use**: a member's or a subscriber's price before an agreed one,
 * because an agreed price is spent when it sets the line, and spending it on a
 * figure the shopper had anyway takes it from another day.
 *
 * Nothing here checks *whether* a reduction applies — membership, the
 * Ministry permit, the offer's window. The caller hands over only reductions
 * that do; this decides between them.
 */
import { compareMoney } from "../money.js";
import { priceFor, type OfferRow } from "./priceOffers.js";
import { subscriberPrice } from "./subscriptions.js";

export type PriceReason = "list" | "bundle" | "agreed" | "subscriber" | "member";

export type PriceInputs = {
  listPrice: string;
  bundlePrice?: string | null;
  agreed?: OfferRow | null;
  subscriberPercent?: number | null;
  /** Already checked: the shopper is a member and the store's permit is valid. */
  memberPrice?: string | null;
};

export function shopperPrice(inputs: PriceInputs, now: Date = new Date()): { charged: string; reason: PriceReason } {
  if (inputs.bundlePrice) return { charged: inputs.bundlePrice, reason: "bundle" };

  const list = inputs.listPrice;
  /* In order of preference on a tie: free to use first, spent last. */
  const candidates: { charged: string; reason: PriceReason }[] = [];
  if (inputs.memberPrice) candidates.push({ charged: inputs.memberPrice, reason: "member" });
  if (inputs.subscriberPercent !== null && inputs.subscriberPercent !== undefined) {
    candidates.push({ charged: subscriberPrice(list, inputs.subscriberPercent), reason: "subscriber" });
  }
  if (inputs.agreed) candidates.push({ charged: priceFor(list, inputs.agreed, now), reason: "agreed" });

  let best = { charged: list, reason: "list" as PriceReason };
  for (const candidate of candidates) {
    if (compareMoney(candidate.charged, best.charged) < 0) best = candidate;
  }
  return best;
}
