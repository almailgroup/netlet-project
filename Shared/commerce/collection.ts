/**
 * What an order is still owed, once some of it is not arriving.
 *
 * Pure, for the reason the order arithmetic is: what it decides is money a
 * shopper hands a driver.
 *
 * `orders.grand_total` is frozen at checkout and is right to be — an order is an
 * obligation, and every number in it is copied at the moment of sale. But it is
 * the obligation *as placed*. A seller who is out of sofas cancels that line,
 * and the order still reads the sofa's price, so the board told the driver to
 * collect KWD 267.400 for a delivery of cushions and olive oil. Nothing
 * recomputes the frozen total — this subtracts from it what is no longer coming,
 * using the figures that were frozen beside it.
 *
 * **What comes off is what was frozen for it, and nothing is re-priced.** A
 * line's own total, as charged — which already carries its add-ons
 * (`freezeLine` folds them in so `commission + vendorNet === lineTotal` holds),
 * so they are not subtracted a second time. A seller's delivery fee comes
 * off only when *every* line they were sending to that door is gone — one sofa
 * cancelled out of three items still needs the van.
 *
 * **Order-level reductions stay whole.** A discount, points or a gift card were
 * given against the order, and this does not claw any of them back when part of
 * it falls away; a shopper who lost a line to a seller's stock-out keeps the
 * whole discount on what remains. That errs toward the shopper, the direction
 * this codebase picks wherever a rule has to choose, and the figure is floored
 * at zero so a large voucher on a small remainder cannot turn into a debt.
 */
import { fromFils, toFils } from "../money.js";
import type { FrozenDelivery } from "./delivery.js";
import type { FulfilmentState } from "./fulfilment.js";

/** A line the shopper is not receiving: cancelled before it left, or sent back. */
export function isKept(state: FulfilmentState | string): boolean {
  return state !== "cancelled" && state !== "returned";
}

export type OwedLine = {
  vendorId: number | null;
  /** The destination's label, or null for the order's own address — the key delivery was frozen against. */
  destinationLabel: string | null;
  /** As frozen: the units and their add-ons together. */
  lineTotal: string;
  fulfilment: FulfilmentState | string;
};

export type StillOwed = {
  /** What the shopper owes now. */
  owed: string;
  /** The goods no longer coming, add-ons included. */
  droppedGoods: string;
  /** The delivery fees of sellers with nothing left to send to a door. */
  droppedDelivery: string;
  /** Whether anything came off — so a page draws the explanation only when there is one. */
  reduced: boolean;
};

const doorKey = (vendorId: number | null, label: string | null | undefined) => `${vendorId ?? "none"}|${label ?? ""}`;

export function stillOwed(
  order: { grandTotal: string; deliveryBreakdown: FrozenDelivery | null },
  lines: OwedLine[],
): StillOwed {
  let droppedGoods = 0n;
  const doors = new Map<string, { kept: number; gone: number }>();

  for (const line of lines) {
    const key = doorKey(line.vendorId, line.destinationLabel);
    const door = doors.get(key) ?? { kept: 0, gone: 0 };
    if (isKept(line.fulfilment)) {
      door.kept += 1;
    } else {
      door.gone += 1;
      droppedGoods += toFils(line.lineTotal);
    }
    doors.set(key, door);
  }

  let droppedDelivery = 0n;
  for (const charge of order.deliveryBreakdown ?? []) {
    const door = doors.get(doorKey(charge.vendorId, charge.destinationLabel));
    /* A fee with no lines behind it at all is not this function's to drop: it
       means the breakdown and the lines disagree, and quietly zeroing a charge
       is the wrong way to find that out. */
    if (door && door.kept === 0 && door.gone > 0) droppedDelivery += toFils(charge.fee);
  }

  const before = toFils(order.grandTotal);
  const after = before - droppedGoods - droppedDelivery;
  const owed = after > 0n ? after : 0n;
  return {
    owed: fromFils(owed),
    droppedGoods: fromFils(droppedGoods),
    droppedDelivery: fromFils(droppedDelivery),
    reduced: owed !== before,
  };
}
