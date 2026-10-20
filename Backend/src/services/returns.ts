/**
 * Returns and exchanges: the part that needs a database (3.2.8, 3.5.2).
 *
 * The rules are `Shared/commerce/returnRequests.ts` and the window is
 * `Shared/commerce/returns.ts`; this module reads the line, asks both, and
 * writes. Outside `db.ts` for the reason every testable module is.
 *
 * **Every request starts from a line the shopper owns**, found by the order's
 * reference *and* their id in one `WHERE` — somebody else's reference is not
 * found rather than refused, so it cannot be used to ask which orders exist.
 *
 * **Every transition carries the state it expects in its `UPDATE`.** Two
 * people pressing "received" at once cannot both refund the same line, and a
 * shopper withdrawing at the moment the driver collects loses cleanly to the
 * collection rather than half-cancelling a parcel already in a van.
 */
import { and, desc, eq, inArray, isNull, sql, notInArray } from "drizzle-orm";
import { outer } from "./sqlRefs.js";
import { categories, orderItems, orders, productVariants, products, returnRequests, vendors } from "../../database/schema.js";
import {
  automaticDecision,
  isOpenReturn,
  MAX_RETURN_NOTE,
  refundFor,
  returnActions,
  type ReturnAction,
  type ReturnKind,
  type ReturnReason,
} from "../../../Shared/commerce/returnRequests.js";
import { returnStateFor } from "../../../Shared/commerce/returns.js";
import { orderReference } from "../../../Shared/commerce/order.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { violatesUnique } from "../core/describeError.js";
import { getDb } from "./db.js";
import { takeUnits } from "./orders.js";
import { issueCreditNote, issueQuietly } from "./invoices.js";
import { affiliateQuietly, reverseAffiliateLine } from "./affiliates.js";
import { tellReturn, withProductAlerts } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export class ReturnRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ReturnRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** The product's department: its category's slug, or the parent's when it has one. */
async function departmentOf(db: Db, productId: number | null): Promise<string | null> {
  if (productId === null) return null;
  const [row] = await db
    .select({ slug: categories.slug, parentId: categories.parentId })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) return null;
  if (row.parentId === null) return row.slug;
  const [parent] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, row.parentId)).limit(1);
  return parent?.slug ?? row.slug;
}

/* ---------------------------------------------------------- the shopper --- */

/**
 * Ask to send a line back, for a refund or an exchange.
 *
 * Eligibility is `returnStateFor` on the row as stored, with the server's
 * clock; the decision is `automaticDecision` the instant the row is written,
 * so a shopper reporting a broken lamp is told "approved" in the same reply.
 */
export async function requestReturn(
  userId: number,
  input: { reference: string; orderItemId: number; kind: ReturnKind; reason: ReturnReason; note?: string | null },
  now = new Date(),
) {
  const db = await handle();
  const [line] = await db
    .select({
      id: orderItems.id,
      orderId: orders.id,
      orderStatus: orders.status,
      fulfilment: orderItems.fulfilment,
      deliveredAt: orderItems.deliveredAt,
      vendorId: orderItems.vendorId,
      productId: orderItems.productId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.reference, input.reference), eq(orders.userId, userId), eq(orderItems.id, input.orderItemId)))
    .limit(1);
  if (!line) throw new ReturnRefused("returns.notFound");

  const state = returnStateFor({ status: line.orderStatus }, { fulfilment: line.fulfilment, deliveredAt: line.deliveredAt }, now);
  if (!state.returnable) throw new ReturnRefused(state.reason);

  /* A line already swapped or refunded has had its return. An exchange leaves
     the original line `delivered` and inside its window — the swap is a new
     order — so the window alone would offer the same sofa back a second time. */
  const [finished] = await db
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(and(eq(returnRequests.orderItemId, line.id), inArray(returnRequests.status, ["refunded", "exchanged"])))
    .limit(1);
  if (finished) throw new ReturnRefused("returns.alreadyHandled");

  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, MAX_RETURN_NOTE) || null;
  /* "Other" is the one reason a rule cannot read, so it must say something. */
  if (input.reason === "other" && !note) throw new ReturnRefused("returns.needsReason");

  const decision = automaticDecision(input.reason, await departmentOf(db, line.productId));
  try {
    const [row] = await db
      .insert(returnRequests)
      .values({
        orderId: line.orderId,
        orderItemId: line.id,
        userId,
        vendorId: line.vendorId,
        kind: input.kind,
        reason: input.reason,
        note,
        status: decision.status,
        decidedBy: decision.decidedBy,
        decidedAt: decision.decidedBy ? now : null,
        declineReason: decision.status === "declined" ? decision.declineReason : null,
      })
      .returning({ id: returnRequests.id, status: returnRequests.status, declineReason: returnRequests.declineReason });
    /* The store hears it was asked. The shopper has the decision on screen
       already, so only a later one by a person is sent to them. */
    await tellReturn(row.id, "requested");
    return row;
  } catch (error) {
    if (violatesUnique(error, "return_requests_open_unique")) throw new ReturnRefused("returns.alreadyOpen");
    throw error;
  }
}

