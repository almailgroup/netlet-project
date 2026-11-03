/**
 * What a shopper may change about their own order before a driver collects
 * it, and what each change does to the money — on the owner's word: "Cancel
 * an order or individual eligible products (if the order already picked by
 * the driver then need to receive then return)", "Modify order … before
 * delivery pick up", "Change delivery address … before sending the products,
 * and we recalculate if he needs to pay extra fees".
 *
 * Pure and shared, for the reason the cancel rule is: the page offers exactly
 * what the API accepts, and the server asks the same questions again under a
 * lock on the lines.
 *
 * ## Before the driver has it
 *
 * A line may change while it is `pending` or `preparing` — the store may have
 * begun packing it, but it is still in the store's hands. `shipped` is the
 * driver's press of "collected" (`moveParcel`), and from then it is on the
 * road: receive it, then return it. Only an unpaid order, because every order
 * here is cash on delivery and a paid one has been to the door.
 *
 * ## Lowering a quantity splits the line
 *
 * Three ordered and two wanted is the line restated for two, from its frozen
 * unit price, its frozen add-ons and its frozen commission terms — and a
 * cancelled sibling for the one, carrying exactly the difference of every
 * figure. Nothing is re-priced and nothing is lost: the order's lines still add
 * up to what was placed, finance reads the cancelled part as void (it already
 * reads a cancelled line so), `stillOwed` takes it off what the driver
 * collects, and the order shows what became of the third. A set bought as a
 * bundle is priced as a set, so it changes only with the whole order.
 *
 * ## What it does to the money
 *
 * The goods kept are settled again in `settle`'s own order — the code, then the
 * points, then the card — against what remains, so a change can never keep a
 * reduction the smaller order would not have earned:
 *
 * - **A store's free-delivery threshold** is measured against what is still
 *   going to that door. A door that was free *because* the order cleared the
 *   threshold, and no longer does, pays the store's fee — said before the
 *   shopper confirms. A member's is waived, as it was at the sale.
 * - **A discount code** is asked again: below its minimum spend it comes off
 *   (and its use goes back to the shopper), and a percentage is of what
 *   remains. Never more than it was.
 * - **Points and a gift card** stay whole while they fit, and what no longer
 *   fits goes back — the card's balance, then the points — rather than being
 *   spent on goods nobody is receiving.
 */
import { addMoney, compareMoney, fromFils, toFils } from "../money.js";
import { commissionFor } from "../inventory/commission.js";
import { vendorAffiliateFils } from "./affiliate.js";
import { stillOwed } from "./collection.js";
import type { DeliveryRule, FrozenDelivery } from "./delivery.js";
import type { FulfilmentState } from "./fulfilment.js";
import { discountOf, settle, type DiscountCode } from "./vouchers.js";

/** A line still in the store's hands: the shopper may change it. */
export const CHANGEABLE: readonly FulfilmentState[] = ["pending", "preparing"];

export function lineMayChange(line: { fulfilment: FulfilmentState | string }): boolean {
  return (CHANGEABLE as readonly string[]).includes(line.fulfilment);
}

/** Why a change is refused, each a message key. */
export type ChangeRefusal =
  /** Cancelled or refunded already, or nothing left in it. */
  | "orders.changeClosed"
  /** The cash has been collected. */
  | "orders.changePaid"
  /** Everything still coming is with the driver or has arrived. */
  | "orders.changeCollected"
  /** A line named that is not on the order, or not one that can change. */
  | "orders.changeLineGone"
  /** A quantity that is not lower than the one ordered. */
  | "orders.changeNotLower"
  /** A line bought as part of a set. */
  | "orders.changeBundle"
  /** Nothing asked for. */
  | "orders.changeNothing"
  /** The money moved between the quote and the press. */
  | "orders.changeMoved";

export type ChangeState = { changeable: true } | { changeable: false; reason: ChangeRefusal };

/** Whether anything on the order may still be changed by its shopper. */
export function shopperChangeState(order: { status: string }, lines: { fulfilment: FulfilmentState | string }[]): ChangeState {
  if (order.status === "cancelled" || order.status === "refunded") return { changeable: false, reason: "orders.changeClosed" };
  if (order.status !== "pending_payment") return { changeable: false, reason: "orders.changePaid" };
  const coming = lines.filter(line => line.fulfilment !== "cancelled");
  if (coming.length === 0) return { changeable: false, reason: "orders.changeClosed" };
  if (!coming.some(lineMayChange)) return { changeable: false, reason: "orders.changeCollected" };
  return { changeable: true };
}

