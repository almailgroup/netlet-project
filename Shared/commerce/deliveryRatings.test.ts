/**
 * Rating a delivery, apart from what was delivered (3.4.4).
 */
import { describe, expect, it } from "vitest";
import {
  cleanDeliveryComment,
  DELIVERY_RATING_WINDOW_DAYS,
  deliveryRatingState,
  MAX_DELIVERY_COMMENT,
  parcelArrivedAt,
  scoresByCarrier,
  overallOf,
  partsValid,
} from "./deliveryRatings.js";

const day = 24 * 60 * 60 * 1000;
const arrived = new Date("2026-09-10T10:00:00Z");

describe("when a parcel arrived", () => {
  it("is when the last of its lines arrived", () => {
    expect(parcelArrivedAt([
      { deliveredAt: "2026-09-10T10:00:00Z" },
      { deliveredAt: new Date("2026-09-10T10:05:00Z") },
    ])?.toISOString()).toBe("2026-09-10T10:05:00.000Z");
  });

  /* Half a box at the door is not a delivery anybody can rate. */
  it("has not happened while any line is still out", () => {
    expect(parcelArrivedAt([{ deliveredAt: arrived }, { deliveredAt: null }])).toBeNull();
    expect(parcelArrivedAt([])).toBeNull();
  });
});

describe("whether it may be rated", () => {
  it("waits for the parcel to arrive", () => {
    expect(deliveryRatingState(null, arrived)).toEqual({ allowed: false, reason: "delivery.notArrived" });
  });

  it("is open from arrival until the window closes, and says when", () => {
    const state = deliveryRatingState(arrived, new Date(arrived.getTime() + day));
    expect(state.allowed).toBe(true);
    if (state.allowed) expect(state.closesAt.getTime()).toBe(arrived.getTime() + DELIVERY_RATING_WINDOW_DAYS * day);
  });

  /* A rating months on is about a memory, not a delivery. */
  it("closes after the window", () => {
    const late = new Date(arrived.getTime() + (DELIVERY_RATING_WINDOW_DAYS + 1) * day);
    expect(deliveryRatingState(arrived, late)).toEqual({ allowed: false, reason: "delivery.ratingClosed" });
  });
});

describe("a comment", () => {
  it("is null when it says nothing, and flattened when it does", () => {
    expect(cleanDeliveryComment("   \n ")).toBeNull();
    expect(cleanDeliveryComment(null)).toBeNull();
    expect(cleanDeliveryComment("  left it\n\nin the rain ")).toBe("left it in the rain");
    expect(cleanDeliveryComment("x".repeat(MAX_DELIVERY_COMMENT + 50))).toHaveLength(MAX_DELIVERY_COMMENT);
  });
});

describe("three parts (3.4.4)", () => {
  it("make the overall as their average, half up, and each must be whole stars", () => {
    expect(overallOf({ speed: 3, condition: 5, conduct: 5 })).toBe(4);
    expect(overallOf({ speed: 4, condition: 5, conduct: 5 })).toBe(5);
    expect(overallOf({ speed: 1, condition: 1, conduct: 2 })).toBe(1);
    expect(partsValid({ speed: 3, condition: 5, conduct: 5 })).toBe(true);
    expect(partsValid({ speed: 3, condition: 5 })).toBe(false);
    expect(partsValid({ speed: 3, condition: 6, conduct: 5 })).toBe(false);
  });
});

describe("each company's score", () => {
  it("is summed per carrier, busiest first, and a seller's own van is its own row", () => {
    const scores = scoresByCarrier([
      { courierId: 2, rating: 5 }, { courierId: 2, rating: 4 },
      { courierId: 1, rating: 1 },
      { courierId: null, rating: 3 }, { courierId: 2, rating: 3 },
    ]);
    expect(scores.map(score => score.courierId)).toEqual([2, null, 1]);
    expect(scores[0].summary).toMatchObject({ count: 3, average: 4 });
  });

  it("averages each part over the ratings that gave it", () => {
    const [score] = scoresByCarrier([
      { courierId: 1, rating: 4, speed: 3, condition: 5, conduct: 4 },
      { courierId: 1, rating: 2, speed: 2, condition: 2, conduct: 1 },
      { courierId: 1, rating: 5 },
    ]);
    expect(score.parts).toEqual({ speed: 2.5, condition: 3.5, conduct: 2.5 });
  });

  /* "0.0 from 0" reads as a bad company rather than a new one. */
  it("leaves out a company nobody has rated rather than scoring it zero", () => {
    expect(scoresByCarrier([])).toEqual([]);
    expect(scoresByCarrier([{ courierId: 1, rating: 9 }])).toEqual([]);
  });
});
