/**
 * Rating a delivery, apart from what was delivered (3.4.4).
 *
 * Pure, for the reason the review rules are: this decides something a delivery
 * company's contract will one day be measured against, and a rule you can only
 * exercise by waiting for a real van is a rule nobody checks.
 *
 * **What is rated is a parcel** — one seller's goods to one door, which is what
 * one driver carried. Not the order, which may have been three vans; not the
 * line, because two items in one box arrived together and the shopper has one
 * opinion about how.
 *
 * **Arrival is a date, not a status.** A parcel is rateable once every line in
 * it has a `deliveredAt`, which survives the line later being sent back: the
 * delivery happened, and somebody who returned the lamp may have the clearest
 * view of how it was handed over. That is the rule `reviews.ts` applies for the
 * same reason.
 *
 * **It is not gated on payment**, unlike a product review. A cash order is paid
 * when a seller records it, which can be days after the door; the driver's
 * conduct at the door is already over by then, and making the shopper wait for
 * somebody else's bookkeeping to say whether the driver was rude is the wrong
 * way round.
 *
 * **It closes.** A rating written three months on is about a memory, not a
 * delivery, and a company's score should be made of the second.
 */
import { summarise, type ReviewSummary } from "./reviews.js";

export { RATING_MAX, RATING_MIN, isValidRating } from "./reviews.js";

/** How long after arrival a delivery can still be rated or re-rated. */
export const DELIVERY_RATING_WINDOW_DAYS = 30;

/** Long enough for "left it in the rain", short enough that it is not a review. */
export const MAX_DELIVERY_COMMENT = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeliveryRatingRefusal = "delivery.notArrived" | "delivery.ratingClosed";

export type DeliveryRatingState =
  | { allowed: true; closesAt: Date }
  | { allowed: false; reason: DeliveryRatingRefusal };

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * When the parcel arrived: the last of its lines to arrive, or null while any
 * has not.
 *
 * The *last*, because a parcel is handed over once; a line stamped earlier
 * than its sibling is a seller marking the two a minute apart, not two
 * deliveries.
 */
export function parcelArrivedAt(lines: { deliveredAt: Date | string | null }[]): Date | null {
  if (lines.length === 0) return null;
  let latest: Date | null = null;
  for (const line of lines) {
    const at = asDate(line.deliveredAt);
    if (!at) return null;
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

/** Whether this parcel may be rated now, and until when. */
export function deliveryRatingState(arrivedAt: Date | string | null, now: Date): DeliveryRatingState {
  const at = asDate(arrivedAt);
  if (!at) return { allowed: false, reason: "delivery.notArrived" };
  const closesAt = new Date(at.getTime() + DELIVERY_RATING_WINDOW_DAYS * DAY_MS);
  if (now.getTime() > closesAt.getTime()) return { allowed: false, reason: "delivery.ratingClosed" };
  return { allowed: true, closesAt };
}

/**
 * A comment as it is stored: trimmed, whitespace flattened, and null when it
 * says nothing — a rating with an empty comment is a rating with no comment.
 */
export function cleanDeliveryComment(comment: string | null | undefined): string | null {
  const flat = (comment ?? "").replace(/\s+/g, " ").trim();
  return flat ? flat.slice(0, MAX_DELIVERY_COMMENT) : null;
}

export type CarrierScore = {
  /** The company, or null for parcels a seller carried themselves. */
  courierId: number | null;
  summary: ReviewSummary;
};

/**
 * Each carrier's score, from the ratings frozen against it.
 *
 * A company with no ratings is absent rather than scored zero — the badge rule
 * again: "0.0 from 0" reads as a bad company rather than a new one. Ordered by
 * the number of ratings, so the score with the most behind it is read first.
 */
export function scoresByCarrier(ratings: { courierId: number | null; rating: number }[]): CarrierScore[] {
  const grouped = new Map<number | null, number[]>();
  for (const row of ratings) grouped.set(row.courierId, [...(grouped.get(row.courierId) ?? []), row.rating]);

  const scores: CarrierScore[] = [];
  for (const [courierId, values] of grouped) {
    const summary = summarise(values);
    if (summary) scores.push({ courierId, summary });
  }
  return scores.sort((a, b) => b.summary.count - a.summary.count || (a.courierId ?? 0) - (b.courierId ?? 0));
}