/**
 * Whether the order's own address may change: every line going there that is
 * still coming is in the store's hands. A line sent to an address of its own
 * (3.2.6) keeps its own, so it does not hold the order's back.
 */
export function addressChangeState(
  order: { status: string },
  lines: { fulfilment: FulfilmentState | string; destination?: unknown | null }[],
): ChangeState {
  const base = shopperChangeState(order, lines);
  if (!base.changeable) return base;
  const home = lines.filter(line => line.fulfilment !== "cancelled" && !line.destination);
  if (home.length === 0) return { changeable: false, reason: "orders.changeClosed" };
  if (!home.every(lineMayChange)) return { changeable: false, reason: "orders.changeCollected" };
  return { changeable: true };
}

/** One change asked for: the line and the quantity wanted, nought to take it out. */
export type LineChange = { lineId: number; quantity: number };

/** A line as the change rules need it — every figure as frozen at the sale. */
export type ChangeLine = {
  id: number;
  fulfilment: FulfilmentState | string;
  vendorId: number | null;
  vendorName: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  commissionPercent: string;
  commissionFixed: string;
  commissionAmount: string;
  vendorNet: string;
  affiliateVendorPercent: string | null;
  /** The add-ons on one unit, summed, as charged. */
  addonsPerUnit: string;
  bundleId: number | null;
  deliveryChoice: string;
  /** Where this line goes when not to the order's own address — its label is the door's. */
  destinationLabel: string | null;
};

/** The figures of a split: what stays on the line, and what the cancelled sibling carries. */
export type LineSplit = {
  kept: { quantity: number; lineTotal: string; commissionAmount: string; vendorNet: string };
  gone: { quantity: number; lineTotal: string; commissionAmount: string; vendorNet: string };
};

/**
 * A line restated for fewer units, and the difference.
 *
 * The kept part is priced the way `freezeLine` priced the whole — the frozen
 * unit price and add-ons, the frozen commission terms, the store's affiliate
 * share where the line carried one — and the gone part is the original less
 * it, so the two always add up to what was frozen, to the fil. Null when the
 * line does not price that way (it was not frozen by `freezeLine`'s rule),
 * because restating a line by a rule it was not priced by would invent money.
 */
export function splitLine(line: ChangeLine, keep: number): LineSplit | null {
  const quantity = Math.trunc(line.quantity);
  const kept = Math.trunc(keep);
  if (kept < 1 || kept >= quantity) return null;

  const priced = (units: number) => {
    const total = toFils(line.unitPrice) * BigInt(units) + toFils(line.addonsPerUnit) * BigInt(units);
    const split = commissionFor(line.unitPrice, units, { percent: line.commissionPercent, fixed: line.commissionFixed }, null, fromFils(toFils(line.addonsPerUnit) * BigInt(units)));
    let commission = toFils(split.commission);
    let net = toFils(split.net);
    /* The store's affiliate share is carried inside the commission (3.7.1). */
    const share = vendorAffiliateFils(fromFils(total), line.affiliateVendorPercent);
    if (share > 0n && share <= net) {
      commission += share;
      net -= share;
    }
    return { total, commission, net };
  };

  /* The rule must reproduce the line as it was frozen, or it is not this rule's to split. */
  const whole = priced(quantity);
  if (whole.total !== toFils(line.lineTotal) || whole.commission !== toFils(line.commissionAmount) || whole.net !== toFils(line.vendorNet)) return null;

  const part = priced(kept);
  return {
    kept: { quantity: kept, lineTotal: fromFils(part.total), commissionAmount: fromFils(part.commission), vendorNet: fromFils(part.net) },
    gone: {
      quantity: quantity - kept,
      lineTotal: fromFils(whole.total - part.total),
      commissionAmount: fromFils(whole.commission - part.commission),
      vendorNet: fromFils(whole.net - part.net),
    },
  };
}

/** What the change does to one line, as the quote says it. */
export type QuotedLine = { lineId: number; from: number; to: number };

/** A store's fee the change adds, because what is left no longer clears its threshold. */
export type AddedFee = { vendorId: number | null; vendorName: string; destinationLabel: string | null; fee: string; waived: boolean };

export type ChangeQuote = {
  lines: QuotedLine[];
  /** What the driver collects now, and after. */
  owedBefore: string;
  owedAfter: string;
  /** Delivery fees the change brings in. */
  addedFees: AddedFee[];
  /** The discount before and after, and whether the code no longer applies at all. */
  discountBefore: string;
  discountAfter: string;
  codeLost: boolean;
  /** Stored value that no longer fits and goes back. */
  giftCardBack: string;
  pointsBack: string;
};