/** The shopper's requests on one order, newest first, for its lines to show. */
export async function returnsForShopperOrder(userId: number, orderId: number) {
  const db = await handle();
  return db
    .select({
      id: returnRequests.id,
      orderItemId: returnRequests.orderItemId,
      kind: returnRequests.kind,
      reason: returnRequests.reason,
      status: returnRequests.status,
      decidedBy: returnRequests.decidedBy,
      declineReason: returnRequests.declineReason,
      refundAmount: returnRequests.refundAmount,
      refundPaidAt: returnRequests.refundPaidAt,
      replacementReference: sql<string | null>`(select ${orders.reference} from ${orders} where ${orders.id} = ${outer(returnRequests.replacementOrderId)})`,
      createdAt: returnRequests.createdAt,
    })
    .from(returnRequests)
    .where(and(eq(returnRequests.userId, userId), eq(returnRequests.orderId, orderId)))
    .orderBy(desc(returnRequests.id));
}

/** Withdraw a request before the item has left the shopper. */
export async function cancelReturn(userId: number, requestId: number): Promise<void> {
  const db = await handle();
  const [row] = await db
    .update(returnRequests)
    .set({ status: "cancelled" })
    .where(and(
      eq(returnRequests.id, requestId),
      eq(returnRequests.userId, userId),
      inArray(returnRequests.status, ["requested", "approved"]),
    ))
    .returning({ id: returnRequests.id });
  if (!row) throw new ReturnRefused("returns.moved");
}

/* ------------------------------------------------------- seller & admin --- */

export type ReturnDeskRow = Awaited<ReturnType<typeof listReturns>>[number];

/** Work still waiting on the store: one definition for the tile and the tab. */
const WAITING = sql`(${returnRequests.status} in ('requested','approved','collected') or (${returnRequests.status} = 'refunded' and ${returnRequests.refundPaidAt} is null))`;

/** How many requests the desk reads. Open ones first, then the newest. */
export const RETURN_PAGE = 100;

/**
 * The requests this actor may act on: their own store's, or every store's for
 * an administrator. Scoped in the `WHERE`, because a return names a shopper's
 * address and another seller's goods.
 */
