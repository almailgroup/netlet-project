/**
 * Self-service featured placement (3.3.15): a seller books a place on the
 * shelf by the day, and pays for it out of what they earn.
 *
 * Pure, because what it decides is money a seller is charged — the reason the
 * order arithmetic is pure.
 *
 * ## A slot is a place by the day, and there are only so many
 *
 * Two placements: the home page's sponsored rail, and the top of a department
 * page. Each holds a fixed number of products a day (`AD_CAPACITY`), because
 * a sponsored rail that grows with demand stops being a place anybody looks,
 * and a department whose first screen is all paid placements has stopped
 * being a department. A booking takes one place on each day it runs, and is
 * refused on any day that is already full — named, so the seller can move it.
 *
 * ## The fee runs with the days, and comes off the payout
 *
 * NetLet has no card rail (3.2.1), so a placement is paid for the only way a
 * seller pays NetLet anything today: it is deducted from what NetLet owes
 * them. The fee **accrues a day at a time** — a day the placement ran is a day
 * charged, and a day it did not is not. Cancelling before it starts costs
 * nothing; cancelling while it runs ends it today, and today is charged
 * because it has already been shown. The payout run takes off whatever has
 * accrued and not yet been taken, so there is no separate invoice to chase
 * and no fee charged for a day that never happened.
 *
 * **A seller books against money they have earned.** A booking is refused
 * when its full price is more than the seller's outstanding earnings less
 * everything already committed to other bookings. Without that, a new store
 * with no sales could book a month on the home page and leave NetLet a debt
 * with nothing to recover it from — the platform extending credit by accident.
 *
 * ## The rate is frozen at booking
 *
 * For the reason an order's commission rate is: changing the rate card in
 * October must not change what a booking made in September costs.
 *
 * ## Dates are Kuwait's
 *
 * A placement runs on Kuwaiti calendar days — UTC+3 all year, no daylight
 * saving — because a seller who books "Thursday" means the Thursday on their
 * wall, and a UTC day would start their placement at 3am.
 */
import { fromFils, toFils } from "../money.js";

export const AD_SLOTS = ["home", "department"] as const;
export type AdSlot = (typeof AD_SLOTS)[number];

/** What a day costs, in dinars, at booking time. Frozen onto each booking. */
export const AD_RATES: Record<AdSlot, string> = { home: "10.000", department: "3.000" };

/** How many products each place holds on any one day (per department, for `department`). */
export const AD_CAPACITY: Record<AdSlot, number> = { home: 4, department: 2 };

/** The longest one booking may run. */
export const MAX_AD_DAYS = 30;
/** How far ahead a booking may start. */
export const MAX_AD_LEAD_DAYS = 90;

const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Kuwait, as `YYYY-MM-DD`. */
export function kuwaitToday(now: Date): string {
  return new Date(now.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** A real calendar date in `YYYY-MM-DD`, and not "2026-02-31". */
export function isDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  /* "2026-13-01" is an Invalid Date, whose toISOString throws rather than
     answering, so the time is checked before it is printed. */
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `a` to `b`, inclusive of both; zero when `b` is before `a`. */
export function daysInclusive(a: string, b: string): number {
  const span = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS) + 1;
  return Math.max(0, span);
}

export type BookingProblem = "ads.badDate" | "ads.inPast" | "ads.tooFarAhead" | "ads.badLength";

/** What is wrong with a requested run, or null. */
export function bookingProblem(request: { startsOn: string; days: number }, today: string): BookingProblem | null {
  if (!isDate(request.startsOn)) return "ads.badDate";
  if (!Number.isInteger(request.days) || request.days < 1 || request.days > MAX_AD_DAYS) return "ads.badLength";
  if (request.startsOn < today) return "ads.inPast";
  if (daysInclusive(today, request.startsOn) - 1 > MAX_AD_LEAD_DAYS) return "ads.tooFarAhead";
  return null;
}

/** The facts about one booking that its fee and its days follow from. */
export type BookingFacts = {
  startsOn: string;
  endsOn: string;
  dailyRate: string;
  /** The Kuwaiti day it was cancelled on, or null. */
  cancelledOn: string | null;
};

/**
 * The last day it runs. Cancelling on a day ends it that day; cancelling
 * before it starts leaves it no days at all (an end before its start).
 */
export function effectiveEnd(booking: BookingFacts): string {
  return booking.cancelledOn && booking.cancelledOn < booking.endsOn ? booking.cancelledOn : booking.endsOn;
}

/** Whether it holds a place on this day. */
export function runsOn(booking: BookingFacts, day: string): boolean {
  return booking.startsOn <= day && day <= effectiveEnd(booking);
}

/** Days it has run up to and including `today`. */
export function daysRun(booking: BookingFacts, today: string): number {
  const last = effectiveEnd(booking) < today ? effectiveEnd(booking) : today;
  return daysInclusive(booking.startsOn, last);
}

/** What it has cost so far, in fils: one day's rate for each day it ran. */
export function feeAccrued(booking: BookingFacts, today: string): bigint {
  return BigInt(daysRun(booking, today)) * toFils(booking.dailyRate);
}

/** The most it can ever cost, in fils, as it stands now. */
export function feeCeiling(booking: BookingFacts): bigint {
  return BigInt(daysInclusive(booking.startsOn, effectiveEnd(booking))) * toFils(booking.dailyRate);
}

export type BookingState = "upcoming" | "running" | "ended" | "cancelled";

export function bookingState(booking: BookingFacts, today: string): BookingState {
  /* Cancelled before it ran is cancelled; cancelled while running is a run
     that ended early, which is what the seller needs to read on their page. */
  if (booking.cancelledOn && booking.cancelledOn < booking.startsOn) return "cancelled";
  if (today < booking.startsOn) return "upcoming";
  if (today <= effectiveEnd(booking)) return "running";
  return "ended";
}

/** Whether it can still be cancelled: not already cancelled, and not over. */
export function cancellable(booking: BookingFacts, today: string): boolean {
  return booking.cancelledOn === null && today <= booking.endsOn;
}

/**
 * The days in a run that are already full, given the bookings that overlap
 * it in the same place. Empty means it can be booked.
 */
export function fullDays(existing: BookingFacts[], startsOn: string, days: number, capacity: number): string[] {
  const full: string[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(startsOn, offset);
    if (existing.filter(booking => runsOn(booking, day)).length >= capacity) full.push(day);
  }
  return full;
}

/** The price of a run at today's rate card, as a money string. */
export function quoteFor(slot: AdSlot, days: number): string {
  return fromFils(toFils(AD_RATES[slot]) * BigInt(days));
}

/**
 * What a seller can still commit to new bookings, in fils: what NetLet owes
 * them, less what their other bookings can still cost beyond what has already
 * been taken off a payout.
 */
export function bookingRoom(outstandingFils: bigint, others: { ceilingFils: bigint; deductedFils: bigint }[]): bigint {
  /* `deducted` is stored as the negative it was in the payout run. */
  const committed = others.reduce((sum, booking) => sum + booking.ceilingFils + booking.deductedFils, 0n);
  return outstandingFils - committed;
}
