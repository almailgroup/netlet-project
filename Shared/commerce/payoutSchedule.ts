/**
 * When a seller actually gets paid.
 *
 * Requirement 3.3.21: cash on delivery settles in 14 business days, everything
 * else in 1 to 3. Pure, because it is a date somebody plans their month
 * around, and because a due date you can only check by waiting a fortnight is
 * one nobody checks.
 *
 * ## What this is
 *
 * **A schedule, not a payment run.** Nothing here moves money — NetLet has no
 * payout rail, and 3.2.1 is where that starts. What this answers is "when is
 * this due", which is the question a seller asks and the one NetLet must be
 * able to answer before it can be held to it.
 *
 * **The clock starts when the money arrives, not when the order is placed.**
 * A cash order is placed the moment a shopper presses the button and the cash
 * turns up days later; counting from the press would promise a payout for
 * money NetLet does not hold. For a card order the two are the same instant,
 * which is why the distinction is invisible until cash exists — and cash is
 * exactly what NetLet takes today.
 *
 * **Business days, Kuwaiti weekend.** Friday and Saturday are not working
 * days, so fourteen calendar days lands on a Saturday two times in five.
 * `Shared/commerce/deliverySpeed.ts` makes the same call for the same reason.
 *
 * **A refunded line is not owed and has no due date.** Money that went back is
 * not a payout waiting to happen, and giving it one would have a seller
 * planning around a figure that is already gone.
 */
import { addBusinessDays } from "./deliverySpeed.js";

/**
 * How long each method is held before it settles.
 *
 * Cash is longer because it is the riskier one for NetLet: the money passes
 * through a driver and a reconciliation before anybody is sure it exists,
 * and a payout run that pays out cash that never arrived is unrecoverable.
 * Card money is already in an account when the order completes.
 */
export const SETTLEMENT_DAYS = {
  cod: { min: 14, max: 14 },
  card: { min: 1, max: 3 },
} as const;

export type SettlementKind = keyof typeof SETTLEMENT_DAYS;

/** Which schedule a payment method falls under. */
export function settlementKindFor(paymentMethod: string | null | undefined): SettlementKind {
  /* Anything that is not cash settles on the card schedule. There is nothing
     else today; when there is, the slow path should be the explicit one. */
  return paymentMethod === "cod" ? "cod" : "card";
}

export type DueWindow = { from: Date; to: Date };

/**
 * When a payout becomes due, as a window rather than one date.
 *
 * A window because "1 to 3 business days" is what the schedule says, and
 * collapsing it to its optimistic end is how a shop gets a reputation for
 * paying late. The cash schedule's window is a single day, and `arrivalFor`
 * does the same thing for deliveries.
 */
export function dueWindow(paymentMethod: string | null | undefined, settledAt: Date): DueWindow {
  const span = SETTLEMENT_DAYS[settlementKindFor(paymentMethod)];
  return { from: addBusinessDays(settledAt, span.min), to: addBusinessDays(settledAt, span.max) };
}

/**
 * The date the clock starts from, or null when it has not started.
 *
 * `paid` is the state that means the money is NetLet's to pass on. A cash
 * order sitting at `pending_payment` has no due date at all, because nothing
 * has arrived — and answering with the order date would promise a payout for
 * money nobody has collected.
 */
export function settledAtFor(order: {
  status: string;
  paymentCollectedAt?: Date | string | null;
  placedAt: Date | string;
}): Date | null {
  if (order.status !== "paid") return null;
  const at = order.paymentCollectedAt ?? order.placedAt;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type PayoutDue =
  | { state: "due"; window: DueWindow; overdue: boolean }
  /* Paid for, but the hold has not elapsed. */
  | { state: "held"; window: DueWindow }
  /* Nothing has arrived, so nothing is owed yet. */
  | { state: "unpaid" }
  /* The money went back. Not a payout waiting to happen. */
  | { state: "refunded" };

/**
 * Where one order stands, for the seller reading the schedule.
 *
 * Overdue is reported rather than hidden: a due date that has passed with no
 * payment is exactly the thing a seller needs to see, and a schedule that only
 * ever shows comfortable numbers is one nobody believes.
 */
export function payoutDue(
  order: { status: string; paymentMethod?: string | null; paymentCollectedAt?: Date | string | null; placedAt: Date | string },
  now: Date = new Date(),
): PayoutDue {
  if (order.status === "refunded") return { state: "refunded" };

  const settled = settledAtFor(order);
  if (!settled) return { state: "unpaid" };

  const window = dueWindow(order.paymentMethod, settled);
  if (now.getTime() < window.from.getTime()) return { state: "held", window };
  return { state: "due", window, overdue: now.getTime() > window.to.getTime() };
}
