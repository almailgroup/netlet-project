/**
 * Where an order has got to, in one phrase, for the list of a shopper's orders.
 *
 * The list said only whether the order was paid, and for a cash order that is
 * "awaiting payment" from the moment it is placed until the driver is at the
 * door — so every order on the page carried the same yellow badge, which is the
 * question a shopper is not asking. They are asking where it is. Fulfilment
 * lives on the line (`fulfilment.ts`), so the order's progress is read off its
 * lines: the furthest-behind line that is still coming decides, because an
 * order is not "delivered" while one of its parcels is in a van.
 *
 * A cancelled line is not coming and does not hold the rest back; a returned
 * one arrived and went back. Pure, so the phrase the list draws and the rule
 * behind it are tested without a database.
 */
import type { FulfilmentState } from "./fulfilment.js";

export type ProgressLine = {
  fulfilment: FulfilmentState;
  deliveredAt?: Date | string | null;
  preordered?: boolean;
};

export type OrderProgress =
  | { kind: "cancelled" }
  | { kind: "returned" }
  | { kind: "delivered"; at: string | null }
  | { kind: "partlyDelivered"; delivered: number; of: number }
  | { kind: "onTheWay" }
  | { kind: "preparing" }
  | { kind: "received"; preordered: boolean };

const iso = (value: Date | string | null | undefined) =>
  value == null ? null : typeof value === "string" ? value : value.toISOString();

export function orderProgress(order: { status: string }, lines: ProgressLine[]): OrderProgress {
  const coming = lines.filter(line => line.fulfilment !== "cancelled");
  if (order.status === "cancelled" || coming.length === 0) return { kind: "cancelled" };

  const kept = coming.filter(line => line.fulfilment !== "returned");
  if (kept.length === 0) return { kind: "returned" };

  const delivered = kept.filter(line => line.fulfilment === "delivered");
  if (delivered.length === kept.length) {
    /* The day the last of it arrived, which is the day the order did. */
    const at = delivered.map(line => iso(line.deliveredAt)).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    return { kind: "delivered", at };
  }
  if (delivered.length > 0) return { kind: "partlyDelivered", delivered: delivered.length, of: kept.length };
  if (kept.some(line => line.fulfilment === "shipped")) return { kind: "onTheWay" };
  if (kept.some(line => line.fulfilment === "preparing")) return { kind: "preparing" };
  return { kind: "received", preordered: kept.every(line => line.preordered) };
}
