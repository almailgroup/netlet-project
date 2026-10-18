/**
 * What the shop earned, from what it already froze.
 *
 * Requirement 3.6.1 asks for accounting linked to sales: each vendor's
 * commission, the platform's own cut, and reports. Almost all of the work was
 * done the day orders landed — `order_items` carries `lineTotal`,
 * `commissionAmount` and `vendorNet`, copied at the moment of sale and never
 * recomputed. This is the arithmetic that reads them back, and it is pure for
 * the reason the order arithmetic is: a figure you can only check by placing
 * real orders and staring at a page is a figure nobody checks, and the failure
 * mode is not a crash — it is a shop quietly paying its sellers the wrong
 * amount.
 *
 * ## Four rules
 *
 * **Nothing is recomputed.** Not the commission rate, not the percentage, not
 * the net. Every figure here is a sum of numbers the order already holds.
 * Re-deriving commission from today's rate would make September's report
 * change in October, which is the exact failure `order_items` was designed to
 * prevent.
 *
 * **Refunds are shown, never blended in.** An order that went `paid` then
 * `refunded` is money that came and went, and one net figure hides the refund
 * rate — which is among the first things a finance panel exists to surface.
 * Gross, refunded and net are three numbers, and net is the subtraction.
 *
 * **Gross means everything that was charged**, refunded sales included, or the
 * subtraction takes the same money away twice. The first version left a
 * refunded line out of gross *and* still subtracted it, so a shop that sold
 * 100 and refunded 100 reported a net of zero when it had sold 200 and kept
 * half. Every figure was individually defensible and the set of them was
 * wrong, which is why the identity below is the thing worth testing.
 *
 * **Commission is reversed with the sale.** If the money went back, NetLet did
 * not keep its cut. A refunded line adds no commission and no vendor net,
 * because a platform that books commission on refunded orders is reporting
 * revenue it does not have.
 *
 * Those two together give the identity the whole panel rests on:
 * `commission + vendorNet === net`, exactly, in fils — because the commission
 * split froze `commission + net === lineTotal` on every line, and net here is
 * the lines that stuck. A reader can check the table with their eyes.
 */
import { addMoney, fromFils, subtractMoney, toFils } from "../money.js";

/**
 * The payment states where money actually moved.
 *
 * The same pair `Shared/commerce/reviews.ts` calls paid, and for the same
 * reason: `refunded` means it *was* paid, so the sale happened and then
 * reversed. A `pending_payment` order is an intention and belongs in no
 * financial total — counting it would report revenue from a basket somebody
 * abandoned at the card form.
 */
export const COUNTED_STATUSES = ["paid", "refunded"] as const;
export type CountedStatus = (typeof COUNTED_STATUSES)[number];

/** One frozen order line, as the report reads it. */
export type FinanceLine = {
  orderStatus: string;
  placedAt: Date | string;
  vendorId: number | null;
  vendorName: string | null;
  lineTotal: string;
  commissionAmount: string;
  vendorNet: string;
  /** Where the line itself got to. Absent reads as an ordinary sale. */
  fulfilment?: string | null;
};

/**
 * What one line is, for the money.
 *
 * - `uncounted` — its order has not been paid, so it is an intention, not money.
 * - `void` — it never sold: the seller cancelled it before it left. In no total
 *   at all, not even gross, because nobody was charged for it.
 * - `refunded` — charged and given back: the order was refunded, or the goods
 *   came back.
 * - `sold` — a sale that stuck, which is the only kind that books commission or
 *   owes the seller anything.
 *
 * The order's status alone used to decide this, and an order carries one status
 * for every line in it. So a seller who cancelled the sofa out of a paid basket
 * was still shown as owed KWD 204 for it, NetLet booked commission on it, and the
 * finance report counted it as revenue — a sale of something that never left the
 * warehouse. Both reports and the payout list ask this one function, so they
 * cannot disagree about which lines are money.
 */
export type LineOutcome = "sold" | "refunded" | "void" | "uncounted";

export function lineOutcome(orderStatus: string, fulfilment?: string | null): LineOutcome {
  if (!(COUNTED_STATUSES as readonly string[]).includes(orderStatus)) return "uncounted";
  if (fulfilment === "cancelled") return "void";
  if (orderStatus === "refunded" || fulfilment === "returned") return "refunded";
  return "sold";
}

export type Totals = {
  /** What shoppers were charged on every sale that completed, refunds included. */
  gross: string;
  /** What went back out. Positive — it is a magnitude, not a signed figure. */
  refunded: string;
  /** Gross less refunded: the sales that stuck. */
  net: string;
  /** NetLet's cut on the sales that stuck. */
  commission: string;
  /** What the sellers are owed on the sales that stuck. */
  vendorNet: string;
  /** How many lines each side of that. */
  paidLines: number;
  refundedLines: number;
};

