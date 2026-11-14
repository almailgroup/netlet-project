import { describe, expect, it } from "vitest";
import { isFinal, progressOf, STATUSES, toneOf } from "./status.js";

describe("a parcel's progress", () => {
  it("counts the milestones it has reached", () => {
    expect(progressOf("created", ["created"])).toEqual({ reached: 0, drawn: true });
    expect(progressOf("picked_up", ["created", "picked_up"])).toEqual({ reached: 1, drawn: true });
    expect(progressOf("out_for_delivery", ["created", "picked_up", "in_transit", "out_for_delivery"])).toEqual({ reached: 3, drawn: true });
    expect(progressOf("delivered", ["created", "delivered"])).toEqual({ reached: 4, drawn: true });
  });

  it("keeps how far it got when something goes wrong", () => {
    expect(progressOf("on_hold", ["created", "picked_up", "in_transit", "out_for_delivery", "on_hold"]).reached).toBe(3);
    /* A failed attempt means it went out with a driver, even if nobody recorded that. */
    expect(progressOf("attempted", ["created", "picked_up", "attempted"]).reached).toBe(3);
  });

  it("is not drawn for a parcel going back or cancelled", () => {
    expect(progressOf("returned", ["created", "picked_up", "returned"]).drawn).toBe(false);
    expect(progressOf("cancelled", ["created", "cancelled"]).drawn).toBe(false);
  });

  it("gives every status a tone, and ends the road at three", () => {
    for (const status of STATUSES) expect(toneOf(status)).toBeTruthy();
    expect(STATUSES.filter(isFinal)).toEqual(["delivered", "returned", "cancelled"]);
  });
});
