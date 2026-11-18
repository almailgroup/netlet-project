import { describe, expect, it } from "vitest";
import {
  approvedRun,
  confirmedRun,
  defaultPayBy,
  holdsPlaceOn,
  liftPercent,
  payByProblem,
  rateProblem,
  referenceProblem,
  refundFor,
  sponsorActions,
  sponsorState,
  sponsorStep,
  transferReference,
} from "./sponsorRequests";

const asked = { status: "review" as const, startsOn: "2026-12-10", endsOn: "2026-12-16", payBy: null };

describe("where a request stands", () => {
  it("lapses when NetLet does not answer by its last day, and when a payment is not made by its last day to pay", () => {
    expect(sponsorState(asked, "2026-12-16")).toBe("review");
    expect(sponsorState(asked, "2026-12-17")).toBe("lapsed");
    const owing = { ...asked, status: "payment" as const, payBy: "2026-12-09" };
    expect(sponsorState(owing, "2026-12-09")).toBe("payment");
    expect(sponsorState(owing, "2026-12-10")).toBe("lapsed");
  });

  it("never lapses once the store says it sent the money", () => {
    expect(sponsorState({ ...asked, status: "sent", payBy: "2026-12-09" }, "2027-01-30")).toBe("sent");
  });

  it("holds its place on its days while open, and nothing once it lapses or is answered", () => {
    expect(holdsPlaceOn(asked, "2026-12-12", "2026-12-01")).toBe(true);
    expect(holdsPlaceOn(asked, "2026-12-17", "2026-12-01")).toBe(false);
    expect(holdsPlaceOn({ ...asked, status: "payment", payBy: "2026-12-05" }, "2026-12-12", "2026-12-06")).toBe(false);
    expect(holdsPlaceOn({ ...asked, status: "declined" }, "2026-12-12", "2026-12-01")).toBe(false);
    /* A paid one is counted through its placement, never twice. */
    expect(holdsPlaceOn({ ...asked, status: "paid" }, "2026-12-12", "2026-12-01")).toBe(false);
  });
});

describe("what NetLet asks for", () => {
  it("is the run as asked, or the days left when its first day has passed", () => {
    expect(approvedRun(asked, "2026-12-01", "10.000")).toEqual({ startsOn: "2026-12-10", endsOn: "2026-12-16", days: 7, total: "70.000" });
    expect(approvedRun(asked, "2026-12-13", "8.500")).toEqual({ startsOn: "2026-12-13", endsOn: "2026-12-16", days: 4, total: "34.000" });
  });

  it("suggests three days to pay, never after the first day, and today once it has passed", () => {
    expect(defaultPayBy("2026-12-10", "2026-12-01")).toBe("2026-12-04");
    expect(defaultPayBy("2026-12-03", "2026-12-01")).toBe("2026-12-03");
    expect(defaultPayBy("2026-12-01", "2026-12-01")).toBe("2026-12-01");
    expect(defaultPayBy("2026-11-28", "2026-12-01")).toBe("2026-12-01");
  });

  it("refuses a last day to pay in the past, after the first day, or not a day at all", () => {
    expect(payByProblem("2026-12-05", "2026-12-10", "2026-12-01")).toBeNull();
    expect(payByProblem("2026-11-30", "2026-12-10", "2026-12-01")).toBe("sponsor.payByPast");
    expect(payByProblem("2026-12-11", "2026-12-10", "2026-12-01")).toBe("sponsor.payByLate");
    expect(payByProblem("2026-02-31", "2026-12-10", "2026-12-01")).toBe("sponsor.payByBad");
    /* Started already: paid today. */
    expect(payByProblem("2026-12-13", "2026-12-10", "2026-12-13")).toBeNull();
  });

  it("takes a day rate above nothing, in dinars and fils", () => {
    expect(rateProblem("10.000")).toBeNull();
    expect(rateProblem("7.5")).toBeNull();
    expect(rateProblem("0")).toBe("sponsor.rateBad");
    expect(rateProblem("-3")).toBe("sponsor.rateBad");
    expect(rateProblem("1.2345")).toBe("sponsor.rateBad");
    expect(rateProblem("ten")).toBe("sponsor.rateBad");
    expect(rateProblem("1000")).toBe("sponsor.rateTooHigh");
  });
});

describe("paying", () => {
  it("keeps every day paid for when a transfer is confirmed late", () => {
    expect(confirmedRun(asked, "2026-12-09")).toEqual({ startsOn: "2026-12-10", endsOn: "2026-12-16" });
    expect(confirmedRun(asked, "2026-12-12")).toEqual({ startsOn: "2026-12-12", endsOn: "2026-12-18" });
  });

  it("asks for a bank reference of at least three characters", () => {
    expect(referenceProblem("  ")).toBe("sponsor.referenceNeeded");
    expect(referenceProblem("FT2611")).toBeNull();
    expect(referenceProblem("x".repeat(81))).toBe("sponsor.referenceTooLong");
  });

  it("names what to write on the transfer", () => {
    expect(transferReference(42)).toBe("SP-42");
  });

  it("owes back the days a transfer paid for that will not be shown", () => {
    const run = { startsOn: "2026-12-10", endsOn: "2026-12-16", dailyRate: "10.000" };
    expect(refundFor(run, "2026-12-05")).toBe("70.000");
    expect(refundFor(run, "2026-12-10")).toBe("60.000");
    expect(refundFor(run, "2026-12-16")).toBe("0.000");
  });
});

describe("the buttons", () => {
  it("gives each side only what it may press", () => {
    expect(sponsorActions("review", "netlet", true)).toMatchObject({ approve: true, decline: true, confirmPayment: false, withdraw: false });
    expect(sponsorActions("review", "store", true)).toMatchObject({ approve: false, withdraw: true, payFromEarnings: false });
    expect(sponsorActions("payment", "store", true)).toMatchObject({ payFromEarnings: true, sendTransfer: true, withdraw: true });
    expect(sponsorActions("payment", "store", false)).toMatchObject({ payFromEarnings: true, sendTransfer: false });
    expect(sponsorActions("sent", "store", true)).toMatchObject({ withdraw: false, sendTransfer: false });
    expect(sponsorActions("sent", "netlet", true)).toMatchObject({ confirmPayment: true, notReceived: true, decline: true });
    expect(Object.values(sponsorActions("lapsed", "netlet", true)).some(Boolean)).toBe(false);
    expect(Object.values(sponsorActions("paid", "store", true)).some(Boolean)).toBe(false);
  });

  it("draws the step it is on, and whether it stopped there", () => {
    expect(sponsorStep("review", null)).toEqual({ step: "requested", stopped: false });
    expect(sponsorStep("declined", null)).toEqual({ step: "requested", stopped: true });
    expect(sponsorStep("lapsed", null)).toEqual({ step: "payment", stopped: true });
    expect(sponsorStep("paid", "upcoming")).toEqual({ step: "live", stopped: false });
    expect(sponsorStep("paid", "ended")).toEqual({ step: "ended", stopped: false });
    expect(sponsorStep("paid", "cancelled")).toEqual({ step: "live", stopped: true });
  });
});

describe("how a run did", () => {
  it("compares views a day with the days before, and says nothing with nothing to compare", () => {
    expect(liftPercent({ views: 140, days: 7 }, { views: 70, days: 7 })).toBe(100);
    expect(liftPercent({ views: 35, days: 7 }, { views: 70, days: 7 })).toBe(-50);
    expect(liftPercent({ views: 35, days: 7 }, { views: 0, days: 7 })).toBeNull();
    expect(liftPercent({ views: 0, days: 0 }, { views: 70, days: 7 })).toBeNull();
  });
});
