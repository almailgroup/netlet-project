/**
 * Fulfilled by NetLet (4.2), the database half. The rules — one shelf per
 * variant, only NetLet counts NetLet's shelf, who may move a line — are
 * `shared/commerce/netletFulfilment.ts`.
 *
 * Three parties and three capabilities. A seller's manager **sends**
 * (`fulfilment.send`, scoped to their own store in every query); NetLet
 * **operates** the centre (`fulfilment.operate`, admin-only): counts stock in,
 * picks, packs, sends it back. The delivery company collects from the centre
 * through the ordinary dispatch board, which names the centre on the parcel.
 *
 * Every write that moves stock does it under a row lock on the variant, the
 * lock `adjustStock` takes, so a checkout taking the last unit and a receipt
 * handing the variant over cannot interleave.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  fulfilmentCentres,
  fulfilmentCharges,
  inboundLines,
  inboundShipments,
  orderItems,
  orders,
  payoutRunItems,
  productVariants,
  products,
  stockMovements,
  vendors,
} from "../drizzle/schema.js";
import { MAX_INBOUND_LINES, inboundProblem, inboundReference, packCharge, receiptGap, validCount, validPackRate, type InboundStatus } from "../shared/commerce/netletFulfilment.js";
import { chargeReference } from "../shared/commerce/payoutRuns.js";
import { assertCan, can, type Actor } from "../shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type FulfilmentRefusal =
  | "fulfilment.noLines"
  | "fulfilment.tooManyLines"
  | "fulfilment.badQuantity"
  | "fulfilment.duplicateLine"
  | "fulfilment.noCentre"
  | "fulfilment.notYourVariant"
  | "fulfilment.otherCentre"
  | "fulfilment.preorderVariant"
  | "fulfilment.notAnnounced"
  | "fulfilment.countMissing"
  | "fulfilment.notHeld"
  | "fulfilment.notFound"
  | "fulfilment.badRate";

export class FulfilmentProblem extends Error {
  constructor(readonly reason: FulfilmentRefusal) {
    super(reason);
    this.name = "FulfilmentProblem";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** A vendor's own store, or every store for NetLet. */
function vendorScope(actor: Actor): number | "all" {
  if (actor.kind === "admin") return "all";
  if (actor.kind === "vendor") return actor.vendorId;
  throw new Error("FORBIDDEN:fulfilment.send");
}

/* ------------------------------------------------------------- centres --- */

export type CentreRow = typeof fulfilmentCentres.$inferSelect;

/**
 * The centres a caller may send to or run. A seller sees the open ones only —
 * a closed centre takes nothing new — and NetLet sees every one.
 */
export async function listCentres(actor: Actor): Promise<CentreRow[]> {
  if (!can(actor, "fulfilment.send") && !can(actor, "fulfilment.operate")) throw new Error("FORBIDDEN:fulfilment.send");
  const db = await handle();
  return db
    .select()
    .from(fulfilmentCentres)
    .where(actor.kind === "admin" ? undefined : eq(fulfilmentCentres.active, true))
    .orderBy(asc(fulfilmentCentres.name), asc(fulfilmentCentres.id));
}

/** Whether the programme is running at all: some centre is open to receive. */
export async function programmeOpen(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db.select({ id: fulfilmentCentres.id }).from(fulfilmentCentres).where(eq(fulfilmentCentres.active, true)).limit(1);
  return Boolean(row);
}

export async function createCentre(actor: Actor, input: { name: string; governorate: string; addressLine: string }): Promise<{ id: number }> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  const [row] = await db.insert(fulfilmentCentres).values(input).returning({ id: fulfilmentCentres.id });
  return row;
}

/** Close a centre to new shipments, or open it again. What it already holds stays and still ships. */
export async function setCentreActive(actor: Actor, id: number, active: boolean): Promise<void> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  const [row] = await db.update(fulfilmentCentres).set({ active }).where(eq(fulfilmentCentres.id, id)).returning({ id: fulfilmentCentres.id });
  if (!row) throw new FulfilmentProblem("fulfilment.notFound");
}