export async function listReturns(actor: Actor, filter: { open?: boolean } = {}) {
  assertCan(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined);
  const db = await handle();
  const rows = await db
    .select({
      id: returnRequests.id,
      orderId: returnRequests.orderId,
      reference: orders.reference,
      orderItemId: returnRequests.orderItemId,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
      vendorId: returnRequests.vendorId,
      vendorName: vendors.name,
      kind: returnRequests.kind,
      reason: returnRequests.reason,
      note: returnRequests.note,
      status: returnRequests.status,
      decidedBy: returnRequests.decidedBy,
      declineReason: returnRequests.declineReason,
      collectedAt: returnRequests.collectedAt,
      receivedAt: returnRequests.receivedAt,
      restocked: returnRequests.restocked,
      refundAmount: returnRequests.refundAmount,
      refundPaidAt: returnRequests.refundPaidAt,
      replacementReference: sql<string | null>`(select o2.reference from ${orders} o2 where o2.id = ${outer(returnRequests.replacementOrderId)})`,
      /* Where to collect it from: the line's own door, or the order's. */
      destination: orderItems.destination,
      contactName: orders.contactName,
      contactPhone: orders.contactPhone,
      addressLine: orders.addressLine,
      createdAt: returnRequests.createdAt,
    })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
    .leftJoin(vendors, eq(vendors.id, returnRequests.vendorId))
    .where(and(
      actor.kind === "vendor" ? eq(returnRequests.vendorId, actor.vendorId) : undefined,
      /* "To do" is what the waiting tile counts, refunds still owed in cash
         included — they left this view the moment the item was received, so
         the button that records the cash handed back had nowhere to be. */
      filter.open ? WAITING : undefined,
    ))
    .orderBy(
      sql`case when ${returnRequests.status} in ('requested','approved','collected') then 0 when ${returnRequests.status} = 'refunded' and ${returnRequests.refundPaidAt} is null then 1 else 2 end`,
      desc(returnRequests.createdAt),
      desc(returnRequests.id),
    )
    .limit(RETURN_PAGE);
  const who = actor.kind === "admin" ? "admin" : "seller";
  return rows.map(row => ({ ...row, actions: returnActions(row, who) }));
}

/** Requests waiting on this actor, for a tile that hides at zero. */
export async function countWaitingReturns(actor: Actor): Promise<number> {
  if (actor.kind !== "admin" && actor.kind !== "vendor") return 0;
  if (actor.kind === "vendor") {
    try { assertCan(actor, "returns.handle", actor.vendorId); } catch { return 0; }
  }
  const db = await handle();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(returnRequests)
    .where(and(
      actor.kind === "vendor" ? eq(returnRequests.vendorId, actor.vendorId) : undefined,
      WAITING,
    ));
  return row?.n ?? 0;
}

async function loadForActor(db: Db, actor: Actor, requestId: number) {
  assertCan(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined);
  const [row] = await db
    .select()
    .from(returnRequests)
    .where(and(eq(returnRequests.id, requestId), actor.kind === "vendor" ? eq(returnRequests.vendorId, actor.vendorId) : undefined))
    .limit(1);
  /* Another store's request is not found, never forbidden. */
  if (!row) throw new ReturnRefused("returns.notFound");
  return row;
}

function assertAction(row: { status: string; kind: string; refundPaidAt: Date | null }, actor: Actor, action: ReturnAction) {
  const who = actor.kind === "admin" ? "admin" : "seller";
  if (!returnActions(row, who).includes(action)) throw new ReturnRefused("returns.moved");
}

/** Answer a request a rule could not decide, or (an administrator) overrule one. */
export async function decideReturn(
  actor: Actor,
  requestId: number,
  decision: { approve: boolean; reason?: string | null },
  now = new Date(),
): Promise<void> {
  const db = await handle();
  const row = await loadForActor(db, actor, requestId);
  assertAction(row, actor, decision.approve ? "approve" : "decline");
  const reason = decision.reason?.trim().slice(0, 400) || null;
  if (!decision.approve && !reason) throw new ReturnRefused("returns.needsReason");

  const [moved] = await db
    .update(returnRequests)
    .set({
      status: decision.approve ? "approved" : "declined",
      decidedBy: actor.kind === "admin" ? "admin" : "seller",
      decidedAt: now,
      declineReason: decision.approve ? null : reason,
    })
    .where(and(eq(returnRequests.id, requestId), eq(returnRequests.status, row.status)))
    .returning({ id: returnRequests.id });
  if (!moved) throw new ReturnRefused("returns.moved");
  await tellReturn(requestId, decision.approve ? "approved" : "declined");
}

/** The item has left the shopper. */
export async function markCollected(actor: Actor, requestId: number, now = new Date()): Promise<void> {
  const db = await handle();
  const row = await loadForActor(db, actor, requestId);
  assertAction(row, actor, "collect");
  const [moved] = await db
    .update(returnRequests)
    .set({ status: "collected", collectedAt: now })
    .where(and(eq(returnRequests.id, requestId), eq(returnRequests.status, "approved")))
    .returning({ id: returnRequests.id });
  if (!moved) throw new ReturnRefused("returns.moved");
}

