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
 * can earn by behaving well would say something else entirely.
 */

export const TRUST_BADGES = ["verified", "fastShipping", "highRating", "topSeller"] as const;
export type TrustBadge = (typeof TRUST_BADGES)[number];

export function isTrustBadge(value: string): value is TrustBadge {
  return (TRUST_BADGES as readonly string[]).includes(value);
}

/** Only what a shopper should see: an unknown stored badge is dropped. */
export function visibleBadges(stored: string[] | null | undefined): TrustBadge[] {
  return (stored ?? []).filter(isTrustBadge);
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

/**
 * Which badges the numbers themselves support.
 *
 * `verified` is never returned here — it is awarded by an admin and read from
 * the vendor row. The rest are earned and are recomputed, so a vendor who
 * stops earning one stops showing it.
 */
export function earnedBadges(inputs: HealthInputs): TrustBadge[] {
  const earned: TrustBadge[] = [];
  const health = vendorHealth(inputs);
  if ((inputs.rating ?? 0) >= 4.5) earned.push("highRating");
  if (inputs.published >= 20 && health.score >= 80) earned.push("topSeller");
  return earned;
}