const ZERO: Totals = {
  gross: "0.000", refunded: "0.000", net: "0.000",
  commission: "0.000", vendorNet: "0.000",
  paidLines: 0, refundedLines: 0,
};

function isCounted(status: string): status is CountedStatus {
  return (COUNTED_STATUSES as readonly string[]).includes(status);
}

/**
 * Add up a set of lines.
 *
 * Summed in fils as integers and turned back into a money string once, at the
 * end — the discipline the whole codebase applies to the dinar. Adding
 * decimal strings pairwise would round at every step, and a report that is out
 * by a fil per line is out by real money across a month.
 */
export function summarise(lines: FinanceLine[]): Totals {
  let gross = 0n, refunded = 0n, commission = 0n, vendorNet = 0n;
  let paidLines = 0, refundedLines = 0;

  for (const line of lines) {
    const outcome = lineOutcome(line.orderStatus, line.fulfilment);
    if (outcome === "uncounted" || outcome === "void") continue;
    const total = toFils(line.lineTotal);
    // Charged is charged: a sale that was later reversed still happened, and
    // leaving it out of gross would subtract it from a figure it was never in.
    gross += total;

    if (outcome === "refunded") {
      refunded += total;
      refundedLines += 1;
      // Commission goes back with the sale. Booking it on a refunded order
      // reports revenue NetLet does not have.
      continue;
    }

    commission += toFils(line.commissionAmount);
    vendorNet += toFils(line.vendorNet);
    paidLines += 1;
  }

  return {
    gross: fromFils(gross),
    refunded: fromFils(refunded),
    net: fromFils(gross - refunded),
    commission: fromFils(commission),
    vendorNet: fromFils(vendorNet),
    paidLines,
    refundedLines,
  };
}

export type VendorTotals = Totals & { vendorId: number | null; vendorName: string };

/**
 * The same totals, per seller, biggest first.
 *
 * `vendorName` is read off the *line* rather than joined from `vendors`,
 * because the line froze it: a seller who has since left, or been renamed,
 * still has to appear in the month they sold in. That is the same reason the
 * reference out of `order_items` is `set null` and the name is copied beside
 * it.
 */
export function byVendor(lines: FinanceLine[]): VendorTotals[] {
  const groups = new Map<string, FinanceLine[]>();
  for (const line of lines) {
    if (!isCounted(line.orderStatus)) continue;
    const key = String(line.vendorId ?? "removed");
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }

  return [...groups.values()]
    .map(group => ({
      vendorId: group[0].vendorId,
      /* A deleted vendor's name survives on the line; an empty one is the only
         case with nothing to show, and an id reads better than a blank cell. */
      vendorName: group[0].vendorName?.trim() || `#${group[0].vendorId ?? "—"}`,
      ...summarise(group),
    }))
    .sort((a, b) => Number(toFils(b.net) - toFils(a.net)));
}

export type MonthTotals = Totals & { month: string };

/**
 * By calendar month, oldest first, as `YYYY-MM`.
 *
 * UTC, deliberately and with a known cost: a sale at 2am Kuwait time on the
 * first falls in the previous month by this reckoning, because Kuwait is
 * UTC+3. Storing the clock the database already uses keeps one answer
 * everywhere rather than a report that disagrees with the order it came from,
 * and the fix when it matters is a timezone the admin chooses — not a silent
 * local-time conversion in the middle of the arithmetic.
 */
export function byMonth(lines: FinanceLine[]): MonthTotals[] {
  const groups = new Map<string, FinanceLine[]>();
  for (const line of lines) {
    if (!isCounted(line.orderStatus)) continue;
    const at = line.placedAt instanceof Date ? line.placedAt : new Date(line.placedAt);
    if (Number.isNaN(at.getTime())) continue;
    const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
    const group = groups.get(month);
    if (group) group.push(line);
    else groups.set(month, [line]);
  }

  return [...groups.entries()]
    .map(([month, group]) => ({ month, ...summarise(group) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * NetLet's take as a percentage of what stuck, to one decimal place.
 *
 * Null rather than zero when nothing sold: "0.0%" is a rate somebody can read
 * as a fact about the shop, and an empty month has no rate at all. The same
 * argument `summarise` in the reviews module makes for returning null on no
 * reviews.
 */
export function takeRate(totals: Totals): number | null {
  const net = toFils(totals.net);
  if (net <= 0n) return null;
  return Math.round(Number((toFils(totals.commission) * 1000n) / net)) / 10;
}

/** Gross less refunded, exposed for a caller that has the two strings already. */
export function netOf(gross: string, refunded: string): string {
  return subtractMoney(gross, refunded);
}

/** Sum a column of money strings exactly. */
export function sumMoney(amounts: string[]): string {
  return amounts.length ? addMoney(...amounts) : "0.000";
}

export const EMPTY_TOTALS = ZERO;
