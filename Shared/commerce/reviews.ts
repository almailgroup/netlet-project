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

/* ------------------------------------------------------------ photos --- */

/** The most photos one review carries. */
export const MAX_REVIEW_PHOTOS = 4;
/** How many review photos one account may upload in an hour. */
export const MAX_REVIEW_PHOTOS_PER_HOUR = 20;
/** How many reviews of one account NetLet AI reads in an hour; past it, a review with photos waits for a person. */
export const MAX_REVIEW_SCREENS_PER_HOUR = 12;

/* ------------------------------------------------------------- order --- */

/**
 * How the reviews on a product page are ordered. Newest is the default, and
 * the two by stars break their ties by date, so a page of five-star reviews is
 * still the newest five-star reviews first.
 */
export const REVIEW_SORTS = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

/** How many reviews a product page asks for at a time. */
export const REVIEW_PAGE = 10;

/* -------------------------------------------------------- moderation --- */

/**
 * Why a review is waiting for a person, as the word after `held:` in its
 * hidden reason.
 *
 * A review waiting for a look is a hidden review, on purpose: every public
 * read already leaves hidden rows out — the product page, the stars on a card,
 * a store's average — so a review that is not yet checked cannot reach any of
 * them by a query somebody forgets to change. What tells "waiting" from
 * "removed by an administrator" is this prefix on the reason.
 *
 * - `checking` — written and not yet read, which is what a review is if the
 *   check after it never finished;
 * - `suspicious` — fraud watch judged it high-risk (3.6.5);
 * - `flagged` — NetLet AI raised a concern about its words or photos;
 * - `photos` — it carries photos nobody could look at (no model, or the
 *   hour's readings spent), and a photo on a product page needs eyes;
 * - `edited` — an administrator had removed it and the shopper changed it,
 *   so a person decides again.
 */
export const HOLD_REASONS = ["checking", "suspicious", "flagged", "photos", "edited"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const HELD_PREFIX = "held:";

/** The hidden reason a held review carries. */
export function heldAs(reason: HoldReason, concern?: string | null): string {
  const note = concern?.trim().replace(/\s+/g, " ") ?? "";
  return (`${HELD_PREFIX}${reason}${note ? ` ${note}` : ""}`).slice(0, 200);
}

/** Why a review waits for a person, or null when it is not waiting. */
export function holdOf(hiddenReason: string | null | undefined): { reason: HoldReason; concern: string | null } | null {
  if (!hiddenReason?.startsWith(HELD_PREFIX)) return null;
  const rest = hiddenReason.slice(HELD_PREFIX.length);
  const space = rest.indexOf(" ");
  const word = space === -1 ? rest : rest.slice(0, space);
  const reason = (HOLD_REASONS as readonly string[]).includes(word) ? (word as HoldReason) : "checking";
  const concern = space === -1 ? null : rest.slice(space + 1).trim() || null;
  return { reason, concern };
}

/** Where a review stands, as its author is told. */
export type ReviewState = "published" | "waiting" | "removed";

export function reviewState(review: { hiddenAt: Date | string | null; hiddenReason: string | null }): ReviewState {
  if (!review.hiddenAt) return "published";
  return holdOf(review.hiddenReason) ? "waiting" : "removed";
}

/**
 * What the check decided: shown at once, or waiting for a person and why.
 *
 * The order is the order of seriousness, and only a model that answered may
 * let photos through — "it found nothing" and "it was never asked" are
 * different, the listing screen's rule (3.3.6). Words alone need no model:
 * the contact filter has already refused what must never be shown, and a
 * review that waited for a model nobody configured would never appear.
 * **A low rating is never a reason**: the model is told that a complaint is a
 * review, and nothing here reads the stars.
 */
export type ModerationInput = {
  /** Fraud watch judged it high-risk. */
  suspicious: boolean;
  /** Whether it carries photos. */
  hasPhotos: boolean;
  /** NetLet AI's reading: whether it answered, and its concern if it had one. */
  model: { answered: boolean; concern: string | null };
};

export type ModerationVerdict = { publish: true } | { publish: false; reason: HoldReason; concern: string | null };

export function moderationVerdict(input: ModerationInput): ModerationVerdict {
  if (input.suspicious) return { publish: false, reason: "suspicious", concern: null };
  if (input.model.answered && input.model.concern) return { publish: false, reason: "flagged", concern: input.model.concern };
  if (input.hasPhotos && !input.model.answered) return { publish: false, reason: "photos", concern: null };
  return { publish: true };
}

/**
 * Whether a review is listed on the product page. A rating with no words and
 * no photos counts in the stars and the breakdown, and is not a review to
 * read — a page of bare star rows is a list nobody learns anything from.
 */
export function isWritten(review: { title: string | null; body: string | null; photos?: readonly unknown[] }): boolean {
  return Boolean(review.title?.trim() || review.body?.trim() || (review.photos?.length ?? 0) > 0);
}

/** Each star's share as a whole percentage, summing to 100 (largest remainder), for the breakdown's labels. */
export function distributionPercent(summary: ReviewSummary): Record<number, number> {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (summary.count === 0) return out;
  const exact = [1, 2, 3, 4, 5].map(star => ({ star, value: (summary.distribution[star] * 100) / summary.count }));
  let given = 0;
  for (const entry of exact) { out[entry.star] = Math.floor(entry.value); given += out[entry.star]; }
  const order = [...exact].sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)) || b.star - a.star);
  for (let index = 0; given < 100 && index < order.length; index++, given++) out[order[index].star] += 1;
  return out;
}
