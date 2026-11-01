/**
 * Whether the shopper may cancel their own order, and if not, why.
 *
 * **While nothing has started, on the owner's word.** An order whose every
 * line still coming is `pending` — no store has begun preparing anything — is
 * the shopper's to take back with one press. Once a store has moved a line on,
 * somebody is packing it, and cancelling becomes the store's decision (they
 * cancel a line they cannot fill) or, after it arrives, a return.
 *
 * Only an unpaid order: every order here is cash on delivery, so "paid" means
 * a driver has already been to the door, and taking back a paid order is a
 * refund wearing the wrong name — the rule `setLineFulfilment` holds for a
 * seller too.
 *
 * A line a store already cancelled is not coming and does not hold the rest:
 * an order of three with one cancelled by its store and two pending can still
 * be cancelled. Pure and shared, so the page offers exactly what the API
 * accepts, and the server asks it again under a lock on the lines.
 */
import type { FulfilmentState } from "./fulfilment.js";

export type CancelRefusal =
  /** Cancelled or refunded already, or nothing left in it. */
  | "orders.cancelClosed"
  /** A store has started preparing or sent something. */
  | "orders.cancelStarted"
  /** The cash has been collected. */
  | "orders.cancelPaid";

export type CancelState = { cancellable: true } | { cancellable: false; reason: CancelRefusal };

export function shopperCancelState(order: { status: string }, lines: { fulfilment: FulfilmentState }[]): CancelState {
  if (order.status === "cancelled" || order.status === "refunded") return { cancellable: false, reason: "orders.cancelClosed" };
  if (order.status !== "pending_payment") return { cancellable: false, reason: "orders.cancelPaid" };
  const coming = lines.filter(line => line.fulfilment !== "cancelled");
  if (coming.length === 0) return { cancellable: false, reason: "orders.cancelClosed" };
  if (coming.some(line => line.fulfilment !== "pending")) return { cancellable: false, reason: "orders.cancelStarted" };
  return { cancellable: true };
}
