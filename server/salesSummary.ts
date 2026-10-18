/**
 * The overview's business numbers, from the frozen order lines
 * (`Shared/commerce/salesSummary.ts` is the arithmetic).
 *
 * Scoped in the query, the way payouts are: an administrator reads the whole
 * shop, a store's manager or owner reads the lines their store sold and
 * nothing of anybody else's. `payouts.view` is the gate, because a store's
 * takings are the money it runs on — the rank that reads its payouts — and
 * `staff`, who move stock, do not reach it.
 */
import { and, eq, gt, gte, ne } from "drizzle-orm";
import { orderItems, orders, returnRequests } from "../drizzle/schema.js";
import { assertCan, type Actor } from "../Shared/inventory/permissions.js";
import { kuwaitDay } from "../Shared/kuwaitDay.js";
import { summarise, summaryStart, type SalesSummary } from "../Shared/commerce/salesSummary.js";
import { getDb } from "./db.js";

export async function salesSummary(actor: Actor, now = new Date()): Promise<SalesSummary> {
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  assertCan(actor, "payouts.view", vendorId);
  const db = await getDb();
  if (!db) return summarise([], [], now);
  const since = summaryStart(now);
  const scope = vendorId === undefined ? undefined : eq(orderItems.vendorId, vendorId);

  const lines = await db
    .select({
      orderId: orderItems.orderId,
      placedAt: orders.placedAt,
      lineTotal: orderItems.lineTotal,
      quantity: orderItems.quantity,
      productId: orderItems.productId,
      productTitle: orderItems.productTitle,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      gte(orders.placedAt, since),
      ne(orders.status, "cancelled"),
      ne(orderItems.fulfilment, "cancelled"),
      /* An exchange's replacement is the same item counted twice. */
      gt(orderItems.lineTotal, "0"),
      scope,
    ));

  const opened = await db
    .select({ createdAt: returnRequests.createdAt })
    .from(returnRequests)
    .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
    .where(and(
      gte(returnRequests.createdAt, since),
      /* A request the shopper withdrew was never a return. */
      ne(returnRequests.status, "cancelled"),
      scope,
    ));

  return summarise(lines, opened.map(row => kuwaitDay(row.createdAt)), now);
}