/** The order's money as frozen, and what the settle needs. */
export type ChangeOrder = {
  status: string;
  grandTotal: string;
  member: boolean;
  discountCode: string | null;
  discountValue: string;
  pointsValue: string;
  giftCardValue: string;
  deliveryBreakdown: FrozenDelivery | null;
};

type Door = { key: string; vendorId: number | null; label: string | null; fast: boolean };

const doorOf = (line: Pick<ChangeLine, "vendorId" | "destinationLabel" | "deliveryChoice">): Door => {
  const fast = line.deliveryChoice === "fast";
  return { key: `${line.vendorId ?? "none"}|${line.destinationLabel ?? ""}|${fast ? "fast" : ""}`, vendorId: line.vendorId, label: line.destinationLabel, fast };
};

const rowKey = (row: FrozenDelivery[number]) => `${row.vendorId ?? "none"}|${row.destinationLabel ?? ""}|${row.choice === "fast" ? "fast" : ""}`;

/** The goods still coming to each door. */
function goodsByDoor(lines: Pick<ChangeLine, "vendorId" | "destinationLabel" | "deliveryChoice" | "fulfilment" | "lineTotal">[]): Map<string, bigint> {
  const by = new Map<string, bigint>();
  for (const line of lines) {
    if (line.fulfilment === "cancelled" || line.fulfilment === "returned") continue;
    const key = doorOf(line).key;
    by.set(key, (by.get(key) ?? 0n) + toFils(line.lineTotal));
  }
  return by;
}

/**
 * The lines as they would be after the changes, or the refusal. Lowering a
 * line splits it (`splitLine`); nought cancels it whole. Lines not named are
 * as they are.
 */
export function linesAfter(
  order: { status: string },
  lines: ChangeLine[],
  changes: LineChange[],
): { lines: ChangeLine[]; quoted: QuotedLine[] } | { refused: ChangeRefusal } {
  const state = shopperChangeState(order, lines);
  if (!state.changeable) return { refused: state.reason };
  const asked = new Map<number, number>();
  for (const change of changes) asked.set(change.lineId, Math.trunc(change.quantity));
  if (asked.size === 0) return { refused: "orders.changeNothing" };

  const out: ChangeLine[] = [];
  const quoted: QuotedLine[] = [];
  for (const line of lines) {
    const want = asked.get(line.id);
    if (want === undefined) {
      out.push(line);
      continue;
    }
    asked.delete(line.id);
    if (!lineMayChange(line)) return { refused: "orders.changeLineGone" };
    if (want < 0 || want >= line.quantity) return { refused: "orders.changeNotLower" };
    if (line.bundleId !== null) return { refused: "orders.changeBundle" };
    quoted.push({ lineId: line.id, from: line.quantity, to: want });
    if (want === 0) {
      out.push({ ...line, fulfilment: "cancelled" });
      continue;
    }
    const split = splitLine(line, want);
    if (!split) return { refused: "orders.changeNotLower" };
    out.push({ ...line, ...split.kept });
    out.push({ ...line, id: -line.id, fulfilment: "cancelled", ...split.gone });
  }
  if (asked.size > 0) return { refused: "orders.changeLineGone" };
  return { lines: out, quoted };
}

/**
 * The delivery breakdown after the change: a door that was free because the
 * goods cleared the store's threshold, and no longer do, takes the store's
 * fee (`rules`, the store's as it reads now) — waived for a member, the way
 * the sale waived it. Doors with nothing left are `stillOwed`'s to drop.
 */
export function deliveryAfter(
  breakdown: FrozenDelivery | null,
  before: ChangeLine[],
  after: ChangeLine[],
  rules: ReadonlyMap<number | null, DeliveryRule>,
  member: boolean,
): { breakdown: FrozenDelivery; added: AddedFee[] } {
  const rows = (breakdown ?? []).map(row => ({ ...row }));
  const was = goodsByDoor(before);
  const now = goodsByDoor(after);
  const added: AddedFee[] = [];
  for (const row of rows) {
    if (row.choice === "fast") continue;
    if (toFils(row.fee) !== 0n || row.waived) continue;
    const key = rowKey(row);
    const kept = now.get(key) ?? 0n;
    if (kept === 0n) continue;
    const rule = rules.get(row.vendorId);
    const flat = rule?.flat ? toFils(rule.flat) : 0n;
    const threshold = rule?.freeOver ? toFils(rule.freeOver) : null;
    if (flat <= 0n || threshold === null) continue;
    /* Free because it cleared the threshold, and no longer does. */
    if ((was.get(key) ?? 0n) < threshold || kept >= threshold) continue;
    const fee = fromFils(flat);
    if (member) {
      row.waived = fee;
    } else {
      row.fee = fee;
    }
    added.push({ vendorId: row.vendorId, vendorName: row.vendorName, destinationLabel: row.destinationLabel ?? null, fee, waived: member });
  }
  return { breakdown: rows, added };
}

