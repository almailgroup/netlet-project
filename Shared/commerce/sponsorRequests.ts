/**
 * Sponsored products, on the owner's word ("vendors can choose what product
 * they want to sponsor to be shown at the first products shown in the
 * homepage … they can request for sponsor, and the admin will check their
 * request and ask them for the payment"; migration 0089). The home page's
 * sponsored shelf — the four places `AD_CAPACITY.home` holds, the first
 * products the page draws — is reached by asking, not by booking.
 *
 * Pure, for the reason `adBookings.ts` is: what it decides is money a store
 * pays NetLet.
 *
 * ## The steps
 *
 * A store asks for a run of Kuwaiti days for one of its products (`review`).
 * NetLet answers: declined with a reason (`declined`), or approved at a day
 * rate — the rate card's unless NetLet changes it for this request — with a
 * last day to pay (`payment`). The store pays from its earnings, which is
 * taken off its payouts as every placement is and puts it on the shelf at
 * once (`paid`), or by a bank transfer to NetLet's account quoting the
 * request's reference (`sent`), which an administrator confirms (`paid`) or
 * sends back as not received (`payment` again). Until it is paid the store
 * can withdraw it (`withdrawn`). Once paid it is a placement in `ad_bookings`
 * and runs on its days; the request keeps what was asked, said and paid.
 *
 * ## An open request holds its place
 *
 * From the moment it is sent until it is declined, withdrawn or lapses, a
 * request counts against the day's four places, so approving it or paying
 * for it is never refused for room somebody took meanwhile — the home
 * banner's rule. **Expired is derived, never stored**: a request NetLet has
 * not answered by its last day, or a payment not made by its last day to
 * pay, lapses on the read (`sponsorState`), and its place is free from then.
 * A transfer the store has said it sent never lapses: the money may be on
 * its way, and only a person can say it did not arrive.
 *
 * ## A day not shown is never charged
 *
 * Approved after its first day, a request starts on the day of approval and
 * is asked for the days left (`approvedRun`). A transfer confirmed after its
 * first day moves the run to start that day, keeping every day paid for
 * (`confirmedRun`). Paid from earnings, the days accrue and come off payouts
 * as a placement's always have; paid by transfer, the placement is written
 * at no day rate, because nothing comes off a payout for money already in
 * NetLet's account (`payoutRuns.ts` writes no line for nothing owed).
 *
 * ## Dates are Kuwait's
 *
 * `adBookings.ts`'s rule: every date here is a Kuwaiti calendar day.
 */
import { addDays, daysInclusive, isDate } from "./adBookings.js";
import { fromFils, toFils } from "../money.js";

/** Dinars with at most three decimals: the shape a rate is typed in. */
const MONEY_SHAPE = /^\d{1,6}(\.\d{1,3})?$/;

export const SPONSOR_STATUSES = ["review", "payment", "sent", "paid", "declined", "withdrawn"] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];

export const SPONSOR_PAID_WITH = ["earnings", "transfer"] as const;
export type SponsorPaidWith = (typeof SPONSOR_PAID_WITH)[number];

/** A request as it is now: what is stored, and `lapsed` when its time ran out. */
export type SponsorState = SponsorStatus | "lapsed";

/** The store's words to NetLet, and NetLet's back. */
export const SPONSOR_NOTE_MAX = 400;
/** The bank's reference for a transfer, as the store copies it. */
export const SPONSOR_REFERENCE_MAX = 80;
/** How long a store has to pay once asked, unless the run starts sooner. */
export const PAY_WITHIN_DAYS = 3;
/** The day rate NetLet may ask, in dinars. */
export const SPONSOR_MAX_RATE = "999.000";

/** What a request's state follows from. */
export type SponsorFacts = {
  status: SponsorStatus;
  startsOn: string;
  endsOn: string;
  payBy: string | null;
};

/** Where a request stands today. */
export function sponsorState(request: SponsorFacts, today: string): SponsorState {
  if (request.status === "review" && today > request.endsOn) return "lapsed";
  if (request.status === "payment" && request.payBy !== null && today > request.payBy) return "lapsed";
  return request.status;
}

/** Whether it is still in NetLet's or the store's hands, and holds its place. */
export function isOpen(request: SponsorFacts, today: string): boolean {
  const state = sponsorState(request, today);
  return state === "review" || state === "payment" || state === "sent";
}

/**
 * Whether an open request holds a home place on this day. A paid one is
 * counted through the placement it became, never twice.
 */
export function holdsPlaceOn(request: SponsorFacts, day: string, today: string): boolean {
  return isOpen(request, today) && request.startsOn <= day && day <= request.endsOn;
}

/** The run NetLet asks to be paid for: from today when its first day has passed. */
export function approvedRun(request: { startsOn: string; endsOn: string }, today: string, dailyRate: string) {
  const startsOn = request.startsOn < today ? today : request.startsOn;
  const days = daysInclusive(startsOn, request.endsOn);
  return { startsOn, endsOn: request.endsOn, days, total: fromFils(toFils(dailyRate) * BigInt(days)) };
}

/**
 * The run a confirmed transfer buys: as asked, or — confirmed after its first
 * day — the same number of days from today, so no day paid for goes unshown.
 */
