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
  cartItemAddons,
  cartItems,
  carts,
  orderItemAddons,
  orderItems,
  orders,
  pointEntries,
  productAddons,
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
import type { Pool } from "../shared/commerce/preorder.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { priceFor } from "../shared/commerce/priceOffers.js";
import { freezeDelivery, quoteDelivery, type DeliveryGroup, type DeliveryQuote } from "../shared/commerce/delivery.js";
import { codAvailability, COD_DEFAULT } from "../shared/commerce/payment.js";
import { pointsSpendableOn, spendValue } from "../shared/commerce/referral.js";
import { addonsTotal, type AddonKind } from "../shared/commerce/addons.js";
import { addMoney, multiplyMoney, subtractMoney } from "../shared/money.js";
import { liveOffersFor, markOffersUsed } from "./offers.js";
import { balanceFor, qualifyReferral, returnPoints, takePoints } from "./referral.js";
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
   * Delivery is **computed here, never passed in**.
   *
   * It used to be a parameter, on the honest grounds that there was no rate
   * card to compute it from. There is one now — each seller's own fee, per
   * `shared/commerce/delivery.ts` — and taking the figure from the caller
   * would be letting whoever posts the order set their own postage. The same
   * reason the line prices are read one last time here rather than trusted
   * from the basket that was priced a moment ago.
   */
  /**
   * How the shopper says they will pay (3.2.2). Only `cod` today.
   *
   * The order is written `pending_payment` whatever this says: cash has not
   * changed hands at checkout, and recording it as paid would put revenue in
   * the finance panel that nobody has collected.
   */
  paymentMethod?: string | null;
  /**
   * Whether to spend the shopper's loyalty points on this order (3.1.15).
   *
   * A yes-or-no rather than a number, because the balance is the server's to
   * know: a figure passed in would be a figure to check, and the only answer
   * that check could give is the one read here anyway. How much it covers is
   * capped at the order — points are a discount, not a deposit.
   */
  usePoints?: boolean;
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
async function priceableLines(
  db: Db,
  cartId: string,
  userId: number | null | undefined,
): Promise<{
  lines: PriceableLine[];
  offerIds: number[];
  delivery: DeliveryQuote;
  cod: ReturnType<typeof codAvailability>;
}> {
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
      stock: productVariants.stock,
      preorderStock: productVariants.preorderStock,
      preorderReleaseAt: productVariants.preorderReleaseAt,
      deliveryFlat: vendors.deliveryFlat,
      deliveryFreeOver: vendors.deliveryFreeOver,
      acceptsCod: vendors.acceptsCod,
      codCeiling: vendors.codCeiling,
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

  /*
   * A price the seller agreed with this shopper wins over the shelf, and
   * `priceFor` is the one place that decides — including the case where the
   * shelf has since fallen below the agreement, where the shopper pays the
   * lower figure. Read here, one last time, for the same reason the price is:
   * the basket was priced a moment ago and this is the number that gets frozen.
   */
  const agreed = await liveOffersFor(db, userId, rows.map(row => row.variantId));
  const offerIds: number[] = [];

  /*
   * The extras the shopper ticked (3.1.2), priced from the catalog here for
   * the same reason the goods are: the basket stores which, never what they
   * cost, and this is the last moment the figure is allowed to move.
   */
  const extras = await db
    .select({
      variantId: cartItems.variantId,
      id: productAddons.id,
      kind: productAddons.kind,
      label: productAddons.label,
      price: productAddons.price,
    })
    .from(cartItemAddons)
    .innerJoin(cartItems, eq(cartItems.id, cartItemAddons.cartItemId))
    .innerJoin(productAddons, eq(productAddons.id, cartItemAddons.addonId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(productAddons.position);

  const lines = rows.map(row => {
    const offer = agreed.get(row.variantId) ?? null;
    const charged = priceFor(row.unitPrice, offer);
    // Only an agreement that actually moved the price is spent. One the shelf
    // has undercut leaves the shopper free to use it another day.
    if (offer && charged !== row.unitPrice) offerIds.push(offer.id);
    return {
    variantId: row.variantId,
    productId: row.productId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    quantity: row.quantity,
    unitPrice: charged,
    productTitle: row.productTitle,
    variantTitle: row.variantTitle,
    sku: row.sku,
    levels: {
      stock: row.stock,
      preorderStock: row.preorderStock,
      preorderReleaseAt: row.preorderReleaseAt,
    },
    vendorRule: { percent: row.vendorPercent, fixed: row.vendorFixed },
    // Null on both columns is the absence of an override, not an override of
    // zero — `resolveRule` depends on being handed null rather than a zeroed
    // object, so the shape is preserved rather than flattened here.
    productRule:
      row.productPercent === null && row.productFixed === null
        ? null
        : { percent: row.productPercent, fixed: row.productFixed },
    addons: extras
      .filter(addon => addon.variantId === row.variantId)
      .map(addon => ({ id: addon.id, kind: addon.kind as AddonKind, label: addon.label, price: addon.price })),
    };
  });

  /*
   * Grouped here because the grouping needs the rows the query returned; the
   * arithmetic on top is pure and lives in `shared/commerce/delivery.ts`.
   * Charged prices, not shelf prices — a personally agreed price counts toward
   * a seller's free-delivery threshold, because it is what the shopper spent.
   */
  const groups = new Map<number, DeliveryGroup>();
  const codRules = new Map(rows.map(row => [row.vendorId, { accepts: row.acceptsCod, ceiling: row.codCeiling }]));
  for (const row of rows) {
    const charged = priceFor(row.unitPrice, agreed.get(row.variantId) ?? null);
    /* The extras are money spent with that seller, so they count toward their
       free-delivery threshold exactly as the goods do. */
    const value = addMoney(
      multiplyMoney(charged, row.quantity),
      addonsTotal(
        extras
          .filter(addon => addon.variantId === row.variantId)
          .map(addon => ({ id: addon.id, kind: addon.kind as AddonKind, label: addon.label, price: addon.price })),
        row.quantity,
      ),
    );
    const held = groups.get(row.vendorId);
    if (held) held.goods = addMoney(held.goods, value);
    else {
      groups.set(row.vendorId, {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        goods: value,
        rule: { flat: row.deliveryFlat, freeOver: row.deliveryFreeOver },
      });
    }
  }

  return {
    lines,
    offerIds,
    delivery: quoteDelivery([...groups.values()]),
    cod: codAvailability([...groups.values()].map(group => ({
      vendorName: group.vendorName,
      goods: group.goods,
      rule: codRules.get(group.vendorId ?? -1) ?? COD_DEFAULT,
    }))),
  };
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

/**
 * Take from the pre-order allowance, or refuse.
 *
 * The same predicate on a different column, and that is the entire design of
 * pre-order in this codebase: a vendor who promises 50 sells 50, and the
 * fifty-first shopper is refused by the same race-safe mechanism as the one
 * reaching for the last item on the shelf. A pre-order is a second pool, never
 * an exemption from the rule.
 */
async function takePreorder(db: Db, variantId: number, quantity: number): Promise<boolean> {
  const taken = await db
    .update(productVariants)
    .set({ preorderStock: sql`${productVariants.preorderStock} - ${quantity}` })
    .where(and(eq(productVariants.id, variantId), sql`${productVariants.preorderStock} >= ${quantity}`))
    .returning({ id: productVariants.id });
  return taken.length > 0;
}

/**
 * Take the line's units from whichever pool can serve it, and say which.
 *
 * Stock first: a variant with three on the shelf and an allowance behind it
 * sells the three as ordinary stock, because calling that a pre-order would
 * delay a parcel that could have gone out today.
 *
 * The decision is made *here*, against the row the write locks, rather than
 * trusted from the read that priced the basket. Between those two moments
 * somebody else may have emptied the shelf, and a line that was offered from
 * stock then has to fall through to the allowance — otherwise the order would
 * record a promise the warehouse cannot keep.
 */
async function takeUnits(db: Db, variantId: number, quantity: number): Promise<Pool | null> {
  if (await takeStock(db, variantId, quantity)) return "stock";
  if (await takePreorder(db, variantId, quantity)) return "preorder";
  return null;
}

/** Put units back in the pool they came from, for a line that could not be completed. */
async function returnUnits(db: Db, variantId: number, quantity: number, pool: Pool): Promise<void> {
  const column = pool === "stock" ? productVariants.stock : productVariants.preorderStock;
  await db
    .update(productVariants)
    .set(pool === "stock"
      ? { stock: sql`${column} + ${quantity}` }
      : { preorderStock: sql`${column} + ${quantity}` })
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

  const { lines, offerIds, delivery, cod } = await priceableLines(db, cartId, details.userId);
  const refusal = refusalFor(lines, details);
  if (refusal) throw new OrderRefused(refusal);

  /*
   * Checked here rather than trusted from the basket that was priced a moment
   * ago, for the reason the prices and the delivery are: a seller may have
   * turned cash off, or the basket may have grown past their ceiling, between
   * the page rendering and the button being pressed.
   */
  if (details.paymentMethod === "cod" && !cod.available) {
    throw new OrderRefused("order.paymentUnavailable");
  }

  const draft = draftOrder(lines, delivery.total);

  // Take every line's units first. Anything already taken goes back to the pool
  // it came from if a later line cannot be served, so a part-served basket
  // never half-happens.
  const taken: { variantId: number; quantity: number; pool: Pool }[] = [];
  const pools = new Map<number, Pool>();
  for (const line of draft.lines) {
    const pool = await takeUnits(db, line.variantId, line.quantity);
    if (pool) {
      taken.push({ variantId: line.variantId, quantity: line.quantity, pool });
      pools.set(line.variantId, pool);
      continue;
    }
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    throw new OrderRefused("order.outOfStock");
  }

  /*
   * Points are taken next, and *after* the stock rather than before it: every
   * take from here on has to be undone if a later one fails, and a refusal
   * thrown between two of them is the one place that is easy to get wrong.
   * This one was — the out-of-stock refusal above returned the units and left
   * the shopper's points spent on an order that never existed.
   *
   * Refusing outright when the balance has moved under them is deliberate.
   * Placing the order at full price instead would charge somebody more than
   * the button they pressed said, which is worse than refusing.
   */
  const wantedPoints = details.usePoints && details.userId
    ? pointsSpendableOn(await balanceFor(db, details.userId), draft.totals.grandTotal)
    : 0;
  const pointsEntryId = wantedPoints > 0 && details.userId
    ? await takePoints(db, details.userId, wantedPoints, "spent_on_order")
    : null;
  if (wantedPoints > 0 && pointsEntryId === null) {
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    throw new OrderRefused("order.pointsGone");
  }
  const pointsSpent = pointsEntryId === null ? 0 : wantedPoints;
  const pointsValue = spendValue(pointsSpent);

  try {
    const [order] = await db
      .insert(orders)
      .values({
        reference: orderReference(new Date()),
        userId: details.userId ?? null,
        email: details.email.trim().toLowerCase(),
        itemsTotal: draft.totals.itemsTotal,
        deliveryTotal: draft.totals.deliveryTotal,
        /* Net of the points, so the column that says what is owed needs no
           arithmetic to read — and no line moves, because the discount comes
           out of NetLet's cut rather than the seller's net. */
        grandTotal: subtractMoney(draft.totals.grandTotal, pointsValue),
        pointsSpent,
        pointsValue,
        commissionTotal: draft.totals.commissionTotal,
        /* Frozen beside the total, so an order from last year still says who
           charged what — the reason the commission rate is copied too. */
        deliveryBreakdown: freezeDelivery(delivery),
        paymentMethod: details.paymentMethod ?? null,
        contactName: details.contactName ?? null,
        contactPhone: details.contactPhone ?? null,
        deliveryZoneId: details.deliveryZoneId ?? null,
        addressLine: details.addressLine ?? null,
        addressNotes: details.addressNotes ?? null,
      })
      .returning();

    const writtenLines = await db.insert(orderItems).values(
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
        /* What was actually taken, not what was offered a moment earlier. */
        preordered: pools.get(line.variantId) === "preorder",
        preorderReleaseAt: pools.get(line.variantId) === "preorder" ? line.preorderReleaseAt : null,
      })),
    ).returning({ id: orderItems.id, variantId: orderItems.variantId });

    /*
     * The extras, copied beside the price. Everything is frozen and the
     * reference is `set null`, for the reason every other fact on a line is: a
     * seller may withdraw an extra or change what it costs, and an order from
     * last year still has to say what was bought and be refundable at that
     * figure.
     */
    const frozenAddons = draft.lines.flatMap(line => {
      const written = writtenLines.find(row => row.variantId === line.variantId);
      if (!written) return [];
      return line.addons.map(addon => ({
        orderItemId: written.id,
        addonId: addon.id,
        kind: addon.kind,
        label: addon.label,
        price: addon.price,
      }));
    });
    if (frozenAddons.length) await db.insert(orderItemAddons).values(frozenAddons);

    /* A special price is spent once. Marking it here rather than when the
       shopper adds to the bag is deliberate: a grant is not consumed by
       interest, only by a purchase. The write is guarded by `used_on_order_id
       is null`, so two tabs checking out cannot both claim it. */
    await markOffersUsed(db, offerIds, order.id);

    /* The entry exists already — it had to, to close the race — so this is
       only it learning what it bought. */
    if (pointsEntryId !== null) {
      await db.update(pointEntries).set({ orderId: order.id }).where(eq(pointEntries.id, pointsEntryId));
    }

    // The basket has become the order; leaving it would let the same items be
    // bought twice from a stale tab.
    await db.delete(cartItems).where(eq(cartItems.cartId, cartId));

    return {
      order,
      lines: draft.lines,
      totals: { ...draft.totals, grandTotal: order.grandTotal, pointsSpent, pointsValue },
    };
  } catch (error) {
    // Back to the pool each line came from. Handing a pre-ordered line back as
    // real stock would invent inventory out of a failed write.
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    if (pointsEntryId !== null) await returnPoints(db, pointsEntryId);
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
/** One row of the seller's order desk. Deliberately not the whole order row. */
export type SellerOrderRow = {
  id: number;
  reference: string;
  status: OrderRow["status"];
  paymentMethod: string | null;
  placedAt: Date;
  vendorCount: number;
  /**
   * What this row is worth *to whoever is asking*.
   *
   * An admin sees the order's grand total; a vendor sees their own lines and
   * nothing else. Returning the whole order row handed a vendor the basket
   * total on a shared order — a rival's sales figure, which `getOrderFor` is
   * careful to withhold three functions further down. The leak was latent
   * only because nothing had ever called this.
   */
  orderTotal: string;
};

export async function listOrdersFor(
  actor: Actor,
  request: { page?: number; pageSize?: number } = {},
): Promise<Page<SellerOrderRow>> {
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) return emptyPage<SellerOrderRow>(request.pageSize);

  const mine =
    actor.kind === "vendor"
      ? sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.vendorId} = ${actor.vendorId})`
      : undefined;

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(mine);
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      placedAt: orders.placedAt,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(mine)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  if (rows.length === 0) return { rows: [], total, page, pageSize };

  const lines = await db
    .select({ orderId: orderItems.orderId, vendorId: orderItems.vendorId, lineTotal: orderItems.lineTotal })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map(row => row.id)));

  return {
    rows: rows.map(row => {
      const own = lines.filter(line => line.orderId === row.id);
      return {
        id: row.id,
        reference: row.reference,
        status: row.status,
        paymentMethod: row.paymentMethod,
        placedAt: row.placedAt,
        vendorCount: new Set(own.map(line => line.vendorId)).size,
        orderTotal:
          actor.kind === "vendor"
            ? addMoney(...own.filter(line => line.vendorId === actor.vendorId).map(line => line.lineTotal))
            : row.grandTotal,
      };
    }),
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

  /*
   * The extras that were bought with each line (3.1.2). The seller is who
   * turns up to fit the thing, so an order desk that does not say a fitting
   * was paid for is an order desk that gets somebody a sofa and no fitter.
   */
  const addonRows = allLines.length
    ? await db
        .select()
        .from(orderItemAddons)
        .where(inArray(orderItemAddons.orderItemId, allLines.map(line => line.id)))
    : [];
  const withAddons = allLines.map(line => ({
    ...line,
    addons: addonRows.filter(addon => addon.orderItemId === line.id),
  }));

  if (actor.kind === "vendor") {
    const mine = withAddons.filter(line => line.vendorId === actor.vendorId);
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
        /* The slice is arithmetic over `lineTotal`, which already covers the
           extras, so re-summing them here would count them twice. */
        addons: [],
        addonsTotal: "0.000",
        lineTotal: line.lineTotal,
        commissionPercent: line.commissionPercent,
        commissionFixed: line.commissionFixed,
        commissionAmount: line.commissionAmount,
        vendorNet: line.vendorNet,
        preordered: line.preordered,
        preorderReleaseAt: line.preorderReleaseAt,
      })),
    );
    return {
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        placedAt: order.placedAt,
        contactName: order.contactName,
        /* The seller is who hands the driver a parcel and takes the cash, so
           they need to know it is a cash order. It says how the shopper pays
           for their own goods and nothing about anybody else's. */
        paymentMethod: order.paymentMethod,
        deliveryZoneId: order.deliveryZoneId,
        addressLine: order.addressLine,
        addressNotes: order.addressNotes,
      },
      lines: mine,
      slice,
      scope: "vendor" as const,
    };
  }

  return { order, lines: withAddons, slices: null, scope: "admin" as const };
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

  /*
   * `delivered_at` is stamped here and nowhere else, because it is what the
   * return window and review eligibility are both measured from — a line that
   * says "delivered" with no date is a parcel nobody can review or send back.
   *
   * Moved *away* from delivered it is cleared, which is the uncomfortable half
   * and still right: a seller correcting a mis-click has said the parcel has
   * not arrived, and leaving the date would hold a return window open on it.
   */
  const deliveredAt = fulfilment === "delivered" ? (line.deliveredAt ?? new Date()) : null;

  await db.update(orderItems).set({ fulfilment, deliveredAt }).where(eq(orderItems.id, lineId));
  return { ...line, fulfilment, deliveredAt };
}

/**
 * Record that a driver collected the cash (3.2.2).
 *
 * This is the moment a cash order becomes paid, and it is deliberately a
 * separate act from placing it: at checkout nothing had changed hands, and
 * marking it `paid` there would have put revenue in the finance panel that
 * nobody had collected.
 *
 * The predicate lives inside the `UPDATE`, the way the stock take does, so two
 * people pressing it cannot both be told they were the one who recorded it.
 */
export async function recordCashCollected(actor: Actor, orderId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [order] = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return false;

  /* Scoped like every other order read: a vendor may only touch an order that
     holds one of their lines, and the guard is beside the query. */
  const scope = await getOrderFor(actor, orderId);
  if (!scope) return false;

  const updated = await db
    .update(orders)
    .set({ status: "paid", paymentCollectedAt: new Date() })
    .where(and(
      eq(orders.id, orderId),
      eq(orders.paymentMethod, "cod"),
      eq(orders.status, "pending_payment"),
    ))
    .returning({ id: orders.id });

  if (updated.length === 0) return false;

  /*
   * This is the moment a referral pays (3.1.14), and it is here rather than at
   * placement on purpose: a cash order nobody collects has earned nobody
   * anything. It rides on the update having landed, so the exactly-once the
   * predicate above gives the payment gives the points too — and
   * `qualifyReferral` claims its row with a predicate of its own regardless.
   */
  if (order.userId) await qualifyReferral(db, order.userId, orderId);

  return true;
}
