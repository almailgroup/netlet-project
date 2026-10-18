/**
 * What each order is still owed, read from what it froze.
 *
 * The pure rule is `Shared/commerce/collection.ts`; this is only the part that
 * needs a database — every line of each order, cancelled ones included, which a
 * parcel view leaves out. One module, so the driver's board, the shopper's
 * order and the seller's order cannot reach three different figures for one
 * cash payment.
 *
 * No add-ons are read: `lineTotal` already carries them, which is the mistake
 * the first draft of this made — it summed them again and under-charged a
 * cancelled sofa's fitting twice over.
 */
import { inArray } from "drizzle-orm";
import { orderItems } from "../../database/schema.js";
import { stillOwed, type StillOwed } from "../../../Shared/commerce/collection.js";
import type { FrozenDelivery } from "../../../Shared/commerce/delivery.js";
import type { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type OwedOrder = { id: number; grandTotal: string; deliveryBreakdown: unknown };

export async function stillOwedFor(db: Db, orders: OwedOrder[]): Promise<Map<number, StillOwed>> {
  const owed = new Map<number, StillOwed>();
  if (orders.length === 0) return owed;

  const lines = await db
    .select({
      orderId: orderItems.orderId,
      vendorId: orderItems.vendorId,
      destination: orderItems.destination,
      lineTotal: orderItems.lineTotal,
      fulfilment: orderItems.fulfilment,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orders.map(order => order.id)));

  for (const order of orders) {
    owed.set(order.id, stillOwed(
      { grandTotal: order.grandTotal, deliveryBreakdown: (order.deliveryBreakdown as FrozenDelivery | null) ?? null },
      lines
        .filter(line => line.orderId === order.id)
        .map(line => ({
          vendorId: line.vendorId,
          destinationLabel: (line.destination as { label?: string } | null)?.label ?? null,
          lineTotal: line.lineTotal,
          fulfilment: line.fulfilment,
        })),
    ));
  }
  return owed;
}
