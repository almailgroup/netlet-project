import { describe, expect, it } from "vitest";
import {
  addBusinessDays, arrivalFor, isWeekend, resolveSpeed, slowestSpeed, speedForLine, windowFor,
} from "./deliverySpeed.js";

/* 2026-09-23 is a Wednesday; 25th Friday, 26th Saturday, 27th Sunday. */
const WED = new Date("2026-09-23T10:00:00Z");
const THU = new Date("2026-09-24T10:00:00Z");
const FRI = new Date("2026-09-25T10:00:00Z");
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("which band applies", () => {
  it("lets a product override its store", () => {
    expect(resolveSpeed("up_to_week", "next_day")).toBe("next_day");
  });

  /* Null on the product is "no opinion", not a choice of the slowest band. */
  it("inherits the store when the product says nothing", () => {
    expect(resolveSpeed("two_to_four", null)).toBe("two_to_four");
  });

  /* A default would be NetLet making a promise on a seller's behalf. */
  it("is null when neither has said anything", () => {
    expect(resolveSpeed(null, null)).toBeNull();
    expect(resolveSpeed("", undefined)).toBeNull();
  });

  it("ignores a band it does not recognise rather than trusting the column", () => {
    expect(resolveSpeed("next_day", "whenever")).toBe("next_day");
    expect(resolveSpeed("yesterday", null)).toBeNull();
  });
});

describe("the Kuwaiti weekend", () => {
  it("is Friday and Saturday", () => {
    expect(isWeekend(FRI)).toBe(true);
    expect(isWeekend(new Date("2026-09-26T00:00:00Z"))).toBe(true);
    expect(isWeekend(new Date("2026-09-27T00:00:00Z"))).toBe(false);
    expect(isWeekend(WED)).toBe(false);
  });

  /*
   * The whole reason this is not `date + n`: counting calendar days promises a
   * Thursday order on Saturday, which nobody in Kuwait can keep.
   */
  it("steps over it rather than through it", () => {
    expect(day(addBusinessDays(THU, 1))).toBe("2026-09-27");
    expect(day(addBusinessDays(WED, 4))).toBe("2026-09-29");
  });

  /* Zero days still moves off a weekend: a warehouse shut on Friday cannot
     ship that day however fast the band is. */
  it("moves a same-day order off the weekend", () => {
    expect(day(addBusinessDays(FRI, 0))).toBe("2026-09-27");
    expect(day(addBusinessDays(WED, 0))).toBe("2026-09-23");
  });

  /* 22:00 UTC on Thursday is 1am on Friday in Kuwait: the warehouse is shut. */
  it("counts from the day it is in Kuwait, not in UTC", () => {
    const lateThursday = new Date("2026-09-24T22:00:00Z");
    expect(isWeekend(lateThursday)).toBe(true);
    expect(day(addBusinessDays(lateThursday, 0))).toBe("2026-09-27");
    expect(day(addBusinessDays(new Date("2026-09-23T21:30:00Z"), 0))).toBe("2026-09-24");
  });

  it("refuses to travel backwards on a negative", () => {
    expect(day(addBusinessDays(WED, -3))).toBe("2026-09-23");
  });
});

describe("what a band promises", () => {
  it("gives a pair of dates, not one", () => {
    const arrival = arrivalFor("two_to_four", WED);
    expect([day(arrival.from), day(arrival.to)]).toEqual(["2026-09-27", "2026-09-29"]);
  });

  it("is same-day on a working day", () => {
    const arrival = arrivalFor("same_day", WED);
    expect([day(arrival.from), day(arrival.to)]).toEqual(["2026-09-23", "2026-09-23"]);
  });

  /* Inventing a window would turn "we will build it for you" into a date. */
  it("has no dates at all for made to order", () => {
    expect(windowFor("made_to_order")).toBeNull();
    const arrival = arrivalFor("made_to_order", WED);
    expect([arrival.from, arrival.to]).toEqual([null, null]);
  });
});

describe("a basket line", () => {
  /* Two promises about one parcel is how a shopper believes the wrong one. */
  it("has no speed once it is a pre-order", () => {
    expect(speedForLine({ preordered: true }, "next_day", "same_day")).toBeNull();
    expect(speedForLine({ preordered: false }, "next_day", "same_day")).toBe("same_day");
  });
});

describe("a whole basket", () => {
  /* A basket arrives when its last parcel does. */
  it("is as slow as its slowest line", () => {
    expect(slowestSpeed(["same_day", "two_to_four", "next_day"])).toBe("two_to_four");
    expect(slowestSpeed(["next_day", null])).toBe("next_day");
    expect(slowestSpeed([null, null])).toBeNull();
    expect(slowestSpeed(["same_day", "made_to_order"])).toBe("made_to_order");
  });
});