export function confirmedRun(request: { startsOn: string; endsOn: string }, today: string) {
  if (request.startsOn >= today) return { startsOn: request.startsOn, endsOn: request.endsOn };
  const days = daysInclusive(request.startsOn, request.endsOn);
  return { startsOn: today, endsOn: addDays(today, days - 1) };
}

/**
 * The last day to pay NetLet suggests: three days from today, but never after
 * the run's first day, and today when that has passed.
 */
export function defaultPayBy(startsOn: string, today: string): string {
  const within = addDays(today, PAY_WITHIN_DAYS);
  if (startsOn <= today) return today;
  return within < startsOn ? within : startsOn;
}

export type PayByProblem = "sponsor.payByBad" | "sponsor.payByPast" | "sponsor.payByLate";

/** What is wrong with the last day to pay NetLet chose, or null. */
export function payByProblem(payBy: string, startsOn: string, today: string): PayByProblem | null {
  if (!isDate(payBy)) return "sponsor.payByBad";
  if (payBy < today) return "sponsor.payByPast";
  /* A run already started, approved today, is paid today. */
  const latest = startsOn < today ? today : startsOn;
  if (payBy > latest) return "sponsor.payByLate";
  return null;
}

export type RateProblem = "sponsor.rateBad" | "sponsor.rateTooHigh";

/** What is wrong with the day rate NetLet asks, or null. Above nothing, in fils. */
export function rateProblem(rate: string): RateProblem | null {
  const text = rate.trim();
  if (!MONEY_SHAPE.test(text) || toFils(text) <= 0n) return "sponsor.rateBad";
  if (toFils(text) > toFils(SPONSOR_MAX_RATE)) return "sponsor.rateTooHigh";
  return null;
}

export type ReferenceProblem = "sponsor.referenceNeeded" | "sponsor.referenceTooLong";

/** What is wrong with the bank's reference a store gives, or null. */
export function referenceProblem(reference: string): ReferenceProblem | null {
  const text = reference.replace(/\s+/g, " ").trim();
  if (text.length < 3) return "sponsor.referenceNeeded";
  if (text.length > SPONSOR_REFERENCE_MAX) return "sponsor.referenceTooLong";
  return null;
}

/** What a store writes on its transfer so NetLet can match it: `SP-12`. */
export function transferReference(id: number): string {
  return `SP-${id}`;
}

/** Days of a paid run NetLet takes down that were not shown, at its rate: what is owed back. */
export function refundFor(run: { startsOn: string; endsOn: string; dailyRate: string }, stoppedOn: string): string {
  /* Stopped on a day it ran, that day was shown; stopped before it began, none was. */
  const firstUnshown = stoppedOn < run.startsOn ? run.startsOn : addDays(stoppedOn, 1);
  const unshown = daysInclusive(firstUnshown, run.endsOn);
  return fromFils(toFils(run.dailyRate) * BigInt(unshown));
}

/** What each side may press, from the request's state — the buttons the API accepts. */
export type SponsorActions = {
  approve: boolean;
  decline: boolean;
  payFromEarnings: boolean;
  sendTransfer: boolean;
  confirmPayment: boolean;
  notReceived: boolean;
  withdraw: boolean;
};

export function sponsorActions(state: SponsorState, side: "store" | "netlet", transferOffered: boolean): SponsorActions {
  const store = side === "store";
  return {
    approve: !store && state === "review",
    decline: !store && (state === "review" || state === "payment" || state === "sent"),
    payFromEarnings: store && state === "payment",
    sendTransfer: store && state === "payment" && transferOffered,
    confirmPayment: !store && state === "sent",
    notReceived: !store && state === "sent",
    withdraw: store && (state === "review" || state === "payment"),
  };
}

/** The four steps a request goes through, as the page draws them. */
export const SPONSOR_STEPS = ["requested", "payment", "live", "ended"] as const;
export type SponsorStep = (typeof SPONSOR_STEPS)[number];

/**
 * Which step it is on, and whether that step stopped it: a decline or a
 * withdrawal at the first two steps, a lapse at the step it ran out on.
 * `placement` is the state of the placement a paid request became.
 */
export function sponsorStep(state: SponsorState, placement: "upcoming" | "running" | "ended" | "cancelled" | null): { step: SponsorStep; stopped: boolean } {
  switch (state) {
    case "review":
      return { step: "requested", stopped: false };
    case "payment":
    case "sent":
      return { step: "payment", stopped: false };
    case "declined":
    case "withdrawn":
      return { step: "requested", stopped: true };
    case "lapsed":
      return { step: "payment", stopped: true };
    case "paid":
      if (placement === "ended") return { step: "ended", stopped: false };
      if (placement === "cancelled") return { step: "live", stopped: true };
      return { step: "live", stopped: false };
  }
}

/**
 * How a run did on the home page against the days before it (on the owner's
 * word: "all the tools needed for the vendor"): home-page views a day during
 * the run beside the same number of days before it, from `product_views`.
 * Null when there is nothing to compare with.
 */
export function liftPercent(during: { views: number; days: number }, before: { views: number; days: number }): number | null {
  if (during.days <= 0 || before.days <= 0 || before.views <= 0) return null;
  const now = during.views / during.days;
  const then = before.views / before.days;
  return Math.round(((now - then) / then) * 100);
}
