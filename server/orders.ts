/**
 * Placing an order, and reading orders back.
 *
 * The arithmetic is not here — `shared/commerce/order.ts` does that, purely,
 * so what a shopper is charged and what a vendor is owed can be argued with in
 * a test rather than discovered in production. What is here is the part that
 * needs a database: reading live prices one last time, taking the stock, and
 * writing the whole thing or none of it.
 *
 * Outside `db.ts` for the reason `profile.ts` and `rateLimit.ts` are: functions
 * inside `db.ts` call its module-local `getDb`, which nothing outside can
 * redirect, so they cannot be tested against a real database.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  cartItems,
  carts,
  orderItems,
  orders,
  productVariants,
  products,
  vendors,
} from "../drizzle/schema.js";
import {
  draftOrder,
  orderReference,
  refusalFor,
  sliceByVendor,
  type OrderRefusal,
  type PriceableLine,
} from "../shared/commerce/order.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type PlaceOrderDetails = {
  email: string;
  userId?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryZoneId?: string | null;
  addressLine?: string | null;
  addressNotes?: string | null;
  /**
   * Passed in rather than computed, because delivery has no price yet: it
   * needs a rate card per governorate that does not exist. Threading it
   * through now means the day it does exist, nothing here changes.
   */
  deliveryTotal?: string;
};

/** Thrown with a message key, so the client says it in the shopper's language. */
export class OrderRefused extends Error {
  constructor(public readonly reason: OrderRefusal | "order.outOfStock" | "order.noCart") {
    super(reason);
    this.name = "OrderRefused";
  }
}

/**
 * The basket, priced against the catalog as it stands right now.
 *
 * Deliberately the same conditions the storefront sells under — published
 * product, approved vendor — because a line that has become unbuyable since it
 * went in the basket must not be sold. It is dropped rather than errored, the
 * same way `getCart` drops it, and `refusalFor` then refuses an order that has
 * nothing left in it.
 */
async function priceableLines(db: Db, cartId: string): Promise<PriceableLine[]> {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      vendorId: vendors.id,
      vendorName: vendors.name,
      quantity: cartItems.quantity,
      unitPrice: productVariants.price,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      vendorPercent: vendors.commissionPercent,
      vendorFixed: vendors.commissionFixed,
      productPercent: products.commissionPercent,
      productFixed: products.commissionFixed,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(
      and(
        eq(cartItems.cartId, cartId),
        eq(products.status, "published"),
        eq(vendors.status, "approved"),
      ),
    );

  return rows.map(row => ({
    variantId: row.variantId,
    productId: row.productId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    productTitle: row.productTitle,
    variantTitle: row.variantTitle,
    sku: row.sku,
    vendorRule: { percent: row.vendorPercent, fixed: row.vendorFixed },
    // Null on both columns is the absence of an override, not an override of
    // zero — `resolveRule` depends on being handed null rather than a zeroed
    // object, so the shape is preserved rather than flattened here.
    productRule:
      row.productPercent === null && row.productFixed === null
        ? null
        : { percent: row.productPercent, fixed: row.productFixed },
  }));
}

/**
 * Take the stock, or refuse.
 *
 * `stock = stock - n WHERE stock >= n` is the whole safety property: two
 * shoppers racing for the last item both read "1 available", and without the
 * condition inside the write both would be sold it. Postgres evaluates the
 * predicate against the row it locks, so exactly one update matches and the
 * other comes back having changed nothing.
 *
 * A short read is not corrected, it is refused — overselling by one is a
 * conversation with a customer, and there is no amount of stock arithmetic
 * that makes an item appear in a warehouse.
 */
async function takeStock(db: Db, variantId: number, quantity: number): Promise<boolean> {
  const taken = await db
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} - ${quantity}` })
    .where(and(eq(productVariants.id, variantId), sql`${productVariants.stock} >= ${quantity}`))
    .returning({ id: productVariants.id });
  return taken.length > 0;
}

/** Put stock back, for a line that could not be completed. */
async function returnStock(db: Db, variantId: number, quantity: number): Promise<void> {
  await db
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${quantity}` })
    .where(eq(productVariants.id, variantId));
}

/**
 * Turn a basket into an order.
 *
 * The order is born `pending_payment` and nothing here pretends otherwise:
 * until a payment provider exists, this is where the money path stops. That is
 * deliberate rather than unfinished — the order has to exist before a payment
 * can reference it, and building it the other way round is how a paid basket
 * ends up with nothing to attach to.
 *
 * Stock is taken before the write and handed back if the write fails, so a
 * crash between the two does not quietly consume inventory.
 */
