import { describe, expect, it } from "vitest";
import { awardedBadges, storefrontBadges, vendorHealth, visibleBadges, type BadgeEvidence, type HealthInputs } from "./vendorHealth.js";

const base: HealthInputs = {
  published: 10, pendingReview: 0, warnings: 0, outOfStock: 0, variants: 10, rating: 5,
};

describe("account health", () => {
  it("gives a clean vendor full marks", () => {
    const health = vendorHealth(base);
    expect(health.score).toBe(100);
    expect(health.band).toBe("good");
  });

  // A new seller has done nothing wrong. Opening on a failing grade would be a
  // judgement about absence rather than performance.
  it("opens a brand-new vendor at the top, not the bottom", () => {
    const health = vendorHealth({ published: 0, pendingReview: 0, warnings: 0, outOfStock: 0, variants: 0, rating: null });
    expect(health.score).toBe(100);
  });

  it("marks an empty shelf down", () => {
    const health = vendorHealth({ ...base, outOfStock: 10 });
    expect(health.components.find(c => c.key === "stock")?.score).toBe(0);
    expect(health.score).toBeLessThan(80);
  });

  it("reaches zero compliance at the three warnings that suspend", () => {
    expect(vendorHealth({ ...base, warnings: 3 }).components.find(c => c.key === "compliance")?.score).toBe(0);
    expect(vendorHealth({ ...base, warnings: 1 }).components.find(c => c.key === "compliance")?.score).toBe(67);
  });

  it("does not punish a vendor for having no reviews yet", () => {
    expect(vendorHealth({ ...base, rating: null }).components.find(c => c.key === "rating")?.score).toBe(100);
  });

  // Transparency is the requirement: every component shows its own numbers.
  it("shows the raw figures behind every component", () => {
    const health = vendorHealth({ ...base, warnings: 1, outOfStock: 2 });
    expect(health.components.find(c => c.key === "compliance")?.detail).toMatchObject({ warnings: 1, suspendAt: 3 });
    expect(health.components.find(c => c.key === "stock")?.detail).toMatchObject({ outOfStock: 2, variants: 10 });
  });

  it("bands a middling vendor as fair rather than good", () => {
    const health = vendorHealth({ ...base, warnings: 2, outOfStock: 4, rating: 3 });
    expect(health.band).toBe("fair");
  });
});

describe("trust badges", () => {
  const none: BadgeEvidence = { awarded: [], reviews: 0, averageRating: null, deliveries: 0, fastDeliveries: 0 };

  it("shows nothing for a store with nothing behind it", () => {
    expect(storefrontBadges(none)).toEqual([]);
  });

  it("earns a high rating at 4.5 over five reviews, and not on fewer", () => {
    expect(storefrontBadges({ ...none, reviews: 5, averageRating: 4.5 })).toEqual(["highRating"]);
    expect(storefrontBadges({ ...none, reviews: 5, averageRating: 4.4 })).toEqual([]);
    /* One glowing review is an anecdote. */
    expect(storefrontBadges({ ...none, reviews: 4, averageRating: 5 })).toEqual([]);
  });

  it("earns fast shipping from delivery times, on enough deliveries", () => {
    expect(storefrontBadges({ ...none, deliveries: 10, fastDeliveries: 8 })).toEqual(["fastShipping"]);
    expect(storefrontBadges({ ...none, deliveries: 10, fastDeliveries: 7 })).toEqual([]);
    expect(storefrontBadges({ ...none, deliveries: 4, fastDeliveries: 4 })).toEqual([]);
  });

  // Verification means a human checked documents. It cannot be earned by
  // behaving well, or the badge would mean something different to a buyer —
  // and nothing else can be awarded by hand, or it would mean nothing at all.
  it("takes verified only from an administrator, and only verified", () => {
    expect(storefrontBadges({ ...none, reviews: 500, averageRating: 5, deliveries: 500, fastDeliveries: 500 })).not.toContain("verified");
    expect(awardedBadges(["verified", "fastShipping", "highRating", "topSeller"])).toEqual(["verified"]);
    expect(storefrontBadges({ ...none, awarded: awardedBadges(["verified", "highRating"]) })).toEqual(["verified"]);
  });

  it("drops a stored badge it does not recognise", () => {
    expect(visibleBadges(["verified", "not-a-badge", "fastShipping"])).toEqual(["verified", "fastShipping"]);
    expect(visibleBadges(null)).toEqual([]);
  });
});
