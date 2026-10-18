import { describe, expect, it } from "vitest";
import { FULFILMENT_STATES, isSettled, nextStates } from "./fulfilment.js";

describe("where a line can go next", () => {
  it("offers every other state but returned, so a mis-click can be undone", () => {
    // Deliberately not a strict machine: a seller who marked the wrong line
    // shipped has to be able to put it back, and refusing them turns a
    // mis-click into a support request.
    expect(nextStates("pending")).toEqual(["preparing", "shipped", "delivered", "cancelled"]);
    expect(nextStates("shipped")).toEqual(["pending", "preparing", "delivered", "cancelled"]);
  });

  it("never offers 'returned', because a return is the shopper's act", () => {
    for (const state of FULFILMENT_STATES) {
      expect(nextStates(state)).not.toContain("returned");
    }
  });

  it("leaves a returned line alone", () => {
    expect(nextStates("returned")).toEqual([]);
  });

  /* A cancelled line going straight back to "shipped" would claim a parcel
     that was never packed; reopening it means starting again. */
  it("reopens a cancelled line at the beginning", () => {
    expect(nextStates("cancelled")).toEqual(["pending"]);
  });
});

describe("what counts as finished", () => {
  it("is the three that end the line, and nothing on the way", () => {
    expect(FULFILMENT_STATES.filter(isSettled)).toEqual(["delivered", "cancelled", "returned"]);
  });
});