export async function placeOrder(cartId: string, details: PlaceOrderDetails) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) throw new OrderRefused("order.noCart");

  const lines = await priceableLines(db, cartId);
  const refusal = refusalFor(lines, details);
  if (refusal) throw new OrderRefused(refusal);

  const draft = draftOrder(lines, details.deliveryTotal ?? "0.000");

  // Take every line's stock first. Anything already taken goes back if a later
  // line cannot be served, so a part-served basket never half-happens.
  const taken: { variantId: number; quantity: number }[] = [];
  for (const line of draft.lines) {
    if (await takeStock(db, line.variantId, line.quantity)) {
      taken.push({ variantId: line.variantId, quantity: line.quantity });
      continue;
    }
    for (const done of taken) await returnStock(db, done.variantId, done.quantity);
    throw new OrderRefused("order.outOfStock");
  }

  try {
    const [order] = await db
      .insert(orders)
      .values({
        reference: orderReference(new Date()),
        userId: details.userId ?? null,
        email: details.email.trim().toLowerCase(),
        itemsTotal: draft.totals.itemsTotal,
        deliveryTotal: draft.totals.deliveryTotal,
        grandTotal: draft.totals.grandTotal,
        commissionTotal: draft.totals.commissionTotal,
        contactName: details.contactName ?? null,
        contactPhone: details.contactPhone ?? null,
        deliveryZoneId: details.deliveryZoneId ?? null,
        addressLine: details.addressLine ?? null,
        addressNotes: details.addressNotes ?? null,
      })
      .returning();

    await db.insert(orderItems).values(
      draft.lines.map(line => ({
        orderId: order.id,
        vendorId: line.vendorId,
        productId: line.productId,
        variantId: line.variantId,
        vendorName: line.vendorName,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        commissionPercent: line.commissionPercent,
        commissionFixed: line.commissionFixed,
        commissionAmount: line.commissionAmount,
        vendorNet: line.vendorNet,
      })),
    );

    // The basket has become the order; leaving it would let the same items be
    // bought twice from a stale tab.
    await db.delete(cartItems).where(eq(cartItems.cartId, cartId));

    return { order, lines: draft.lines, totals: draft.totals };
  } catch (error) {
    for (const done of taken) await returnStock(db, done.variantId, done.quantity);
    throw error;
  }
}

/* ----------------------------------------------------------------- reading --- */

const emptyPage = <T>(pageSize?: number): Page<T> => ({
  rows: [],
  total: 0,
  page: 1,
  pageSize: clampPageSize(pageSize),
});

export type OrderRow = typeof orders.$inferSelect;

/**
 * A shopper's own orders.
 *
 * Scoped by `userId` and nothing else: an order id is a serial, and "show me
 * order 4" must not be a way to read somebody else's purchase.
 */
export async function listOrdersForUser(
  userId: number,
  request: { page?: number; pageSize?: number } = {},
): Promise<Page<OrderRow>> {
  const db = await getDb();
  if (!db) return emptyPage<OrderRow>(request.pageSize);

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, userId));
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    // `placedAt` is not unique — a bulk import or two orders in the same
    // millisecond tie — and offset paging over an unstable sort repeats rows.
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  return { rows, total, page, pageSize };
}

/** One order with its lines, for the shopper who placed it. */
export async function getOrderForUser(userId: number, reference: string) {
  const db = await getDb();
  if (!db) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  if (!order) return null;

  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return { order, lines };
}

/**
 * The orders an actor administers, scoped the way everything else is.
 *
 * An admin sees every order; a vendor sees only orders containing their own
 * lines, and only those lines. The scope is applied in the query rather than
 * filtered afterwards — a vendor must not receive another vendor's rows and
 * have the client hide them.
 */
export async function listOrdersFor(
  actor: Actor,
  request: { page?: number; pageSize?: number } = {},
): Promise<Page<OrderRow & { vendorCount: number }>> {
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) return emptyPage<OrderRow & { vendorCount: number }>(request.pageSize);

  const mine =
    actor.kind === "vendor"
      ? sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.vendorId} = ${actor.vendorId})`
      : undefined;

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(mine);
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select()
    .from(orders)
    .where(mine)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  if (rows.length === 0) return { rows: [], total, page, pageSize };

  const counts = await db
    .select({ orderId: orderItems.orderId, vendorId: orderItems.vendorId })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map(row => row.id)));

  return {
    rows: rows.map(row => ({
      ...row,
      vendorCount: new Set(
        counts.filter(count => count.orderId === row.id).map(count => count.vendorId),
      ).size,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * One order, as the asking party is entitled to see it.
 *
 * A vendor gets their own slice and nothing else — not the other sellers'
 * lines, and not the shopper's grand total, which covers goods that are none
 * of theirs. An admin gets all of it.
 */
export async function getOrderFor(actor: Actor, orderId: number) {
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) return null;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const allLines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  if (actor.kind === "vendor") {
    const mine = allLines.filter(line => line.vendorId === actor.vendorId);
    // Not their order at all: a refusal, rather than an order with no lines,
    // which would confirm that the order exists.
    if (mine.length === 0) return null;
    const [slice] = sliceByVendor(
      mine.map(line => ({
        variantId: line.variantId ?? 0,
        productId: line.productId ?? 0,
        vendorId: line.vendorId ?? 0,
        vendorName: line.vendorName,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        commissionPercent: line.commissionPercent,
        commissionFixed: line.commissionFixed,
        commissionAmount: line.commissionAmount,
        vendorNet: line.vendorNet,
      })),
    );
    return {
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        placedAt: order.placedAt,
        contactName: order.contactName,
        deliveryZoneId: order.deliveryZoneId,
        addressLine: order.addressLine,
        addressNotes: order.addressNotes,
      },
      lines: mine,
      slice,
      scope: "vendor" as const,
    };
  }

  return { order, lines: allLines, slices: null, scope: "admin" as const };
}

/**
 * Move one line through the warehouse.
 *
 * Per line rather than per order because partial shipment is ordinary, and
 * scoped so a vendor can only move their own: the check is against the line's
 * own vendor, so naming somebody else's line id is a refusal rather than a
 * write.
 */
export async function setLineFulfilment(
  actor: Actor,
  lineId: number,
  fulfilment: (typeof orderItems.$inferSelect)["fulfilment"],
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [line] = await db.select().from(orderItems).where(eq(orderItems.id, lineId)).limit(1);
  if (!line) throw new Error("NOT_FOUND");

  assertCan(actor, "stock.adjust", line.vendorId ?? undefined);

  await db.update(orderItems).set({ fulfilment }).where(eq(orderItems.id, lineId));
  return { ...line, fulfilment };
}
