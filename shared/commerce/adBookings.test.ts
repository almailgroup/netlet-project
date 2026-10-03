import { describe, expect, it } from "vitest";
import {
  AD_RATES,
  MAX_AD_DAYS,
  addDays,
  bookingProblem,
  bookingRoom,
  bookingState,
  cancellable,
  daysInclusive,
  daysRun,
  feeAccrued,
  feeCeiling,
  fullDays,
  isDate,
  kuwaitToday,
  quoteFor,
  runsOn,
  type BookingFacts,
} from "./adBookings.js";

const week: BookingFacts = { startsOn: "2026-10-04", endsOn: "2026-10-10", dailyRate: "10.000", cancelledOn: null };

describe("Kuwaiti days", () => {
  it("rolls over at midnight in Kuwait, not in UTC", () => {
    expect(kuwaitToday(new Date("2026-10-03T20:59:00Z"))).toBe("2026-10-03");
    expect(kuwaitToday(new Date("2026-10-03T21:00:00Z"))).toBe("2026-10-04");
  });

  it("knows a real date from a plausible one", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-31")).toBe(false);
    expect(isDate("2026-2-3")).toBe(false);
    expect(isDate("tomorrow")).toBe(false);
  });

  it("counts both ends of a run", () => {
    expect(daysInclusive("2026-10-04", "2026-10-10")).toBe(7);
    expect(daysInclusive("2026-10-04", "2026-10-04")).toBe(1);
    expect(daysInclusive("2026-10-05", "2026-10-04")).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("asking for a run", () => {
  const today = "2026-10-03";
  it("takes today or later, up to the lead and the length", () => {
    expect(bookingProblem({ startsOn: today, days: 1 }, today)).toBeNull();
    expect(bookingProblem({ startsOn: "2026-10-02", days: 1 }, today)).toBe("ads.inPast");
    expect(bookingProblem({ startsOn: addDays(today, 91), days: 1 }, today)).toBe("ads.tooFarAhead");
    expect(bookingProblem({ startsOn: addDays(today, 90), days: 1 }, today)).toBeNull();
    expect(bookingProblem({ startsOn: today, days: 0 }, today)).toBe("ads.badLength");
    expect(bookingProblem({ startsOn: today, days: MAX_AD_DAYS + 1 }, today)).toBe("ads.badLength");
    expect(bookingProblem({ startsOn: today, days: 1.5 }, today)).toBe("ads.badLength");
    expect(bookingProblem({ startsOn: "2026-13-01", days: 1 }, today)).toBe("ads.badDate");
  });

  it("quotes from the rate card", () => {
    expect(quoteFor("home", 3)).toBe("30.000");
    expect(quoteFor("department", 7)).toBe("21.000");
    expect(AD_RATES.home).toBe("10.000");
  });
});

describe("the fee runs with the days", () => {
  it("charges nothing before it starts", () => {
    expect(feeAccrued(week, "2026-10-03")).toBe(0n);
    expect(bookingState(week, "2026-10-03")).toBe("upcoming");
  });

  it("charges each day it has run, today included", () => {
    expect(feeAccrued(week, "2026-10-04")).toBe(10_000n);
    expect(feeAccrued(week, "2026-10-06")).toBe(30_000n);
    expect(bookingState(week, "2026-10-06")).toBe("running");
  });

  it("stops at the end", () => {
    expect(feeAccrued(week, "2026-11-01")).toBe(70_000n);
    expect(feeCeiling(week)).toBe(70_000n);
    expect(bookingState(week, "2026-10-11")).toBe("ended");
  });

  it("is free to cancel before it starts", () => {
    const early = { ...week, cancelledOn: "2026-10-02" };
    expect(feeAccrued(early, "2026-10-20")).toBe(0n);
    expect(feeCeiling(early)).toBe(0n);
    expect(bookingState(early, "2026-10-05")).toBe("cancelled");
    expect(runsOn(early, "2026-10-04")).toBe(false);
  });

  it("ends the day it is cancelled while running, and charges that day", () => {
    const stopped = { ...week, cancelledOn: "2026-10-05" };
    expect(daysRun(stopped, "2026-10-20")).toBe(2);
    expect(feeAccrued(stopped, "2026-10-20")).toBe(20_000n);
    expect(feeCeiling(stopped)).toBe(20_000n);
    expect(runsOn(stopped, "2026-10-05")).toBe(true);
    expect(runsOn(stopped, "2026-10-06")).toBe(false);
    expect(bookingState(stopped, "2026-10-06")).toBe("ended");
  });

  it("can be cancelled until its last day, and once", () => {
    expect(cancellable(week, "2026-10-10")).toBe(true);
    expect(cancellable(week, "2026-10-11")).toBe(false);
    expect(cancellable({ ...week, cancelledOn: "2026-10-05" }, "2026-10-06")).toBe(false);
  });
});

describe("a place holds so many a day", () => {
  it("names the days that are full and only those", () => {
    const others = [week, { ...week, startsOn: "2026-10-06", endsOn: "2026-10-07" }];
    expect(fullDays(others, "2026-10-05", 4, 2)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(fullDays(others, "2026-10-05", 4, 3)).toEqual([]);
  });

  it("frees a place a cancelled booking was holding", () => {
    const others = [{ ...week, cancelledOn: "2026-10-03" }, week];
    expect(fullDays(others, "2026-10-04", 1, 2)).toEqual([]);
  });
});

describe("booking against what was earned", () => {
  it("is what is owed less what other bookings can still cost", () => {
    expect(bookingRoom(100_000n, [])).toBe(100_000n);
    expect(bookingRoom(100_000n, [{ ceilingFils: 30_000n, deductedFils: 0n }])).toBe(70_000n);
  });

  it("does not count twice a fee already taken off a payout", () => {
    /* After the run: the order is paid (owed 0) and the fee is taken (−30). */
    expect(bookingRoom(0n, [{ ceilingFils: 30_000n, deductedFils: -30_000n }])).toBe(0n);
  });
});