/* ------------------------------------------------------------- inbound --- */

/**
 * A seller says what they are sending. Nothing moves yet: an announcement is
 * an intention, and the shelf changes when NetLet counts what arrived.
 */
export async function announceShipment(
  actor: Actor,
  input: { vendorId: number; centreId: number; lines: { variantId: number; quantity: number }[]; note?: string | null },
  now = new Date(),
): Promise<{ id: number; reference: string }> {
  assertCan(actor, "fulfilment.send", input.vendorId);
  const problem = inboundProblem(input.lines);
  if (problem) throw new FulfilmentProblem(problem);
  const db = await handle();

  const [centre] = await db.select().from(fulfilmentCentres).where(and(eq(fulfilmentCentres.id, input.centreId), eq(fulfilmentCentres.active, true))).limit(1);
  if (!centre) throw new FulfilmentProblem("fulfilment.noCentre");

  const variants = await db
    .select({
      id: productVariants.id,
      title: productVariants.title,
      sku: productVariants.sku,
      centreId: productVariants.centreId,
      preorderStock: productVariants.preorderStock,
      productTitle: products.title,
      vendorId: products.vendorId,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(inArray(productVariants.id, input.lines.map(line => line.variantId)));
  const byId = new Map(variants.map(variant => [variant.id, variant]));

  for (const line of input.lines) {
    const variant = byId.get(line.variantId);
    /* Another store's variant reads exactly like a missing one. */
    if (!variant || variant.vendorId !== input.vendorId) throw new FulfilmentProblem("fulfilment.notYourVariant");
    /* One shelf per variant: stock already at one centre is not topped up at another. */
    if (variant.centreId !== null && variant.centreId !== centre.id) throw new FulfilmentProblem("fulfilment.otherCentre");
    /* A pre-order is a promise about units nobody holds; NetLet's shelf holds what it counted. */
    if (variant.preorderStock > 0) throw new FulfilmentProblem("fulfilment.preorderVariant");
  }

  return db.transaction(async tx => {
    const [shipment] = await tx
      .insert(inboundShipments)
      .values({ reference: inboundReference(now), vendorId: input.vendorId, centreId: centre.id, note: input.note?.trim() || null, announcedBy: actor.userId, createdAt: now })
      .returning({ id: inboundShipments.id, reference: inboundShipments.reference });
    await tx.insert(inboundLines).values(input.lines.map(line => {
      const variant = byId.get(line.variantId)!;
      return { shipmentId: shipment.id, variantId: variant.id, productTitle: variant.productTitle, variantTitle: variant.title, sku: variant.sku, expected: line.quantity };
    }));
    return shipment;
  });
}

export type SendableVariant = { variantId: number; productTitle: string; variantTitle: string; sku: string | null; stock: number; centreId: number | null; preorderStock: number };

/**
 * The seller's own variants matching a search, to pick from when announcing.
 * Scoped by store in the query; the search is bracketed, because `and` does
 * not wrap a raw fragment and an unbracketed `or` would reach every store.
 */
export async function sendableVariants(actor: Actor, vendorId: number, query: string): Promise<SendableVariant[]> {
  assertCan(actor, "fulfilment.send", vendorId);
  const db = await handle();
  const term = query.trim().toLowerCase();
  return db
    .select({
      variantId: productVariants.id,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      stock: productVariants.stock,
      centreId: productVariants.centreId,
      preorderStock: productVariants.preorderStock,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.vendorId, vendorId),
      term ? sql`(lower(${products.title}) like ${`%${term}%`} or lower(coalesce(${productVariants.sku}, '')) like ${`%${term}%`})` : undefined,
    ))
    .orderBy(asc(products.title), asc(productVariants.id))
    .limit(30);
}

/** The seller withdraws an announcement before anything was counted. */
export async function cancelShipment(actor: Actor, id: number): Promise<void> {
  const db = await handle();
  const [shipment] = await db.select({ vendorId: inboundShipments.vendorId }).from(inboundShipments).where(eq(inboundShipments.id, id)).limit(1);
  if (!shipment || !can(actor, "fulfilment.send", shipment.vendorId)) throw new FulfilmentProblem("fulfilment.notFound");
  const [row] = await db
    .update(inboundShipments)
    .set({ status: "cancelled" })
    .where(and(eq(inboundShipments.id, id), eq(inboundShipments.status, "announced")))
    .returning({ id: inboundShipments.id });
  if (!row) throw new FulfilmentProblem("fulfilment.notAnnounced");
}

export type ShipmentView = {
  id: number;
  reference: string;
  vendorId: number;
  vendorName: string;
  centreName: string;
  status: InboundStatus;
  note: string | null;
  createdAt: Date;
  receivedAt: Date | null;
  lines: { id: number; productTitle: string; variantTitle: string; sku: string | null; expected: number; received: number | null; short: number; over: number }[];
};

/** Shipments, newest first: a seller's own, or every store's for NetLet. Paged, and filtered on the server. */
export async function listShipments(actor: Actor, request: { status?: InboundStatus; page?: number; pageSize?: number } = {}): Promise<Page<ShipmentView>> {
  const scope = vendorScope(actor);
  if (scope === "all") assertCan(actor, "fulfilment.operate");
  else assertCan(actor, "fulfilment.send", scope);
  const db = await handle();

  const where = and(
    scope === "all" ? undefined : eq(inboundShipments.vendorId, scope),
    request.status ? eq(inboundShipments.status, request.status) : undefined,
  );
  const pageSize = clampPageSize(request.pageSize ?? 20);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(inboundShipments).where(where);
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ shipment: inboundShipments, vendorName: vendors.name, centreName: fulfilmentCentres.name })
    .from(inboundShipments)
    .innerJoin(vendors, eq(inboundShipments.vendorId, vendors.id))
    .innerJoin(fulfilmentCentres, eq(inboundShipments.centreId, fulfilmentCentres.id))
    .where(where)
    .orderBy(desc(inboundShipments.createdAt), desc(inboundShipments.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  const lines = rows.length
    ? await db.select().from(inboundLines).where(inArray(inboundLines.shipmentId, rows.map(row => row.shipment.id))).orderBy(asc(inboundLines.id))
    : [];

  return {
    rows: rows.map(({ shipment, vendorName, centreName }) => ({
      id: shipment.id,
      reference: shipment.reference,
      vendorId: shipment.vendorId,
      vendorName,
      centreName,
      status: shipment.status,
      note: shipment.note,
      createdAt: shipment.createdAt,
      receivedAt: shipment.receivedAt,
      lines: lines
        .filter(line => line.shipmentId === shipment.id)
        .map(line => ({
          id: line.id,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          sku: line.sku,
          expected: line.expected,
          received: line.received,
          ...(line.received === null ? { short: 0, over: 0 } : receiptGap(line.expected, line.received)),
        })),
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * NetLet counts a shipment in. **The count is what is recorded**, short or
 * over, because it is the fact and the announcement was an intention.
 *
 * The first receipt of a variant hands it over: the shop then sells what
 * NetLet counted, and whatever the seller still holds is no longer for sale
 * here — the history records both moves. A later receipt adds to the shelf.
 *
 * One transaction, and the shipment is claimed by its status in the `UPDATE`,
 * so two people counting the same pallet cannot both add it.
 */
export async function receiveShipment(actor: Actor, id: number, counts: { lineId: number; received: number }[], now = new Date()): Promise<{ received: number }> {
  assertCan(actor, "fulfilment.operate");
  if (counts.length > MAX_INBOUND_LINES || counts.some(count => !validCount(count.received))) throw new FulfilmentProblem("fulfilment.badQuantity");
  const db = await handle();

  return db.transaction(async tx => {
    const [shipment] = await tx
      .update(inboundShipments)
      .set({ status: "received", receivedBy: actor.userId, receivedAt: now })
      .where(and(eq(inboundShipments.id, id), eq(inboundShipments.status, "announced")))
      .returning();
    if (!shipment) throw new FulfilmentProblem("fulfilment.notAnnounced");

    const lines = await tx.select().from(inboundLines).where(eq(inboundLines.shipmentId, id)).orderBy(asc(inboundLines.id));
    const countFor = new Map(counts.map(count => [count.lineId, count.received]));
    /* Every line is counted, even if the count is zero: a line left blank is
       a line nobody looked for, which is different from one that did not come. */
    if (lines.some(line => !countFor.has(line.id))) throw new FulfilmentProblem("fulfilment.countMissing");

    let total = 0;
    for (const line of lines) {
      const received = countFor.get(line.id)!;
      total += received;
      await tx.update(inboundLines).set({ received }).where(eq(inboundLines.id, line.id));
      if (line.variantId === null) continue;

      const [variant] = await tx
        .select({ stock: productVariants.stock, centreId: productVariants.centreId })
        .from(productVariants)
        .where(eq(productVariants.id, line.variantId))
        .for("update");
      if (!variant) continue;
      if (variant.centreId !== null && variant.centreId !== shipment.centreId) throw new FulfilmentProblem("fulfilment.otherCentre");

      const handingOver = variant.centreId === null;
      if (handingOver && received === 0) continue;
      const resulting = handingOver ? received : variant.stock + received;
      await tx
        .update(productVariants)
        .set(handingOver ? { stock: resulting, centreId: shipment.centreId, preorderStock: 0 } : { stock: resulting })
        .where(eq(productVariants.id, line.variantId));

      const movements: (typeof stockMovements.$inferInsert)[] = [];
      if (handingOver && variant.stock > 0) {
        movements.push({ variantId: line.variantId, delta: -variant.stock, resulting: 0, reason: "netletHandedOver", note: shipment.reference, actorId: actor.userId, createdAt: now });
      }
      if (received > 0) {
        movements.push({ variantId: line.variantId, delta: received, resulting, reason: "netletReceived", note: shipment.reference, actorId: actor.userId, createdAt: new Date(now.getTime() + 1) });
      }
      if (movements.length) await tx.insert(stockMovements).values(movements);
    }
    return { received: total };
  });
}

/* --------------------------------------------------------- NetLet stock --- */

export type HeldRow = {
  variantId: number;
  productId: number;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  stock: number;
  vendorId: number;
  vendorName: string;
  centreName: string;
};

/** What NetLet is holding: a seller's own, or every store's for NetLet. Paged, and always says how many. */
export async function heldStock(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<HeldRow>> {
  const scope = vendorScope(actor);
  if (scope === "all") assertCan(actor, "fulfilment.operate");
  else assertCan(actor, "fulfilment.send", scope);
  const db = await handle();
  const where = and(isNotNull(productVariants.centreId), scope === "all" ? undefined : eq(products.vendorId, scope));
  const pageSize = clampPageSize(request.pageSize ?? 50);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(where);
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      stock: productVariants.stock,
      vendorId: vendors.id,
      vendorName: vendors.name,
      centreName: fulfilmentCentres.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .innerJoin(fulfilmentCentres, eq(productVariants.centreId, fulfilmentCentres.id))
    .where(where)
    /* Ends on the id: a paged list over a sort that ties repeats rows. */
    .orderBy(asc(vendors.name), asc(products.title), asc(productVariants.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return { rows, total, page, pageSize };
}

/**
 * NetLet sends what it holds back to the seller, and the variant is theirs to
 * count again from zero. Lines already sold off NetLet's shelf stay NetLet's
 * to pack — they were frozen at the sale.
 */
export async function returnToSeller(actor: Actor, variantId: number, now = new Date()): Promise<{ returned: number }> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  return db.transaction(async tx => {
    const [variant] = await tx
      .select({ stock: productVariants.stock, centreId: productVariants.centreId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .for("update");
    if (!variant || variant.centreId === null) throw new FulfilmentProblem("fulfilment.notHeld");
    await tx.update(productVariants).set({ stock: 0, centreId: null }).where(eq(productVariants.id, variantId));
    await tx.insert(stockMovements).values({ variantId, delta: -variant.stock, resulting: 0, reason: "netletReturned", actorId: actor.userId, createdAt: now });
    return { returned: variant.stock };
  });
}

/* ------------------------------------------------------- pick and pack --- */

export type PickOrder = {
  orderId: number;
  reference: string;
  placedAt: Date;
  centreId: number;
  centreName: string;
  lines: { lineId: number; vendorName: string | null; productTitle: string; variantTitle: string | null; sku: string | null; quantity: number }[];
};

const PICK_CEILING = 300;

/**
 * What NetLet has to pick: every line off a centre's shelf still `pending`,
 * grouped by order and centre, oldest first — the order a warehouse works in.
 */
export async function pickList(actor: Actor): Promise<{ orders: PickOrder[]; truncated: boolean }> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  const rows = await db
    .select({
      lineId: orderItems.id,
      orderId: orders.id,
      reference: orders.reference,
      placedAt: orders.placedAt,
      centreId: orderItems.centreId,
      centreName: fulfilmentCentres.name,
      vendorName: orderItems.vendorName,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(fulfilmentCentres, eq(orderItems.centreId, fulfilmentCentres.id))
    .where(and(isNotNull(orderItems.centreId), eq(orderItems.fulfilment, "pending")))
    .orderBy(asc(orders.placedAt), asc(orders.id), asc(orderItems.id))
    .limit(PICK_CEILING + 1);

  const truncated = rows.length > PICK_CEILING;
  const grouped = new Map<string, PickOrder>();
  for (const row of rows.slice(0, PICK_CEILING)) {
    const key = `${row.orderId}:${row.centreId}`;
    const held = grouped.get(key) ?? { orderId: row.orderId, reference: row.reference, placedAt: row.placedAt, centreId: row.centreId!, centreName: row.centreName, lines: [] };
    held.lines.push({ lineId: row.lineId, vendorName: row.vendorName, productTitle: row.productTitle, variantTitle: row.variantTitle, sku: row.sku, quantity: row.quantity });
    grouped.set(key, held);
  }
  return { orders: [...grouped.values()], truncated };
}

/**
 * Picked and packed: every line of this order off this centre's shelf moves
 * from `pending` to `preparing`, which is what the dispatch board reads as
 * "ready to collect". The old state is in the predicate, so a line a seller's
 * desk or a second packer moved first is left alone and not counted.
 */
export async function markPacked(actor: Actor, orderId: number, centreId: number, now = new Date()): Promise<{ packed: number }> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  return db.transaction(async tx => {
    const moved = await tx
      .update(orderItems)
      .set({ fulfilment: "preparing" })
      .where(and(eq(orderItems.orderId, orderId), eq(orderItems.centreId, centreId), eq(orderItems.fulfilment, "pending")))
      .returning({ id: orderItems.id, vendorId: orderItems.vendorId, quantity: orderItems.quantity });

    /*
     * The packing charge (4.2), in the same transaction as the work it is for:
     * at the centre's rate now, frozen on the charge, one per line — the unique
     * index makes a line packed, restored and packed again charge once. No
     * rate is no charge.
     */
    const [centre] = await tx.select({ rate: fulfilmentCentres.packFeePerUnit }).from(fulfilmentCentres).where(eq(fulfilmentCentres.id, centreId)).limit(1);
    const charged = moved.filter(line => line.vendorId !== null);
    if (centre?.rate && packCharge(centre.rate, 1) !== "0.000" && charged.length) {
      const [order] = await tx.select({ reference: orders.reference }).from(orders).where(eq(orders.id, orderId)).limit(1);
      await tx
        .insert(fulfilmentCharges)
        .values(charged.map(line => ({
          vendorId: line.vendorId!,
          orderItemId: line.id,
          centreId,
          orderReference: order?.reference ?? "",
          units: line.quantity,
          ratePerUnit: centre.rate!,
          amount: packCharge(centre.rate!, line.quantity),
          createdAt: now,
        })))
        .onConflictDoNothing({ target: fulfilmentCharges.orderItemId });
    }
    return { packed: moved.length };
  });
}

/** NetLet sets what a centre charges per unit packed (4.2); null stops charging. */
export async function setPackRate(actor: Actor, centreId: number, rate: string | null): Promise<void> {
  assertCan(actor, "fulfilment.operate");
  if (rate !== null && !validPackRate(rate)) throw new FulfilmentProblem("fulfilment.badRate");
  const db = await handle();
  const [row] = await db.update(fulfilmentCentres).set({ packFeePerUnit: rate }).where(eq(fulfilmentCentres.id, centreId)).returning({ id: fulfilmentCentres.id });
  if (!row) throw new FulfilmentProblem("fulfilment.notFound");
}

export type ChargeRow = { id: number; reference: string; orderReference: string; centreName: string; vendorName: string; units: number; ratePerUnit: string; amount: string; createdAt: Date; deducted: boolean };

/** Packing charges, newest first: a seller's own, or every store's for NetLet. Paged; each says whether a payout run has taken it. */
export async function listCharges(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<ChargeRow>> {
  const scope = vendorScope(actor);
  if (scope === "all") assertCan(actor, "fulfilment.operate");
  else assertCan(actor, "fulfilment.send", scope);
  const db = await handle();
  const where = scope === "all" ? undefined : eq(fulfilmentCharges.vendorId, scope);
  const pageSize = clampPageSize(request.pageSize ?? 25);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(fulfilmentCharges).where(where);
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ charge: fulfilmentCharges, centreName: fulfilmentCentres.name, vendorName: vendors.name })
    .from(fulfilmentCharges)
    .innerJoin(fulfilmentCentres, eq(fulfilmentCharges.centreId, fulfilmentCentres.id))
    .innerJoin(vendors, eq(fulfilmentCharges.vendorId, vendors.id))
    .where(where)
    .orderBy(desc(fulfilmentCharges.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  const taken = rows.length
    ? new Set((await db.select({ id: payoutRunItems.chargeId }).from(payoutRunItems).where(inArray(payoutRunItems.chargeId, rows.map(row => row.charge.id)))).map(row => row.id))
    : new Set<number | null>();
  return {
    rows: rows.map(({ charge, centreName, vendorName }) => ({
      id: charge.id,
      reference: chargeReference(charge.id),
      orderReference: charge.orderReference,
      centreName,
      vendorName,
      units: charge.units,
      ratePerUnit: charge.ratePerUnit,
      amount: charge.amount,
      createdAt: charge.createdAt,
      deducted: taken.has(charge.id),
    })),
    total,
    page,
    pageSize,
  };
}

/** What is waiting on NetLet's floor, for the overview: shipments to count and orders to pick. */
export async function waitingAtCentres(actor: Actor): Promise<{ toReceive: number; toPick: number }> {
  assertCan(actor, "fulfilment.operate");
  const db = await handle();
  const [{ toReceive }] = await db.select({ toReceive: sql<number>`count(*)::int` }).from(inboundShipments).where(eq(inboundShipments.status, "announced"));
  const [{ toPick }] = await db
    .select({ toPick: sql<number>`count(distinct ${orderItems.orderId})::int` })
    .from(orderItems)
    .where(and(isNotNull(orderItems.centreId), eq(orderItems.fulfilment, "pending")));
  return { toReceive, toPick };
}
