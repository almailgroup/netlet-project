/**
 * The driver's check at the door (0086, on the owner's word): the shopper's
 * order page shows a QR and a code while a parcel is on its way, and the
 * driver scans it — or types the code — to confirm how it is paid and hand it
 * over.
 *
 * **Paid online is one step**, the owner's choice ("confirm payment and mark
 * delivered"): the scan answers "Paid online, collect nothing" and marks the
 * driver's parcels on that order delivered. **Cash is two**: the scan says
 * what to collect, and a second press, once the money is in hand, hands them
 * over. Nothing here records the cash as collected — that stays the store's
 * or NetLet's own press, as before — so a driver's word alone never settles
 * an order on the books.
 *
 * **Only the driver's own parcels move**: a delivery company reaches the
 * parcels assigned to it, an administrator every one, through `moveParcel`,
 * which asks the same questions the board's button asks. The token is signed
 * (`core/handover.ts`), so a driver cannot make one from a reference they can
 * read on the board — the scan proves they were in front of the shopper's
 * screen. Each handover is a row in `order_handovers` (who, when, which
 * parcel, and whether the scan said paid online) once 0086 is pasted.
 */
import { and, eq } from "drizzle-orm";
import { orderHandovers, orderItems, orders } from "../../database/schema.js";
import {
  handoverPayment,
  scanHandsOver,
  type HandoverPayment,
} from "../../../Shared/commerce/onlinePayment.js";
import { parcelsOf, type ParcelLine } from "../../../Shared/commerce/parcels.js";
import { assertCan, readableCouriers, type Actor } from "../../../Shared/inventory/permissions.js";
import { codeMatches, orderOfToken } from "../core/handover.js";
import { getDb } from "./db.js";
import { moveParcel } from "./dispatch.js";
import { paidOnlineFor, paymentsTableReady } from "./onlinePayments.js";
import { stillOwedFor } from "./owed.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type HandoverRefusal =
  /** Not a code this server made, or not this order's. */
  | "dispatch.scanUnknown"
  /** None of the order's parcels is this driver's. */
  | "dispatch.notYours"
  /** The driver's parcels on it have not been collected yet. */
  | "dispatch.scanNotCollected"
  /** Everything the driver carried for it has been handed over. */
  | "dispatch.scanDelivered";

export class HandoverRefused extends Error {
  constructor(public readonly reason: HandoverRefusal) {
    super(reason);
    this.name = "HandoverRefused";
  }
}

export type HandoverAnswer = {
  orderId: number;
  reference: string;
  /** Who the parcel is for, as the board already shows the driver. */
  contactName: string | null;
  payment: HandoverPayment;
  /** The driver's parcels on this order that the scan is about. */
  parcels: { key: string; vendorName: string | null; items: number }[];
  /** Handed over by this call. False for cash until the driver says it is in hand. */
  done: boolean;
};

export type HandoverInput =
  | { token: string; cashReceived?: boolean }
  | { orderId: number; code: string; cashReceived?: boolean };

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/**
 * A scan, or a typed code, and what it does. Without `cashReceived` a cash
 * order is only answered; with it, handed over.
 */
export async function handOver(actor: Actor, input: HandoverInput): Promise<HandoverAnswer> {
  assertCan(actor, "delivery.move");
  const orderId = "token" in input
    ? orderOfToken(input.token)
    : codeMatches(input.orderId, input.code) ? input.orderId : null;
  if (orderId === null) throw new HandoverRefused("dispatch.scanUnknown");

  const db = await handle();
  const [order] = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      grandTotal: orders.grandTotal,
      deliveryBreakdown: orders.deliveryBreakdown,
      contactName: orders.contactName,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw new HandoverRefused("dispatch.scanUnknown");

  const lines = await db
    .select({
      lineId: orderItems.id,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      fulfilment: orderItems.fulfilment,
      sizeClass: orderItems.sizeClass,
      weightGrams: orderItems.weightGrams,
      destination: orderItems.destination,
      courierId: orderItems.courierId,
      centreId: orderItems.centreId,
      deliveryChoice: orderItems.deliveryChoice,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.id);

  const scope = readableCouriers(actor);
  const mine = parcelsOf(lines as ParcelLine[]).filter(parcel => scope === "all" || parcel.courierId === scope[0]);
  if (mine.length === 0) throw new HandoverRefused("dispatch.notYours");
  const onTheWay = mine.filter(parcel => parcel.state === "shipped");
  if (onTheWay.length === 0) {
    throw new HandoverRefused(mine.every(parcel => parcel.state === "delivered") ? "dispatch.scanDelivered" : "dispatch.scanNotCollected");
  }

  const [paid, owed] = await Promise.all([
    paidOnlineFor(db, [order.id]),
    stillOwedFor(db, [order]),
  ]);
  const payment = handoverPayment(order, paid.get(order.id) ?? null, owed.get(order.id)?.owed ?? order.grandTotal);
  const answer = {
    orderId: order.id,
    reference: order.reference,
    contactName: order.contactName,
    payment,
    parcels: onTheWay.map(parcel => ({ key: parcel.key, vendorName: parcel.vendorName, items: parcel.items })),
  };
  if (!scanHandsOver(payment) && !input.cashReceived) return { ...answer, done: false };

  for (const parcel of onTheWay) await moveParcel(actor, order.id, parcel.key, "delivered");
  if (await paymentsTableReady(db)) {
    await db.insert(orderHandovers).values(onTheWay.map(parcel => ({
      orderId: order.id,
      parcelKey: parcel.key,
      scannedBy: actor.userId,
      paidOnline: payment.kind === "online",
    })));
  }
  return { ...answer, done: true };
}

/** The handovers recorded for an order, newest first — for a test, or a desk later. */
export async function handoversFor(orderId: number) {
  const db = await handle();
  if (!(await paymentsTableReady(db))) return [];
  return db
    .select()
    .from(orderHandovers)
    .where(and(eq(orderHandovers.orderId, orderId)));
}
