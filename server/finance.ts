/**
 * The finance panel's reads.
 *
 * The arithmetic is pure in `shared/commerce/finance.ts`. This is the part
 * that cannot be: pulling the frozen lines out of `order_items` and joining
 * them to the order that says whether the money actually moved.
 *
 * Outside `db.ts` for the reason `orders.ts` and `profile.ts` are: functions
 * inside it reach its module-local `getDb`, which nothing outside can
 * redirect, so anything living there cannot be tested against a real database.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { orderItems, orders } from "../drizzle/schema.js";
import {
  COUNTED_STATUSES,
  byMonth,
  byVendor,
  summarise,
  type FinanceLine,
} from "../shared/commerce/finance.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

/**
 * Every line whose money moved, in a window.
 *
 * Filtered on the *order's* status rather than the line's fulfilment, because
 * this is an accounting question and not a logistics one: a paid order whose
 * parcel has not shipped is still money NetLet is holding, and a delivered
 * line on an unpaid order is not revenue.
 *
 * A ceiling rather than paging, deliberately — the caller is a report that
 * sums everything, and a page of it would be a wrong answer rather than a
 * partial one. `truncated` says when the ceiling was reached, so the page can
 * say the figures are incomplete instead of quietly under-reporting, which is
 * the same lie `QueryGate` and `Pager` were both built to stop.
 */
const LINE_CEILING = 20_000;

export async function financeLines(
  actor: Actor,
  range: { from?: Date | null; to?: Date | null } = {},
): Promise<{ lines: FinanceLine[]; truncated: boolean }> {
  /* Admin-only. Commission and the platform's own cut sit outside a vendor's
     control entirely, and so does the report of them — a vendor seeing their
     own payouts is a different feature (3.3.21) with a different scope. */
  assertCan(actor, "platform.viewAll");

  const db = await getDb();
  if (!db) return { lines: [], truncated: false };

  const filters = [inArray(orders.status, [...COUNTED_STATUSES])];
  if (range.from) filters.push(gte(orders.placedAt, range.from));
  if (range.to) filters.push(lte(orders.placedAt, range.to));

  const rows = await db
    .select({
      orderStatus: orders.status,
      placedAt: orders.placedAt,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      lineTotal: orderItems.lineTotal,
      commissionAmount: orderItems.commissionAmount,
      vendorNet: orderItems.vendorNet,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...filters))
    .limit(LINE_CEILING + 1);

  return { lines: rows.slice(0, LINE_CEILING), truncated: rows.length > LINE_CEILING };
}

/**
 * The whole report, in one call.
 *
 * One query and three rollups rather than three queries, because the totals,
 * the per-vendor table and the monthly series must describe the same set of
 * lines — three queries against a live table can straddle an order being paid
 * and report a per-vendor column that does not add up to the headline.
 */
export async function financeReport(actor: Actor, range: { from?: Date | null; to?: Date | null } = {}) {
  const { lines, truncated } = await financeLines(actor, range);
  return {
    totals: summarise(lines),
    vendors: byVendor(lines),
    months: byMonth(lines),
    truncated,
  };
}