/**
 * The discount a code gives what remains: nothing below its minimum spend, a
 * percentage of what remains, and never more than it gave the order. A code
 * that no longer exists keeps what it gave, up to the goods.
 */
export function discountAfter(code: Pick<DiscountCode, "kind" | "value" | "minSpend"> | null, frozen: string, goods: string): string {
  const cap = (amount: string) => (compareMoney(amount, frozen) > 0 ? frozen : amount);
  if (toFils(frozen) === 0n) return "0.000";
  if (!code) return cap(compareMoney(goods, frozen) < 0 ? goods : frozen);
  if (code.minSpend && compareMoney(goods, code.minSpend) < 0) return "0.000";
  return cap(discountOf(code, goods));
}

/**
 * The whole quote: what the driver collects before and after, and why it
 * moved. The order's new frozen figures come with it, for the server to write.
 */
export function quoteChange(input: {
  order: ChangeOrder;
  lines: ChangeLine[];
  changes: LineChange[];
  code: Pick<DiscountCode, "kind" | "value" | "minSpend"> | null;
  rules: ReadonlyMap<number | null, DeliveryRule>;
}):
  | { refused: ChangeRefusal }
  | {
      quote: ChangeQuote;
      lines: ChangeLine[];
      write: { breakdown: FrozenDelivery; deliveryAdded: string; waivedAdded: string; discountValue: string; pointsValue: string; giftCardValue: string; grandTotal: string };
    } {
  const { order, lines, changes } = input;
  const owedLines = (set: ChangeLine[]) => set.map(line => ({ vendorId: line.vendorId, destinationLabel: line.destinationLabel, lineTotal: line.lineTotal, fulfilment: line.fulfilment, choice: line.deliveryChoice }));
  const before = stillOwed(order, owedLines(lines));

  const next = linesAfter(order, lines, changes);
  if ("refused" in next) return next;

  const delivery = deliveryAfter(order.deliveryBreakdown, lines, next.lines, input.rules, order.member);
  const deliveryAdded = delivery.added.filter(fee => !fee.waived).reduce((sum, fee) => sum + toFils(fee.fee), 0n);
  const waivedAdded = delivery.added.filter(fee => fee.waived).reduce((sum, fee) => sum + toFils(fee.fee), 0n);

  /* What is still coming, and the delivery still charged for it. */
  const dropped = stillOwed({ grandTotal: "0.000", deliveryBreakdown: delivery.breakdown }, owedLines(next.lines));
  const keptGoods = next.lines
    .filter(line => line.fulfilment !== "cancelled" && line.fulfilment !== "returned")
    .reduce((sum, line) => sum + toFils(line.lineTotal), 0n);
  const chargedDelivery = delivery.breakdown.reduce((sum, row) => sum + toFils(row.fee), 0n) - toFils(dropped.droppedDelivery);

  const discount = discountAfter(input.code, order.discountValue, fromFils(keptGoods));
  const settled = settle({
    goods: fromFils(keptGoods),
    delivery: fromFils(chargedDelivery > 0n ? chargedDelivery : 0n),
    discount,
    points: order.pointsValue,
    giftCard: order.giftCardValue,
  });

  /* The frozen total, restated so `stillOwed` reads the new figure off it:
     what is payable, plus everything it takes off for what is not coming. */
  const grandTotal = addMoney(settled.payable, dropped.droppedGoods, dropped.droppedDelivery);
  const after = stillOwed({ grandTotal, deliveryBreakdown: delivery.breakdown }, owedLines(next.lines));

  return {
    lines: next.lines,
    quote: {
      lines: next.quoted,
      owedBefore: before.owed,
      owedAfter: after.owed,
      addedFees: delivery.added,
      discountBefore: order.discountValue,
      discountAfter: settled.discount,
      codeLost: toFils(order.discountValue) > 0n && toFils(settled.discount) === 0n,
      giftCardBack: fromFils(toFils(order.giftCardValue) - toFils(settled.giftCard)),
      pointsBack: fromFils(toFils(order.pointsValue) - toFils(settled.points)),
    },
    write: {
      breakdown: delivery.breakdown,
      deliveryAdded: fromFils(deliveryAdded),
      waivedAdded: fromFils(waivedAdded),
      discountValue: settled.discount,
      pointsValue: settled.points,
      giftCardValue: settled.giftCard,
      grandTotal,
    },
  };
}
