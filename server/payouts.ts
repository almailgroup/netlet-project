/**
 * The weekly payout report's reads.
 *
 * The arithmetic is pure in `shared/commerce/payouts.ts`. This is the half
 * that cannot be: pulling the frozen lines out of `order_items` and joining
 * them to the order that says whether the money moved.
 *
 * Outside `db.ts` for the reason `finance.ts` and `orders.ts` are: functions
 * inside it reach its module-local `getDb`, which nothing outside can
 * redirect, so anything living there cannot be tested against a real database.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { orderItems, orders, vendors } from "../drizzle/schema.js";
import { payoutsByVendor, totalOwed, type PayoutLine } from "../shared/commerce/payouts.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

/** The same ceiling the finance panel uses, and it says when it hit it. */
const LINE_CEILING = 20_000;

/**
 * What every seller is owed, by week.
 *
 * Scoped in the query: an administrator sees every seller, a vendor member
 * sees their own company and nothing else. A vendor reading the whole payout
 * run would be reading their competitors' revenue.
 */
export async function payoutReport(
  actor: Actor,
  range: { from?: Date | null; to?: Date | null } = {},
) {
  /* A vendor may read their own; anything wider needs `platform.viewAll`. */
  const scoped = actor.kind === "vendor" ? actor.vendorId : undefined;
  if (scoped === undefined) assertCan(actor, "platform.viewAll");
  else assertCan(actor, "product.view", scoped);

  const db = await getDb();
  if (!db) return { vendors: [], owed: "0.000", truncated: false };

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
    .where(
      and(
        inArray(orders.status, ["paid", "refunded"]),
        scoped === undefined ? undefined : eq(orderItems.vendorId, scoped),
        range.from ? gte(orders.placedAt, range.from) : undefined,
        range.to ? lte(orders.placedAt, range.to) : undefined,
      ),
    )
    .limit(LINE_CEILING + 1);

  const truncated = rows.length > LINE_CEILING;
  const lines = (truncated ? rows.slice(0, LINE_CEILING) : rows) as PayoutLine[];
  const byVendor = payoutsByVendor(lines);

  return { vendors: byVendor, owed: totalOwed(byVendor), truncated };
}

/**
 * Which sellers trade under NetLet's own licence.
 *
 * Admin-only: it names companies, and one seller learning that another has no
 * licence of their own is not a fact NetLet should be handing out.
 */
export async function sellersUnderPlatformLicence(actor: Actor) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: vendors.id, name: vendors.name, licenceNumber: vendors.licenceNumber })
    .from(vendors)
    .where(eq(vendors.underPlatformLicence, true))
    .orderBy(vendors.name);
}
