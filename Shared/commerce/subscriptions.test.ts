import { describe, expect, it } from "vitest";
import {
  MAX_SUBSCRIPTION_PERCENT,
  nextRunAfter,
  savingPercent,
  subscriberPrice,
  subscriptionProblem,
  withinCeiling,
} from "./subscriptions.js";

describe("the saving", () => {
  it("is the store's while its permit is valid, nothing without one, and absent when not offered", () => {
    expect(savingPercent("10.00", true)).toBe(10);
    expect(savingPercent("10.00", false)).toBe(0);
    expect(savingPercent("0", true)).toBe(0);
    expect(savingPercent(null, true)).toBeNull();
    expect(savingPercent("90", true)).toBe(MAX_SUBSCRIPTION_PERCENT);
  });

  it("comes off the shelf in fils, rounded the shopper's way", () => {
    expect(subscriberPrice("10.000", 10)).toBe("9.000");
    expect(subscriberPrice("1.999", 5)).toBe("1.899"); // 1.89905 → down
    expect(subscriberPrice("3.000", 7.5)).toBe("2.775");
    expect(subscriberPrice("3.000", 0)).toBe("3.000");
  });

  it("is never charged above what the shopper agreed to", () => {
    expect(withinCeiling("9.000", "9.000")).toBe(true);
    expect(withinCeiling("8.500", "9.000")).toBe(true);
    expect(withinCeiling("9.001", "9.000")).toBe(false);
  });
});

describe("the schedule", () => {
  it("moves on by the interval", () => {
    expect(nextRunAfter("2026-10-04", 2, "2026-10-04")).toBe("2026-10-18");
    expect(nextRunAfter("2026-12-28", 1, "2026-12-28")).toBe("2027-01-04");
  });

  it("does not try to catch up on missed runs", () => {
    /* Down for five weeks on a fortnightly order: one run, then the next date ahead. */
    expect(nextRunAfter("2026-09-01", 2, "2026-10-06")).toBe("2026-10-13");
  });
});

describe("asking to subscribe", () => {
  const today = "2026-10-04";
  const ok = { intervalWeeks: 2, quantity: 1, firstRunOn: "2026-10-05" };
  it("starts tomorrow at the earliest and within the window", () => {
    expect(subscriptionProblem(ok, today)).toBeNull();
    expect(subscriptionProblem({ ...ok, firstRunOn: today }, today)).toBe("subscriptions.tooSoon");
    expect(subscriptionProblem({ ...ok, firstRunOn: "2026-12-31" }, today)).toBe("subscriptions.tooFar");
    expect(subscriptionProblem({ ...ok, firstRunOn: "2026-02-30" }, today)).toBe("subscriptions.badDate");
  });

  it("takes only a household cadence and a sane quantity", () => {
    expect(subscriptionProblem({ ...ok, intervalWeeks: 3 }, today)).toBe("subscriptions.badInterval");
    expect(subscriptionProblem({ ...ok, quantity: 0 }, today)).toBe("subscriptions.badQuantity");
    expect(subscriptionProblem({ ...ok, quantity: 21 }, today)).toBe("subscriptions.badQuantity");
  });
});
