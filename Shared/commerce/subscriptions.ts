/**
 * Subscribe & Save (3.1.19): the same thing, delivered again on a schedule.
 *
 * Pure, because what it decides is money a shopper is charged without pressing
 * anything — the strongest version of the reason the order arithmetic is pure.
 *
 * ## A standing order is a promise about price
 *
 * Nobody re-reads a product page before the fourth delivery of rice. So each
 * subscription carries a **price ceiling**: the per-unit price the shopper saw
 * when they subscribed. A run never charges above it. If the shelf has risen
 * past it — or the seller's saving has stopped — the run is not placed and the
 * subscription pauses until the shopper looks at the new price and says yes.
 * Charging somebody more than they agreed to, on a schedule, without asking,
 * is the one thing this feature must never do. A price that *falls* is simply
 * passed on.
 *
 * ## The saving is the seller's, and it is a discount
 *
 * A store opts in with a percentage; null means it does not offer
 * subscriptions at all, zero means it does at the shelf price. The saving comes
 * off the line's own price, so it comes out of the seller's net the way an
 * agreed price does — NetLet does not fund it. And because "Subscribe and save
 * 10%" is an advertised saving, Kuwaiti law wants a Ministry of Commerce
 * discount permit for it, exactly as for a struck-through price: without a
 * valid permit the saving is zero, on the page and at every run.
 *
 * ## Nothing is placed at the moment of subscribing
 *
 * Subscribing records an instruction and the first delivery date; the run
 * places each order, through the ordinary checkout, so stock, the
 * cash-on-delivery ceiling and each seller's delivery fee all apply the way
 * they do to an order somebody pressed a button for.
 */
import { fromFils, toFils } from "../money.js";

/** How often, in weeks. A short list rather than a free number: every one is a cadence a household actually runs on. */
export const SUBSCRIPTION_INTERVALS = [1, 2, 4, 8] as const;
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

/** The most a store may take off for subscribing. A saving larger than this is a price, not an incentive. */
export const MAX_SUBSCRIPTION_PERCENT = 30;
/** The most of one thing a standing order may carry. */
export const MAX_SUBSCRIPTION_QUANTITY = 20;
/** How far ahead the first delivery may be set. */
export const MAX_FIRST_RUN_DAYS = 60;
/** How many subscriptions one shopper may hold at once. */
export const MAX_SUBSCRIPTIONS = 30;

export function isInterval(value: number): value is SubscriptionInterval {
  return (SUBSCRIPTION_INTERVALS as readonly number[]).includes(value);
}

/**
 * The saving that applies now: the store's percentage while its discount
 * permit is valid, zero otherwise, and null when the store does not offer
 * subscriptions at all.
 */
export function savingPercent(storePercent: string | number | null | undefined, permitValid: boolean): number | null {
  if (storePercent === null || storePercent === undefined || storePercent === "") return null;
  const percent = Number(storePercent);
  if (!Number.isFinite(percent) || percent < 0) return null;
  return permitValid ? Math.min(percent, MAX_SUBSCRIPTION_PERCENT) : 0;
}

/**
 * The per-unit price a subscriber pays: the shelf less the saving, in fils,
 * rounded **down** — a rounding that has to fall one way falls the shopper's.
 */
export function subscriberPrice(listPrice: string, percent: number): string {
  const list = toFils(listPrice);
  if (percent <= 0) return fromFils(list);
  /* Percent to two places, as hundredths, so 7.5% stays exact. */
  const hundredths = BigInt(Math.round(percent * 100));
  return fromFils((list * (10_000n - hundredths)) / 10_000n);
}

/** Whether a run may be placed at this price, against the ceiling the shopper agreed to. */
export function withinCeiling(price: string, ceiling: string): boolean {
  return toFils(price) <= toFils(ceiling);
}

/* ------------------------------------------------------------- the days --- */

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The next delivery day after a run on `from`, never on or before `today`.
 *
 * A run that was missed — the scheduler down for a fortnight — does not place
 * three orders to catch up. It places one and moves on to the next date in the
 * cadence that is still ahead, which is what somebody who orders rice every
 * two weeks actually wants.
 */
export function nextRunAfter(from: string, weeks: SubscriptionInterval, today: string): string {
  let next = addDays(from, weeks * 7);
  while (next <= today) next = addDays(next, weeks * 7);
  return next;
}

export type SubscriptionProblem =
  | "subscriptions.badInterval"
  | "subscriptions.badQuantity"
  | "subscriptions.badDate"
  | "subscriptions.tooSoon"
  | "subscriptions.tooFar";

/**
 * What is wrong with a request to subscribe, or null. The first delivery is
 * tomorrow at the earliest: today's run may already have happened.
 */
export function subscriptionProblem(request: { intervalWeeks: number; quantity: number; firstRunOn: string }, today: string): SubscriptionProblem | null {
  if (!isInterval(request.intervalWeeks)) return "subscriptions.badInterval";
  if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > MAX_SUBSCRIPTION_QUANTITY) return "subscriptions.badQuantity";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.firstRunOn) || !Number.isFinite(Date.parse(`${request.firstRunOn}T00:00:00Z`))
    || new Date(`${request.firstRunOn}T00:00:00Z`).toISOString().slice(0, 10) !== request.firstRunOn) return "subscriptions.badDate";
  if (request.firstRunOn <= today) return "subscriptions.tooSoon";
  if (request.firstRunOn > addDays(today, MAX_FIRST_RUN_DAYS)) return "subscriptions.tooFar";
  return null;
}

/** Why a subscription is waiting rather than running. */
export const PAUSE_REASONS = ["byShopper", "priceRose", "noAddress", "unavailable", "refused"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** What the last run did, for the shopper's page. */
export const RUN_OUTCOMES = ["placed", "outOfStock"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];
