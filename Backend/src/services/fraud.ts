/**
 * Gathering what the fraud signals need to judge an order.
 *
 * Requirement 3.6.5. `Shared/commerce/fraudSignals.ts` is the judgement and is
 * pure; this is the counting it cannot do — how old the account was, how many
 * other accounts have used that address, how often this one refunds.
 *
 * Outside `db.ts` for the reason `orders.ts`, `applications.ts` and
 * `finance.ts` are: functions inside it reach its module-local `getDb`, which
 * nothing outside can redirect, so anything living there cannot be tested
 * against a real database.
 *
 * **Admin-only, and the guard is beside the query.** The signals name other
 * accounts' behaviour — "four accounts have used this address" is a fact about
 * people who are not this seller's customers — so a vendor reading their own
 * order desk does not get them. What a seller needs to know about a risky cash
 * order is a separate, narrower question, and inventing an answer to it by
 * leaking this one would be the wrong way round.
 */
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { orderItems, orders, users } from "../../database/schema.js";
import { fraudFlags, riskOf, type Flag, type RiskLevel } from "../../../Shared/commerce/fraudSignals.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { getDb } from "./db.js";

export type OrderRisk = { orderId: number; risk: RiskLevel; flags: Flag[] };

/**
 * Judge a set of orders the caller already has on screen.
 *
 * Takes ids rather than running its own query, the way the product review
 * triage does: this is a second opinion about a page somebody is looking at,
 * not a separate view of which orders exist.
 */
export async function riskForOrders(actor: Actor, orderIds: number[]): Promise<OrderRisk[]> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db || orderIds.length === 0) return [];

  const rows = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      grandTotal: orders.grandTotal,
      paymentMethod: orders.paymentMethod,
      addressLine: orders.addressLine,
      placedAt: orders.placedAt,
      accountCreatedAt: users.createdAt,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(inArray(orders.id, orderIds));

  const judged: OrderRisk[] = [];
  for (const row of rows) {
    /*
     * One query each rather than one clever aggregate: these run over a page
     * of twenty at most, and an aggregate joining a shopper's whole history to
     * an address history to a refund count is the kind of query that is wrong
     * in a way nobody notices for a year.
     */
    /*
     * The day before this order, and the comparison built with `gt` rather
     * than written into the fragment by hand.
     *
     * Two separate traps here, and the second is the one this codebase has
     * already been bitten by. `${date} - interval '1 day'` binds the date as
     * an untyped parameter with no column beside it to infer from, and
     * Postgres refuses the whole query. Interpolating a bare JS `Date` into a
     * raw fragment skips the column's own mapper — which **PGlite accepts and
     * postgres.js throws on**, so every test passes and every real request
     * 500s. That is the wishlist's `lt(column, date)` lesson exactly, and it
     * was reproduced here by calling the endpoint rather than by reasoning.
     */
    const dayBefore = new Date(row.placedAt.getTime() - 24 * 60 * 60 * 1000);
    const [history] = row.userId
      ? await db
          .select({
            all: sql<string>`count(*)`,
            refunded: sql<string>`count(*) filter (where ${orders.status} = 'refunded')`,
            lastDay: sql<string>`count(*) filter (where ${gt(orders.placedAt, dayBefore)})`,
          })
          .from(orders)
          .where(eq(orders.userId, row.userId))
      : [undefined];

    /* Other accounts, not this one: the shopper's own repeat orders to their
       own address are the ordinary case and would drown the signal. */
    const [atAddress] = row.addressLine
      ? await db
          .select({ accounts: sql<string>`count(distinct ${orders.userId})` })
          .from(orders)
          .where(
            and(
              eq(orders.addressLine, row.addressLine),
              row.userId ? ne(orders.userId, row.userId) : undefined,
              gt(orders.placedAt, new Date(row.placedAt.getTime() - 30 * 24 * 60 * 60 * 1000)),
            ),
          )
      : [undefined];

    const [largest] = await db
      .select({ quantity: sql<string>`coalesce(max(${orderItems.quantity}), 0)` })
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id));

    const flags = fraudFlags({
      grandTotal: row.grandTotal,
      paymentMethod: row.paymentMethod,
      accountAgeHours: row.accountCreatedAt
        ? Math.max(0, (row.placedAt.getTime() - row.accountCreatedAt.getTime()) / 3_600_000)
        : /* A guest order has no account to age. Treated as brand new, which
             errs toward looking rather than away. */
          0,
      ordersLastDay: Number(history?.lastDay ?? 1),
      /* The order's own account is excluded above, so this is "others, plus
         this one" — which is what the threshold is written against. */
      accountsAtAddress: Number(atAddress?.accounts ?? 0) + 1,
      ordersAllTime: Number(history?.all ?? 1),
      refundedAllTime: Number(history?.refunded ?? 0),
      largestLineQuantity: Number(largest?.quantity ?? 1),
    });

    judged.push({ orderId: row.id, risk: riskOf(flags), flags });
  }

  return judged;
}
