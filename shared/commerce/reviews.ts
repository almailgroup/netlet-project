/**
 * Who may review what, and what a pile of ratings adds up to.
 *
 * Pure, for the reason the return window is pure: this decides something a
 * shopper will argue with, and a rule you can only exercise by buying a real
 * product and waiting for a real courier is a rule nobody checks.
 *
 * **A review is anchored to an order line, not to a person and a product.**
 * That one decision settles most of the rest. The line is the proof of
 * purchase, so "verified" needs no separate flag and cannot be forged by
 * anything short of writing to `order_items`. It is also the natural
 * uniqueness key: somebody who bought a kettle twice has two opinions worth
 * having and gets two reviews, while somebody who bought it once cannot write
 * ten. A `(userId, productId)` key would have got both of those wrong.
 *
 * **Delivered is a date, not a status.** The gate is `deliveredAt` being set
 * rather than the line currently reading `delivered`, and the difference
 * matters: a line that was delivered and then returned is no longer in the
 * delivered *state*, but that shopper has the most useful opinion on the shelf
 * and must not be silenced by having sent the thing back.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Longest a review body may be. Long enough to be useful, short enough to read. */
export const MAX_REVIEW_BODY = 2000;
export const MAX_REVIEW_TITLE = 120;

/**
 * Why a review was refused, as a key rather than a sentence.
 *
 * The same shape `refusalFor` and `returnStateFor` use: the server decides and
 * the page translates, so a refusal reads in Arabic without the server knowing
 * there is an Arabic.
 */
export type ReviewRefusal =
  | "notPaid"
  | "notDelivered"
  | "alreadyReviewed";

export type ReviewEligibility =
  | { allowed: true }
  | { allowed: false; reason: ReviewRefusal };

const ALLOWED: ReviewEligibility = { allowed: true };

/**
 * Order statuses that count as a purchase having happened.
 *
 * `refunded` is deliberately in the list. Money moved, goods arrived, and then
 * something went wrong — which is the single most useful review on any shop.
 * Excluding it would quietly filter the shelf towards happy endings, and a
 * ratings system that does that is one nobody should trust.
 */
const PAID_STATUSES = new Set(["paid", "refunded"]);

export type ReviewableLine = {
  /** The payment lifecycle, from the order the line belongs to. */
  orderStatus: string;
  /** When the goods actually arrived. Null until they did. */
  deliveredAt: Date | string | null;
  /** Whether this exact line already carries a review. */
  reviewed: boolean;
};

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Whether this line may be reviewed, and if not, why.
 *
 * Checked in the order a shopper would hit the conditions, so the message they
 * get names the thing standing in their way rather than the first rule in the
 * file.
 */
export function eligibilityFor(line: ReviewableLine): ReviewEligibility {
  if (!PAID_STATUSES.has(line.orderStatus)) return { allowed: false, reason: "notPaid" };
  if (asDate(line.deliveredAt) === null) return { allowed: false, reason: "notDelivered" };
  if (line.reviewed) return { allowed: false, reason: "alreadyReviewed" };
  return ALLOWED;
}

/** Whether a rating is one of the five stars, as an integer. */
export function isValidRating(value: number): boolean {
  return Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX;
}

export type ReviewSummary = {
  count: number;
  /** Mean to one decimal place — what a star row actually renders. */
  average: number;
  /** How many of each star, 1 through 5. The shape a histogram needs. */
  distribution: Record<number, number>;
};

/**
 * What a set of ratings adds up to, or null when there are none.
 *
 * **Null rather than a zero-valued summary**, which is the badge rule at the
 * size of a product page: "0.0 out of 5 from 0 reviews" is worse than no star
 * row at all, because it reads as a bad product rather than a new one. The
 * caller renders nothing and the page is honest.
 *
 * The distribution is always all five keys, including the empty ones, so a
 * histogram does not have to guess which bars to draw.
 */
export function summarise(ratings: number[]): ReviewSummary | null {
  const valid = ratings.filter(isValidRating);
  if (valid.length === 0) return null;

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const rating of valid) {
    distribution[rating] += 1;
    total += rating;
  }

  return {
    count: valid.length,
    // One decimal, rounded half away from zero the way a person expects.
    average: Math.round((total / valid.length) * 10) / 10,
    distribution,
  };
}

/**
 * What share of reviews gave each star, 0 to 1.
 *
 * Separated from `summarise` because it is a *drawing* concern: the same
 * counts are what a vendor wants and a bar width is what a shopper wants, and
 * computing a percentage inside the summary would push a rendering decision
 * into the part both sides share.
 */
export function distributionShare(summary: ReviewSummary): Record<number, number> {
  const share: Record<number, number> = {};
  for (let star = RATING_MIN; star <= RATING_MAX; star++) {
    share[star] = summary.count === 0 ? 0 : summary.distribution[star] / summary.count;
  }
  return share;
}
