import { describe, expect, it } from "vitest";
import { earnedBadges, vendorHealth, visibleBadges, type HealthInputs } from "./vendorHealth.js";

const base: HealthInputs = {
  published: 10, pendingReview: 0, rejections: 0, outOfStock: 0, variants: 10, rating: 5,
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
    const health = vendorHealth({ published: 0, pendingReview: 0, rejections: 0, outOfStock: 0, variants: 0, rating: null });
    expect(health.score).toBe(100);
  });

  it("marks an empty shelf down", () => {
    const health = vendorHealth({ ...base, outOfStock: 10 });
    expect(health.components.find(c => c.key === "stock")?.score).toBe(0);
    expect(health.score).toBeLessThan(80);
  });

  it("reaches zero compliance at the three rejections that suspend", () => {
    expect(vendorHealth({ ...base, rejections: 3 }).components.find(c => c.key === "compliance")?.score).toBe(0);
    expect(vendorHealth({ ...base, rejections: 1 }).components.find(c => c.key === "compliance")?.score).toBe(67);
  });

  it("does not punish a vendor for having no reviews yet", () => {
    expect(vendorHealth({ ...base, rating: null }).components.find(c => c.key === "rating")?.score).toBe(100);
  });

  // Transparency is the requirement: every component shows its own numbers.
  it("shows the raw figures behind every component", () => {
    const health = vendorHealth({ ...base, rejections: 1, outOfStock: 2 });
    expect(health.components.find(c => c.key === "compliance")?.detail).toMatchObject({ rejections: 1, suspendAt: 3 });
    expect(health.components.find(c => c.key === "stock")?.detail).toMatchObject({ outOfStock: 2, variants: 10 });
  });

  it("bands a middling vendor as fair rather than good", () => {
    const health = vendorHealth({ ...base, rejections: 2, outOfStock: 4, rating: 3 });
    expect(health.band).toBe("fair");
  });
});

describe("trust badges", () => {
  it("earns a high rating badge only at 4.5 and above", () => {
    expect(earnedBadges({ ...base, rating: 4.5 })).toContain("highRating");
    expect(earnedBadges({ ...base, rating: 4.4 })).not.toContain("highRating");
  });

  it("needs both a real catalog and a good score for top seller", () => {
    expect(earnedBadges({ ...base, published: 20, variants: 20 })).toContain("topSeller");
    expect(earnedBadges({ ...base, published: 19, variants: 19 })).not.toContain("topSeller");
  });

  // Verification means a human checked documents. It cannot be earned by
  // behaving well, or the badge would mean something different to a buyer.
  it("never awards verified from behaviour", () => {
    expect(earnedBadges({ ...base, published: 500, variants: 500 })).not.toContain("verified");
  });

  it("drops a stored badge it does not recognise", () => {
    expect(visibleBadges(["verified", "not-a-badge", "fastShipping"])).toEqual(["verified", "fastShipping"]);
    expect(visibleBadges(null)).toEqual([]);
  });
});
