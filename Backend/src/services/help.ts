/**
 * The help page's server half: finding an order by its number and email.
 *
 * **The lookup tells the holder of both halves about their parcel, and
 * nothing else.** A reference and the email it was placed with are what a
 * confirmation carries, so whoever has both has the confirmation — it is
 * answered with the order's state and each line's, never the address, the
 * phone, a name or a figure a seller agreed with NetLet. A pair that matches
 * nothing is "not found" whichever half was wrong, and misses are throttled
 * by address in Postgres (`MAX_ORDER_LOOKUP_MISSES_PER_ADDRESS`).
 *
 * The help page's question box is the shop assistant now, through the AI
 * gateway (`Backend/gateway/`), whose facts are these same help answers.
 */
import { and, eq, sql } from "drizzle-orm";
import { orderItems, orders } from "../../database/schema.js";
import { getDb } from "./db.js";

export type LookedUpOrder = {
  reference: string;
  placedAt: Date;
  status: (typeof orders.$inferSelect)["status"];
  lines: { title: string; variantTitle: string | null; quantity: number; fulfilment: string; deliveredAt: Date | null }[];
};

/** References are written in capitals; people type them however they like. */
export function normaliseReference(reference: string): string {
  return reference.trim().toUpperCase().replace(/\s+/g, "");
}

export async function lookupOrder(reference: string, email: string): Promise<LookedUpOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const [order] = await db
    .select({ id: orders.id, reference: orders.reference, placedAt: orders.placedAt, status: orders.status })
    .from(orders)
    .where(and(
      eq(orders.reference, normaliseReference(reference)),
      sql`lower(${orders.email}) = ${email.trim().toLowerCase()}`,
    ))
    .limit(1);
  if (!order) return null;
  const lines = await db
    .select({ title: orderItems.productTitle, variantTitle: orderItems.variantTitle, quantity: orderItems.quantity, fulfilment: orderItems.fulfilment, deliveredAt: orderItems.deliveredAt })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.id);
  return { reference: order.reference, placedAt: order.placedAt, status: order.status, lines };
}
