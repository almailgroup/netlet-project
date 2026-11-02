import { describe, expect, it } from "vitest";
import {
  distributionPercent,
  distributionShare,
  eligibilityFor,
  heldAs,
  holdOf,
  isValidRating,
  isWritten,
  moderationVerdict,
  RATING_MAX,
  RATING_MIN,
  reviewState,
  summarise,
} from "./reviews.js";

const delivered = new Date("2026-06-01T10:00:00Z");

describe("who may review", () => {
  it("allows a paid, delivered, unreviewed line", () => {
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: delivered, reviewed: false }))
      .toEqual({ allowed: true });
  });

  /* The whole point of the requirement: not just bought, actually arrived. */
  it("refuses a purchase that has not arrived", () => {
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: null, reviewed: false }))
      .toEqual({ allowed: false, reason: "notDelivered" });
  });

  it("refuses an order that was never paid for", () => {
    expect(eligibilityFor({ orderStatus: "pending_payment", deliveredAt: delivered, reviewed: false }))
      .toEqual({ allowed: false, reason: "notPaid" });
    expect(eligibilityFor({ orderStatus: "cancelled", deliveredAt: delivered, reviewed: false }))
      .toEqual({ allowed: false, reason: "notPaid" });
  });

  /*
   * A refund is the most useful review on the shop. Filtering it out would
   * quietly bias the shelf towards happy endings.
   */
  it("allows a refunded order, because that opinion is the point", () => {
    expect(eligibilityFor({ orderStatus: "refunded", deliveredAt: delivered, reviewed: false }))
      .toEqual({ allowed: true });
  });

  it("refuses a second review of the same line", () => {
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: delivered, reviewed: true }))
      .toEqual({ allowed: false, reason: "alreadyReviewed" });
  });

  /* Reasons are ordered by what the shopper hits first, not by rule order. */
  it("names the earliest blocker when more than one applies", () => {
    expect(eligibilityFor({ orderStatus: "pending_payment", deliveredAt: null, reviewed: true }))
      .toEqual({ allowed: false, reason: "notPaid" });
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: null, reviewed: true }))
      .toEqual({ allowed: false, reason: "notDelivered" });
  });

  it("reads a stored timestamp string the same as a Date", () => {
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: delivered.toISOString(), reviewed: false }).allowed).toBe(true);
    expect(eligibilityFor({ orderStatus: "paid", deliveredAt: "not a date", reviewed: false }))
      .toEqual({ allowed: false, reason: "notDelivered" });
  });
});

describe("a valid rating", () => {
  it("is one of the five whole stars", () => {
    for (let star = RATING_MIN; star <= RATING_MAX; star++) expect(isValidRating(star)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
  });
});

describe("summarising", () => {
  /*
   * Null, not a zero-valued summary: "0.0 out of 5 from 0 reviews" reads as a
   * bad product rather than a new one.
   */
  it("is null with nothing to say", () => {
    expect(summarise([])).toBeNull();
    expect(summarise([0, 6, 2.5])).toBeNull();
  });

  it("averages to one decimal place", () => {
    expect(summarise([5, 4])!.average).toBe(4.5);
    expect(summarise([5, 4, 4])!.average).toBe(4.3);
    expect(summarise([1, 2])!.average).toBe(1.5);
  });

  it("always carries all five bars, including the empty ones", () => {
    const summary = summarise([5, 5, 3])!;
    expect(summary.count).toBe(3);
    expect(summary.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 });
  });

  it("ignores a rating outside the scale rather than counting it", () => {
    const summary = summarise([5, 9, 4, -1])!;
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4.5);
  });
});

describe("the histogram", () => {
  it("is a share of the total, and the shares sum to one", () => {
    const summary = summarise([5, 5, 4, 1])!;
    const share = distributionShare(summary);
    expect(share[5]).toBeCloseTo(0.5);
    expect(share[4]).toBeCloseTo(0.25);
    expect(share[1]).toBeCloseTo(0.25);
    expect(share[3]).toBe(0);
    expect(Object.values(share).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("the breakdown's percentages", () => {
  it("are whole numbers that add up to one hundred", () => {
    const summary = summarise([5, 5, 4])!;
    const percent = distributionPercent(summary);
    expect(percent[5] + percent[4]).toBe(100);
    expect(percent).toEqual({ 1: 0, 2: 0, 3: 0, 4: 33, 5: 67 });
  });

  it("gives a star nobody chose nothing, however the rest round", () => {
    const summary = summarise([5, 4, 3])!;
    const percent = distributionPercent(summary);
    expect(Object.values(percent).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percent[1]).toBe(0);
    expect(percent[2]).toBe(0);
  });

  it("reads one rating as all of it", () => {
    expect(distributionPercent(summarise([2])!)).toEqual({ 1: 0, 2: 100, 3: 0, 4: 0, 5: 0 });
  });
});

describe("moderation", () => {
  const quiet = { answered: true, concern: null };
  const silent = { answered: false, concern: null };

  it("shows a clean review at once", () => {
    expect(moderationVerdict({ suspicious: false, hasPhotos: false, model: quiet })).toEqual({ publish: true });
    expect(moderationVerdict({ suspicious: false, hasPhotos: true, model: quiet })).toEqual({ publish: true });
  });

  it("shows words with no model to read them, since the contact filter has already been asked", () => {
    expect(moderationVerdict({ suspicious: false, hasPhotos: false, model: silent })).toEqual({ publish: true });
  });

  it("keeps photos nobody looked at for a person", () => {
    expect(moderationVerdict({ suspicious: false, hasPhotos: true, model: silent })).toEqual({ publish: false, reason: "photos", concern: null });
  });

  it("keeps what the model raised, with its words, and what fraud watch judged high-risk", () => {
    expect(moderationVerdict({ suspicious: false, hasPhotos: false, model: { answered: true, concern: "An insult." } }))
      .toEqual({ publish: false, reason: "flagged", concern: "An insult." });
    expect(moderationVerdict({ suspicious: true, hasPhotos: false, model: quiet })).toEqual({ publish: false, reason: "suspicious", concern: null });
  });

  it("writes and reads a hold back through the hidden reason", () => {
    expect(holdOf(heldAs("flagged", "  Shows  a card. "))).toEqual({ reason: "flagged", concern: "Shows a card." });
    expect(holdOf(heldAs("photos"))).toEqual({ reason: "photos", concern: null });
    expect(holdOf("Spam")).toBeNull();
    expect(holdOf(null)).toBeNull();
    expect(heldAs("flagged", "x".repeat(400)).length).toBe(200);
  });

  it("tells its author whether it is shown, waiting or taken down", () => {
    expect(reviewState({ hiddenAt: null, hiddenReason: null })).toBe("published");
    expect(reviewState({ hiddenAt: new Date(), hiddenReason: heldAs("checking") })).toBe("waiting");
    expect(reviewState({ hiddenAt: new Date(), hiddenReason: "Not about the product" })).toBe("removed");
    expect(reviewState({ hiddenAt: new Date(), hiddenReason: null })).toBe("removed");
  });
});

describe("what is listed", () => {
  it("lists words or photos, and counts a bare rating only in the stars", () => {
    expect(isWritten({ title: null, body: null })).toBe(false);
    expect(isWritten({ title: "  ", body: null, photos: [] })).toBe(false);
    expect(isWritten({ title: "Good", body: null })).toBe(true);
    expect(isWritten({ title: null, body: null, photos: ["/media/x.webp"] })).toBe(true);
  });
});
