/**
 * Trust badges, and a vendor's own account health.
 *
 * Both are pure and both are *derived*. The requirements ask for badges "such
 * as Verified Seller, Fast Shipping, High Rating" and a health score "showing
 * their performance indicators transparently" — and transparency is the whole
 * requirement. A score a vendor cannot reproduce from their own numbers is a
 * grade with no appeal, so every component here is a plain count they can see.
 *
 * Verification is the exception and is deliberately awarded, not computed:
 * "Verified Seller" means a human checked the documents, and a badge a seller
 * can earn by behaving well would say something else entirely. Everything else
 * is earned and only earned: "High Rating" is the store's own reviews and
 * "Fast Shipping" its own delivery times, so neither can be shown on a store
 * whose numbers do not support it.
 */

/** The one badge a person awards: an administrator checked the documents. */
export const AWARDED_BADGES = ["verified"] as const;
/** The badges the numbers award, measured again on every read. */
export const EARNED_BADGES = ["highRating", "fastShipping"] as const;
export const TRUST_BADGES = [...AWARDED_BADGES, ...EARNED_BADGES] as const;
export type TrustBadge = (typeof TRUST_BADGES)[number];
export type AwardedBadge = (typeof AWARDED_BADGES)[number];

export function isTrustBadge(value: string): value is TrustBadge {
  return (TRUST_BADGES as readonly string[]).includes(value);
}

/** Only what a shopper should see: an unknown stored badge is dropped. */
export function visibleBadges(stored: string[] | null | undefined): TrustBadge[] {
  return (stored ?? []).filter(isTrustBadge);
}

/**
 * What an administrator has awarded, out of what a vendor row stores.
 *
 * The row used to take any of four badges by hand, so "High Rating" could sit
 * on a store nobody had reviewed and "Fast Shipping" on one that had never
 * delivered — a claim to a shopper with nothing behind it. A row written
 * before this keeps those values; they are simply not read.
 */
export function awardedBadges(stored: string[] | null | undefined): AwardedBadge[] {
  return (stored ?? []).filter((badge): badge is AwardedBadge => (AWARDED_BADGES as readonly string[]).includes(badge));
}

/** An average this high, over at least this many visible reviews. */
export const HIGH_RATING_FLOOR = 4.5;
export const HIGH_RATING_MIN_REVIEWS = 5;
/** This share of the window's deliveries arrived within this many hours of the order. */
export const FAST_SHIPPING_HOURS = 72;
export const FAST_SHIPPING_SHARE = 0.8;
export const FAST_SHIPPING_MIN_DELIVERIES = 5;
export const FAST_SHIPPING_WINDOW_DAYS = 90;

/** What the storefront's badges are measured from, for one store. */
export type BadgeEvidence = {
  /** The badges an administrator awarded — `awardedBadges` of the row. */
  awarded: readonly AwardedBadge[];
  /** Reviews a shopper can see, across the store's products. */
  reviews: number;
  averageRating: number | null;
  /** Orders with something of theirs delivered in the window, and how many arrived in time. */
  deliveries: number;
  fastDeliveries: number;
};

/**
 * The badges a shopper is shown.
 *
 * A floor on the count as well as on the figure, because one five-star review
 * is an anecdote and a badge built on it is the kind a shopper checks once and
 * never trusts again — the argument `TASTE_FLOOR` makes for "Picked for you".
 */
export function storefrontBadges(evidence: BadgeEvidence): TrustBadge[] {
  const shown: TrustBadge[] = [...evidence.awarded];
  if (evidence.reviews >= HIGH_RATING_MIN_REVIEWS && (evidence.averageRating ?? 0) >= HIGH_RATING_FLOOR) shown.push("highRating");
  if (evidence.deliveries >= FAST_SHIPPING_MIN_DELIVERIES && evidence.fastDeliveries / evidence.deliveries >= FAST_SHIPPING_SHARE) shown.push("fastShipping");
  return shown;
}

export type HealthInputs = {
  /** Published products of this vendor. */
  published: number;
  /** Products currently waiting on an admin. */
  pendingReview: number;
  /** Rejections recorded against them. */
  rejections: number;
  /** Variants at zero on a published product. */
  outOfStock: number;
  /** Variants in total, so out-of-stock is read as a proportion. */
  variants: number;
  /** Mean review score out of 5, when there is one. */
  rating?: number | null;
};

/**
 * The raw figures a component is allowed to show.
 *
 * A closed union rather than a free string: the portal labels each of these,
 * and an unlabelled one would render as a camelCase identifier in the middle
 * of an Arabic sentence. Typed this way, adding a figure here without adding
 * its label is a compile error rather than something a shopper finds.
 */
export type HealthDetailKey =
  | "published"
  | "pendingReview"
  | "outOfStock"
  | "variants"
  | "rejections"
  | "suspendAt"
  | "rating"
  | "outOf";

export type HealthComponent = {
  key: "catalog" | "stock" | "compliance" | "rating";
  /** 0–100, this component's own score. */
  score: number;
  /** The raw numbers behind it, so the vendor can check the arithmetic. */
  detail: Partial<Record<HealthDetailKey, number>>;
};

export type Health = {
  score: number;
  band: "good" | "fair" | "poor";
  components: HealthComponent[];
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Four components, evenly weighted.
 *
 * Even weighting is a deliberate choice over a tuned formula: a vendor can
 * work out why their score moved, which is what the requirement asks for. A
 * weighted blend would be more expressive and less checkable.
 *
 * A vendor with nothing yet scores 100 rather than 0. A new seller has done
 * nothing wrong, and opening on a failing grade would be a judgement about
 * absence rather than performance.
 */
export function vendorHealth(inputs: HealthInputs): Health {
  const components: HealthComponent[] = [];

  // Catalog: is anything actually for sale?
  const listed = inputs.published + inputs.pendingReview;
  components.push({
    key: "catalog",
    score: listed === 0 ? 100 : clamp((inputs.published / listed) * 100),
    detail: { published: inputs.published, pendingReview: inputs.pendingReview },
  });

  // Stock: what share of the shelf can actually be bought?
  components.push({
    key: "stock",
    score: inputs.variants === 0 ? 100 : clamp(((inputs.variants - inputs.outOfStock) / inputs.variants) * 100),
    detail: { outOfStock: inputs.outOfStock, variants: inputs.variants },
  });

  // Compliance: rejections, against the three that trigger suspension.
  components.push({
    key: "compliance",
    score: clamp(100 - (inputs.rejections / 3) * 100),
    detail: { rejections: inputs.rejections, suspendAt: 3 },
  });

  // Rating: absent is not bad. A vendor with no reviews is unproven, and
  // scoring them as if they were poorly reviewed would be a different claim.
  components.push({
    key: "rating",
    score: inputs.rating === null || inputs.rating === undefined ? 100 : clamp((inputs.rating / 5) * 100),
    detail: inputs.rating === null || inputs.rating === undefined ? {} : { rating: inputs.rating, outOf: 5 },
  });

  const score = clamp(components.reduce((sum, part) => sum + part.score, 0) / components.length);
  return { score, band: score >= 80 ? "good" : score >= 55 ? "fair" : "poor", components };
}
