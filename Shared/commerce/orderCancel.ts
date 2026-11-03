/**
 * Whether the shopper may cancel their own order, and if not, why.
 *
 * **Until a driver has it, on the owner's word** ("if the order already
 * picked by the driver then need to receive then return"). An order whose
 * every line still coming is `pending` or `preparing` — still in the stores'
 * hands — is the shopper's to take back with one press. Once a driver has
 * collected any of it (`shipped`), the whole order cannot be called back: the
 * items not yet collected can still be cancelled one by one
 * (`Shared/commerce/orderChanges.ts`), and what is on the road is received and
 * then returned. It was "while nothing has started" — pending alone — until
 * the owner moved the line to the driver's pickup.
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
  /** A driver has collected something, or something has arrived. */
  | "orders.cancelStarted"
  /** The cash has been collected. */
  | "orders.cancelPaid";

export type CancelState = { cancellable: true } | { cancellable: false; reason: CancelRefusal };

export function shopperCancelState(order: { status: string }, lines: { fulfilment: FulfilmentState }[]): CancelState {
  if (order.status === "cancelled" || order.status === "refunded") return { cancellable: false, reason: "orders.cancelClosed" };
  if (order.status !== "pending_payment") return { cancellable: false, reason: "orders.cancelPaid" };
  const coming = lines.filter(line => line.fulfilment !== "cancelled");
  if (coming.length === 0) return { cancellable: false, reason: "orders.cancelClosed" };
  if (coming.some(line => line.fulfilment !== "pending" && line.fulfilment !== "preparing")) return { cancellable: false, reason: "orders.cancelStarted" };
  return { cancellable: true };
}
