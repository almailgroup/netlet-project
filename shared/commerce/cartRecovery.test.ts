import { describe, expect, it } from "vitest";
import { ABANDON_AFTER_HOURS, isAbandoned, recoveryFor, STALE_AFTER_DAYS } from "./cartRecovery.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe("whether a basket was forgotten", () => {
  /* Four hours old is somebody still shopping, and a banner then is nagging. */
  it("says nothing while they are probably still shopping", () => {
    expect(isAbandoned({ updatedAt: hoursAgo(ABANDON_AFTER_HOURS - 1), itemCount: 2 }, NOW)).toBe(false);
  });

  it("says so once it is old enough", () => {
    expect(isAbandoned({ updatedAt: hoursAgo(ABANDON_AFTER_HOURS), itemCount: 2 }, NOW)).toBe(true);
    expect(isAbandoned({ updatedAt: hoursAgo(48), itemCount: 1 }, NOW)).toBe(true);
  });

  /*
   * A cart stores no prices, so an old basket is re-priced when it is read.
   * "You left these" about a basket that costs something else now reads as a
   * shop that changed the price while somebody was away.
   */
  it("stops once the basket is too old to be worth mentioning", () => {
    expect(isAbandoned({ updatedAt: hoursAgo(STALE_AFTER_DAYS * 24 + 1), itemCount: 2 }, NOW)).toBe(false);
  });

  it("is not forgotten if it is empty — it is empty", () => {
    expect(isAbandoned({ updatedAt: hoursAgo(48), itemCount: 0 }, NOW)).toBe(false);
  });

  /* A gap in our own row should not produce a nudge about a basket we cannot
     describe. */
  it("says nothing when the date cannot be read", () => {
    expect(isAbandoned({ updatedAt: null, itemCount: 2 }, NOW)).toBe(false);
    expect(isAbandoned({ updatedAt: "not a date", itemCount: 2 }, NOW)).toBe(false);
  });
});

describe("what to tell them", () => {
  /* The count is the part that does not go stale; a total would. */
  it("carries a count and an age, never a price", () => {
    expect(recoveryFor({ updatedAt: hoursAgo(30), itemCount: 3 }, NOW)).toEqual({
      remind: true,
      itemCount: 3,
      hours: 30,
    });
  });

  it("carries nothing when there is nothing to say", () => {
    expect(recoveryFor({ updatedAt: hoursAgo(1), itemCount: 3 }, NOW)).toEqual({ remind: false });
  });
});
