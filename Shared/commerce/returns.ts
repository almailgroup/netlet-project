/**
 * Whether a line can still be sent back, and if not, why.
 *
 * Pure, for the reason permissions and commission are pure: a return decides
 * money — it moves an order toward `refunded` and a line toward `returned` —
 * and a rule you can only exercise by shipping something and waiting two weeks
 * is a rule nobody checks. Both sides import this, so the page cannot offer a
 * return the API would refuse.
 *
 * It answers with message keys rather than sentences, the way `refusalFor`
 * does, so the server and the page cannot word the same refusal two different
 * ways and Arabic is not an afterthought.
 *
 * **The two lifecycles stay separate here too.** A return needs *both*: the
 * money has to have been taken (an unpaid order has nothing to refund) and the
 * goods have to have arrived (you cannot send back what has not come). Asking
 * only one of those is how a shopper gets offered a return on a parcel that is
 * still in a van.
 */

/**
 * How long after delivery a return can be asked for.
 *
 * Fourteen days is the ordinary Gulf retail window and a placeholder until
 * NetLet's own policy is decided — it is one constant precisely so that
 * decision is one edit rather than a hunt. Consumer-protection rules in Kuwait
 * set a floor for defective goods that no policy here can shorten; this is the
 * change-of-mind window, which is the one a storefront chooses.
 */
export const RETURN_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a line cannot be returned. Every one is a message key. */
export type ReturnBlock =
  | "returns.blockedUnpaid"
  | "returns.blockedNotDelivered"
  | "returns.blockedCancelled"
  | "returns.blockedAlreadyReturned"
  | "returns.blockedRefunded"
  | "returns.blockedWindowClosed";

export type ReturnState =
  | { returnable: true; closesAt: Date; daysLeft: number }
  | { returnable: false; reason: ReturnBlock };

/** The order facts a return depends on — the money half. */
export type ReturnableOrder = {
  status: "pending_payment" | "paid" | "cancelled" | "refunded";
};

/** The line facts a return depends on — the warehouse half. */
export type ReturnableLine = {
  fulfilment: "pending" | "preparing" | "shipped" | "delivered" | "cancelled" | "returned";
  /**
   * When this line was handed over.
   *
   * Explicitly passed rather than read off the row, because `order_items` has
   * no `delivered_at` column yet and the caller currently stands `updated_at`
   * in for it. That stand-in is wrong in one direction — any later edit to the
   * line pushes the window out — so the substitution is the caller's to make
   * and to remove, and this function stays correct either way. Null means the
   * date is unknown, which is not the same as the window having closed.
   */
  deliveredAt: Date | null;
};

/**
 * The state of a single line's return eligibility.
 *
 * Order of the checks is deliberate and is the order a shopper would ask them
 * in. "You never paid for this" outranks "the window closed", because a window
 * on a purchase that never happened is a confusing thing to be told; and
 * `returned` outranks `refunded` so a line already sent back says so rather
 * than blaming the order's money state.
 */
export function returnStateFor(
  order: ReturnableOrder,
  line: ReturnableLine,
  now: Date = new Date(),
  windowDays: number = RETURN_WINDOW_DAYS,
): ReturnState {
  if (line.fulfilment === "returned") return { returnable: false, reason: "returns.blockedAlreadyReturned" };
  if (line.fulfilment === "cancelled") return { returnable: false, reason: "returns.blockedCancelled" };

  if (order.status === "cancelled") return { returnable: false, reason: "returns.blockedCancelled" };
  if (order.status === "refunded") return { returnable: false, reason: "returns.blockedRefunded" };
  if (order.status !== "paid") return { returnable: false, reason: "returns.blockedUnpaid" };

  if (line.fulfilment !== "delivered") return { returnable: false, reason: "returns.blockedNotDelivered" };

  /*
   * Delivered and paid, but nobody recorded when. Treated as open rather than
   * closed: refusing a return because of a missing timestamp on our side puts
   * the cost of our own gap on the shopper.
   */
  if (!line.deliveredAt) return { returnable: true, closesAt: new Date(now.getTime() + windowDays * DAY_MS), daysLeft: windowDays };

  const closesAt = new Date(line.deliveredAt.getTime() + windowDays * DAY_MS);
  if (now.getTime() >= closesAt.getTime()) return { returnable: false, reason: "returns.blockedWindowClosed" };

  /*
   * Rounded up, so a window with four hours left reads "1 day left" rather
   * than "0 days left" on something that is in fact still returnable. Saying
   * zero next to an open return is the kind of contradiction that makes
   * somebody not bother trying.
   */
  return { returnable: true, closesAt, daysLeft: Math.ceil((closesAt.getTime() - now.getTime()) / DAY_MS) };
}

/** Whether any line on an order can still go back — what a list row needs. */
export function orderHasReturnableLine(
  order: ReturnableOrder,
  lines: ReturnableLine[],
  now: Date = new Date(),
  windowDays: number = RETURN_WINDOW_DAYS,
): boolean {
  return lines.some(line => returnStateFor(order, line, now, windowDays).returnable);
}
