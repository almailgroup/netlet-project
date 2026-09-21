import { describe, expect, it } from "vitest";
import {
  distributionShare,
  eligibilityFor,
  isValidRating,
  RATING_MAX,
  RATING_MIN,
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
