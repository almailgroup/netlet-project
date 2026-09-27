/**
 * What each seller is owed, by week.
 *
 * Requirement 3.3.16 asks for two things that turn out to be one: individuals
 * who sell under NetLet's own commercial licence rather than their own, and a
 * weekly payout report. The first is a fact about a seller; the second is what
 * that seller is paid, and both sides need it — a shop that cannot say what it
 * owes cannot be trusted by the people it owes it to.
 *
 * Pure, and the reason is the finance panel's: this is money owed to real
 * people, and a figure you can only check by placing real orders is a figure
 * nobody checks.
 *
 * ## The rules
 *
 * **Nothing is recomputed.** `vendorNet` was frozen on the line at the moment
 * of sale, commission rate and all. Re-deriving it from today's rate would
 * change what a seller was owed in September when their rate moves in
 * October, which is the exact failure `order_items` exists to prevent.
 *
 * **A refunded line belongs to the week it was sold in**, not the week it came
 * back. A payout run covers the sales in a period, and moving a reversal into a
 * later week makes two weeks wrong to make one look tidy.
 *
 * **And there it earns the seller nothing — it is not a debt.** This is the
 * rule that was wrong, and it was wrong by the whole net of every refund.
 * `owed` subtracted `vendorNet` on a refunded line, as a reversal of the sale;
 * but an order carries one status, so once it reads `refunded` the sale it
 * reverses was never added anywhere. A seller who sold one sofa and refunded
 * another in the same week was shown as owed nothing when they were owed the
 * first sofa, and a week of refunds alone showed them owing NetLet money they
 * had never been sent.
 *
 * `shared/commerce/finance.ts` had it right and says so in its own header — "a
 * refunded line adds no commission and no vendor net" — and the two reports
 * render on one page, so the panel showed a seller owed 431.400 in one table
 * and 221.400 in the two beside it. Measured by rendering it, not by reading
 * it: every test at the time passed, because the tests asserted the bug.
 *
 * What follows from that is that a week cannot come out negative. This report
 * recomputes history rather than logging transfers — there is no payout-run
 * table for a later refund to claw back against — so a week is the sum of the
 * sales that stuck, and that sum is never below zero. If payout runs are ever
 * recorded, a clawback is a row in *that* ledger, not a negative here.
 *
 * **A week runs Sunday to Saturday.** That is the Kuwaiti working week — the
 * weekend is Friday and Saturday — so a week that starts on Monday would cut
 * one in half. `shared/commerce/deliverySpeed.ts` makes the same call about
 * the weekend, for the same reason.
 *
 * **A negative week is shown, never clamped to zero.** A week of refunds
 * against nothing sold means the seller owes NetLet, and hiding that behind a
 * zero is how a payout run quietly overpays.
 */
import { fromFils, toFils } from "../money.js";

/** One frozen line, as the payout report reads it. */
export type PayoutLine = {
  orderStatus: string;
  placedAt: Date | string;
  vendorId: number | null;
  vendorName: string | null;
  lineTotal: string;
  commissionAmount: string;
  vendorNet: string;
};

export type PayoutWeek = {
  /** The Sunday the week starts on, as `YYYY-MM-DD`. */
  weekStart: string;
  /** What shoppers were charged on this seller's completed sales that week. */
  gross: string;
  refunded: string;
  commission: string;
  /** What the seller is owed for the week: the net on the sales that stuck. */
  owed: string;
  lines: number;
};

export type VendorPayout = {
  vendorId: number | null;
  vendorName: string;
  weeks: PayoutWeek[];
  /** The sum across every week shown. */
  owed: string;
};

/** Money moved for these, and for no others. The pair the finance panel uses. */
const COUNTED = ["paid", "refunded"];

function asDate(value: Date | string): Date | null {
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The Sunday on or before this date, as `YYYY-MM-DD`.
 *
 * Sunday, because the Kuwaiti weekend is Friday and Saturday and a week that
 * starts on Monday would cut one in half.
 */
export function weekStartOf(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString().slice(0, 10);
}

/**
 * Group a seller's frozen lines into weeks, oldest first.
 *
 * A week with nothing in it is absent rather than a zero row: a report padded
 * with empty weeks buries the ones that matter.
 */
export function weeksFor(lines: PayoutLine[]): PayoutWeek[] {
  const byWeek = new Map<string, { gross: bigint; refunded: bigint; commission: bigint; owed: bigint; lines: number }>();

  for (const line of lines) {
    if (!COUNTED.includes(line.orderStatus)) continue;
    const at = asDate(line.placedAt);
    if (!at) continue;

    const key = weekStartOf(at);
    const week = byWeek.get(key) ?? { gross: 0n, refunded: 0n, commission: 0n, owed: 0n, lines: 0 };
    const total = toFils(line.lineTotal);

    week.gross += total;
    week.lines += 1;
    if (line.orderStatus === "refunded") {
      /* Counted in the week it was *sold* in, and counted as nothing owed.
         The money went back, so the seller earned nothing on it — and
         subtracting `vendorNet` here took off a sale that was never added,
         because an order carries one status and this one now reads `refunded`.
         The same rule `finance.ts` states for the report beside this one. */
      week.refunded += total;
    } else {
      week.commission += toFils(line.commissionAmount);
      week.owed += toFils(line.vendorNet);
    }
    byWeek.set(key, week);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, week]) => ({
      weekStart,
      gross: fromFils(week.gross),
      refunded: fromFils(week.refunded),
      commission: fromFils(week.commission),
      /* The sales that stuck, so never below zero. A clawback against a payout
         already made would belong to a ledger of payout runs, which does not
         exist yet — inventing it as a negative here made the seller owe money
         nobody had sent them. */
      owed: fromFils(week.owed),
      lines: week.lines,
    }));
}

/** Every seller's weeks, biggest total owed first. */
export function payoutsByVendor(lines: PayoutLine[]): VendorPayout[] {
  const groups = new Map<string, PayoutLine[]>();
  for (const line of lines) {
    if (!COUNTED.includes(line.orderStatus)) continue;
    const key = String(line.vendorId ?? "removed");
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }

  return [...groups.values()]
    .map(group => {
      const weeks = weeksFor(group);
      return {
        vendorId: group[0].vendorId,
        /* Read off the line, which froze it: a seller who has since left still
           has to appear in the week they sold in. */
        vendorName: group[0].vendorName?.trim() || `#${group[0].vendorId ?? "—"}`,
        weeks,
        owed: fromFils(weeks.reduce((sum, week) => sum + toFils(week.owed), 0n)),
      };
    })
    .sort((a, b) => Number(toFils(b.owed) - toFils(a.owed)));
}

/** The sum of what every seller is owed across the report. */
export function totalOwed(payouts: VendorPayout[]): string {
  return fromFils(payouts.reduce((sum, payout) => sum + toFils(payout.owed), 0n));
}
