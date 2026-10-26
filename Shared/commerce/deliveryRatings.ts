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
import { isValidRating, summarise, type ReviewSummary } from "./reviews.js";

export { RATING_MAX, RATING_MIN, isValidRating } from "./reviews.js";

/**
 * What a delivery is rated on (3.4.4: "speed, package condition, courier
 * conduct"), each from one to five. Migration 0067.
 *
 * **The overall is their average, rounded to a whole star**, and it is what
 * `rating` holds — so every score, badge and report that read one figure goes
 * on reading it, and a rating given before the parts existed keeps its one
 * figure with no parts beside it.
 */
export const RATING_PARTS = ["speed", "condition", "conduct"] as const;
export type RatingPart = (typeof RATING_PARTS)[number];
export type RatingParts = Record<RatingPart, number>;

export function partsValid(parts: Partial<Record<RatingPart, number | null | undefined>>): parts is RatingParts {
  return RATING_PARTS.every(part => isValidRating(parts[part] as number));
}

/** The overall stars: the parts' average, half up. */
export function overallOf(parts: RatingParts): number {
  return Math.round((parts.speed + parts.condition + parts.conduct) / 3);
}

/** Each part's average over the ratings that carry it, to one decimal, or null with none. */
export function partAverages(rows: readonly Partial<Record<RatingPart, number | null>>[]): Record<RatingPart, number | null> {
  const out = {} as Record<RatingPart, number | null>;
  for (const part of RATING_PARTS) {
    const values = rows.map(row => row[part]).filter((value): value is number => typeof value === "number");
    out[part] = values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
  }
  return out;
}

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
  /** Speed, condition and conduct, each averaged over the ratings that gave them. */
  parts: Record<RatingPart, number | null>;
};

/**
 * Each carrier's score, from the ratings frozen against it.
 *
 * A company with no ratings is absent rather than scored zero — the badge rule
 * again: "0.0 from 0" reads as a bad company rather than a new one. Ordered by
 * the number of ratings, so the score with the most behind it is read first.
 */
export function scoresByCarrier(ratings: ({ courierId: number | null; rating: number } & Partial<Record<RatingPart, number | null>>)[]): CarrierScore[] {
  const grouped = new Map<number | null, typeof ratings>();
  for (const row of ratings) grouped.set(row.courierId, [...(grouped.get(row.courierId) ?? []), row]);

  const scores: CarrierScore[] = [];
  for (const [courierId, rows] of grouped) {
    const summary = summarise(rows.map(row => row.rating));
    if (summary) scores.push({ courierId, summary, parts: partAverages(rows) });
  }
  return scores.sort((a, b) => b.summary.count - a.summary.count || (a.courierId ?? 0) - (b.courierId ?? 0));
}