/**
 * The item is back. This *is* the refund or the exchange — there is no state
 * between "received" and done, because a received return that is neither
 * refunded nor replaced is a shopper with nothing.
 *
 * The request is claimed first, with its expected state in the predicate, so
 * two presses cannot both refund one line; everything after works on a row only
 * this call holds.
 */
export async function receiveReturn(
  actor: Actor,
  requestId: number,
  options: { restock: boolean },
  now = new Date(),
): Promise<{ outcome: "refunded" | "exchanged"; refundAmount: string | null; replacementReference: string | null }> {
  const db = await handle();
  const [peek] = await db
    .select({ productId: orderItems.productId })
    .from(returnRequests)
    .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
    .where(eq(returnRequests.id, requestId))
    .limit(1);
  /* Put back on the shelf, it may be back for somebody waiting on it. */
  const result = await withProductAlerts(options.restock ? [peek?.productId] : [], () => receive(db, actor, requestId, options, now));
  if (result.outcome === "exchanged" && result.replacementReference) {
    await tellReturn(requestId, "exchanged", { replacementReference: result.replacementReference });
  }
  return result;
}

async function receive(
  db: Awaited<ReturnType<typeof handle>>,
  actor: Actor,
  requestId: number,
  options: { restock: boolean },
  now: Date,
): Promise<{ outcome: "refunded" | "exchanged"; refundAmount: string | null; replacementReference: string | null }> {
  const row = await loadForActor(db, actor, requestId);
  assertAction(row, actor, "receive");

  const [claimed] = await db
    .update(returnRequests)
    .set({ receivedAt: now, restocked: options.restock })
    .where(and(eq(returnRequests.id, requestId), eq(returnRequests.status, "collected"), sql`${returnRequests.receivedAt} is null`))
    .returning({ id: returnRequests.id });
  if (!claimed) throw new ReturnRefused("returns.moved");

  const [line] = await db.select().from(orderItems).where(eq(orderItems.id, row.orderItemId)).limit(1);
  const [order] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1);
  if (!line || !order) throw new ReturnRefused("returns.notFound");

  /* What came back goes on the shelf only if the seller says it can be sold. */
  if (options.restock && line.variantId !== null) {
    /*
     * Back onto a shelf only by whoever counts that shelf (4.2): a seller
     * restocks their own, and NetLet's is NetLet's — a seller pressing
     * "restock" on an item NetLet holds would be adding to a count in a
     * warehouse they are not standing in. The predicate is in the write, and
     * when it touches nothing the request says nothing went back.
     */
    const back = await db
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${line.quantity}` })
      .where(and(eq(productVariants.id, line.variantId), actor.kind === "admin" ? undefined : isNull(productVariants.centreId)))
      .returning({ id: productVariants.id });
    if (back.length === 0) await db.update(returnRequests).set({ restocked: false }).where(eq(returnRequests.id, requestId));
  }

  if (row.kind === "exchange" && line.variantId !== null) {
    const took = await takeUnits(db, line.variantId, line.quantity);
    if (took) {
      const pool = took.pool;
      const [replacement] = await db
        .insert(orders)
        .values({
          reference: orderReference(now),
          userId: order.userId,
          email: order.email,
          /* Nothing to pay: the shopper paid for this once. Recorded as paid so
             nothing downstream asks a driver to collect for it. */
          status: "paid",
          paymentCollectedAt: now,
          itemsTotal: "0.000",
          deliveryTotal: "0.000",
          grandTotal: "0.000",
          commissionTotal: "0.000",
          paymentMethod: order.paymentMethod,
          contactName: order.contactName,
          contactPhone: order.contactPhone,
          deliveryZoneId: order.deliveryZoneId,
          addressLine: order.addressLine,
          addressNotes: `Exchange for ${order.reference}`,
        })
        .returning({ id: orders.id, reference: orders.reference });
      await db.insert(orderItems).values({
        orderId: replacement.id,
        vendorId: line.vendorId,
        productId: line.productId,
        variantId: line.variantId,
        vendorName: line.vendorName,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        unitPrice: "0.000",
        quantity: line.quantity,
        lineTotal: "0.000",
        commissionPercent: "0.00",
        commissionFixed: "0.000",
        commissionAmount: "0.000",
        vendorNet: "0.000",
        destination: line.destination,
        sizeClass: line.sizeClass,
        weightGrams: line.weightGrams,
        preordered: pool === "preorder",
        centreId: took.centreId,
      });
      await db
        .update(returnRequests)
        .set({ status: "exchanged", replacementOrderId: replacement.id })
        .where(eq(returnRequests.id, requestId));
      return { outcome: "exchanged", refundAmount: null, replacementReference: replacement.reference };
    }
    /* Nothing to send: a refund rather than a shopper left with neither. */
  }

  const refundAmount = refundFor(line);
  /* The line leaves the sale — which finance and payouts already count as a
     refund. From any state it can still be in rather than only `delivered`:
     the item is in the seller's hands, and a seller who moved the line back
     to "shipped" while the return was open (a correction the warehouse board
     allows) left the request refunded over a line that still read as sold,
     so finance counted the money twice. Never over a line already cancelled
     or returned, which have their own outcome. */
  await db
    .update(orderItems)
    .set({ fulfilment: "returned" })
    .where(and(eq(orderItems.id, line.id), notInArray(orderItems.fulfilment, ["cancelled", "returned"])));
  await db
    .update(returnRequests)
    .set({ status: "refunded", refundAmount, declineReason: row.kind === "exchange" ? "returns.exchangeOutOfStock" : null })
    .where(eq(returnRequests.id, requestId));

  /* Every line gone back or never sent: the order itself is refunded. */
  const remaining = await db
    .select({ fulfilment: orderItems.fulfilment })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  if (remaining.every(one => one.fulfilment === "returned" || one.fulfilment === "cancelled")) {
    await db.update(orders).set({ status: "refunded" }).where(and(eq(orders.id, order.id), eq(orders.status, "paid")));
  }
  /* A refund corrects the invoice with a credit note (3.6.6), never by
     editing it — issued after the refund has landed, repaired on read. */
  await issueQuietly(() => issueCreditNote(requestId, now), `the credit note for return ${requestId}`);
  /* A refunded line takes back the affiliate's share of it (3.7). */
  await affiliateQuietly(() => reverseAffiliateLine(db, line.id), `reverse the affiliate share on line ${line.id}`);
  return { outcome: "refunded", refundAmount, replacementReference: null };
}

/** The seller who took the cash has handed it back. */
export async function markRefundPaid(actor: Actor, requestId: number, now = new Date()): Promise<void> {
  const db = await handle();
  const row = await loadForActor(db, actor, requestId);
  assertAction(row, actor, "markRefundPaid");
  const [moved] = await db
    .update(returnRequests)
    .set({ refundPaidAt: now })
    .where(and(eq(returnRequests.id, requestId), eq(returnRequests.status, "refunded"), sql`${returnRequests.refundPaidAt} is null`))
    .returning({ id: returnRequests.id, refundAmount: returnRequests.refundAmount });
  if (!moved) throw new ReturnRefused("returns.moved");
  await tellReturn(requestId, "refundPaid", { amount: moved.refundAmount ?? undefined });
}

/**
 * How a product's size returns have gone (3.1.20): how many said too small and
 * how many too large. Counts only, never who — this is read by anybody on the
 * product page. A withdrawn request is not counted; a declined one is, because
 * the shopper still found it the wrong size.
 */
export async function fitFeedbackFor(productId: number): Promise<{ tooSmall: number; tooLarge: number }> {
  const db = await getDb();
  if (!db) return { tooSmall: 0, tooLarge: 0 };
  const rows = await db
    .select({ reason: returnRequests.reason, n: sql<number>`count(*)::int` })
    .from(returnRequests)
    .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
    .where(and(
      eq(orderItems.productId, productId),
      inArray(returnRequests.reason, ["tooSmall", "tooLarge"]),
      sql`${returnRequests.status} <> 'cancelled'`,
    ))
    .groupBy(returnRequests.reason);
  const count = (reason: string) => rows.find(row => row.reason === reason)?.n ?? 0;
  return { tooSmall: count("tooSmall"), tooLarge: count("tooLarge") };
}

export { isOpenReturn };
