/**
 * Product views, counted and read back (`Shared/commerce/productViews.ts` is
 * the rule, migration 0084 the table).
 *
 * **Counting is one statement**: the row for the product, the Kuwaiti day,
 * the channel and the source gains a view (and a visitor, when the device says
 * it is the first today) only while the product is one the shop shows and the
 * person opening it is neither one of the store's own team nor one of
 * NetLet's staff — asked inside the write, so nothing reads and then writes.
 * A count that fails never fails the page that sent it: the answer is only
 * whether it was counted.
 *
 * **Reading is scoped in the query**, the dashboard's rule: a store's people
 * read their own store's products, an administrator any store's or all of
 * them. `product.view` is the gate — what a product draws interest is the
 * shelf's business, not the money's, so a store's staff see it too.
 *
 * **Closed, not broken, until 0084 is pasted**: a missing table counts
 * nothing and reads as `ready: false`.
 */
import { and, desc, eq, gt, gte, inArray, ne, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  cartItems,
  orderItems,
  orders,
  productImages,
  productVariants,
  productViews,
  products,
  staffGrants,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { kuwaitDay, KUWAIT_OFFSET_MS } from "../../../Shared/kuwaitDay.js";
import { daysEnding } from "../../../Shared/commerce/dashboard.js";
import {
  buildViewsReport,
  VIEW_PRODUCT_ROWS,
  type ProductFacts,
  type ViewChannel,
  type ViewRange,
  type ViewSource,
  type ViewsReport,
} from "../../../Shared/commerce/productViews.js";
import { isMissingTable } from "../core/describeError.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];

export type ViewInput = { productId: number; channel: ViewChannel; source: ViewSource; firstToday: boolean };
/* `admin` is the session's own word; the row is asked again in the write,
   because an administrator on a device the owner has not authorised reads as
   a shopper to the session (`gateAdminRights`) and is still NetLet's staff. */
export type Viewer = { userId: number | null; admin: boolean };

/** One opening of a product's page. Never throws. */
export async function recordProductView(input: ViewInput, viewer: Viewer, now = new Date()): Promise<{ counted: boolean }> {
  if (viewer.admin) return { counted: false };
  const db = await getDb();
  if (!db) return { counted: false };
  const day = kuwaitDay(now);
  const visitor = input.firstToday ? 1 : 0;
  const notOwnPeople = viewer.userId === null
    ? sql``
    : sql`
        and not exists (select 1 from ${vendorMembers} where ${vendorMembers.vendorId} = ${products.vendorId} and ${vendorMembers.userId} = ${viewer.userId})
        and not exists (select 1 from ${staffGrants} where ${staffGrants.userId} = ${viewer.userId})
        and not exists (select 1 from ${users} where ${users.id} = ${viewer.userId} and ${users.role} = 'admin')`;
  try {
    const result = await db.execute(sql`
      insert into ${productViews} (product_id, day, channel, source, views, visitors)
      select ${products.id}, ${day}::date, ${input.channel}, ${input.source}, 1, ${visitor}
      from ${products} inner join ${vendors} on ${vendors.id} = ${products.vendorId}
      where ${products.id} = ${input.productId} and ${products.status} = 'published' and ${vendors.status} = 'approved'
      ${notOwnPeople}
      on conflict (product_id, day, channel, source)
      do update set views = ${productViews}.views + 1, visitors = ${productViews}.visitors + excluded.visitors
      returning product_id`);
    return { counted: rowsOf(result).length > 0 };
  } catch (error) {
    if (!isMissingTable(error)) console.warn("[productViews] not counted:", (error as Error).message);
    return { counted: false };
  }
}

/** The first moment of a Kuwaiti day, as an instant. */
const startOf = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - KUWAIT_OFFSET_MS);

export type ViewsQuery = { range: ViewRange; vendorId?: number; productId?: number };

/** What the report reads its counts over: one store, one product, or everything. */
type Scope = { vendorId?: number; productId?: number };

export async function productViewsReport(actor: Actor, input: ViewsQuery, now = new Date()): Promise<ViewsReport> {
  const scope: Scope = {};
  if (actor.kind === "vendor") scope.vendorId = actor.vendorId;
  else if (input.vendorId !== undefined) scope.vendorId = input.vendorId;
  assertCan(actor, "product.view", scope.vendorId);

  const db = await getDb();
  const empty = (ready: boolean, productCount = 0) =>
    buildViewsReport({ now, range: input.range, ready, dayChannels: [], sources: [], productChannels: [], productPrevious: [], products: [], orders: { current: 0, previous: 0 }, productCount });
  if (!db) return empty(true);

  if (input.productId !== undefined) {
    const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!row || (scope.vendorId !== undefined && row.vendorId !== scope.vendorId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "error.notFound" });
    }
    assertCan(actor, "product.view", row.vendorId);
    scope.productId = input.productId;
  }

  const current = daysEnding(now, input.range);
  const previous = daysEnding(now, input.range, input.range);
  const since = current[0];
  const before = previous[0];
  const sinceAt = startOf(since);
  const beforeAt = startOf(before);

  /* The counts a scope holds, by the product's store. */
  const inScope = and(
    scope.vendorId === undefined ? undefined : eq(products.vendorId, scope.vendorId),
    scope.productId === undefined ? undefined : eq(products.id, scope.productId),
  );

  try {
    const [dayChannels, sources, productChannels, productPrevious, shelfCount] = await Promise.all([
      db
        .select({
          day: productViews.day,
          channel: productViews.channel,
          views: sql<number>`sum(${productViews.views})::int`,
          visitors: sql<number>`sum(${productViews.visitors})::int`,
        })
        .from(productViews)
        .innerJoin(products, eq(products.id, productViews.productId))
        .where(and(gte(productViews.day, before), inScope))
        .groupBy(productViews.day, productViews.channel),
      db
        .select({
          source: productViews.source,
          views: sql<number>`sum(${productViews.views})::int`,
          visitors: sql<number>`sum(${productViews.visitors})::int`,
        })
        .from(productViews)
        .innerJoin(products, eq(products.id, productViews.productId))
        .where(and(gte(productViews.day, since), inScope))
        .groupBy(productViews.source),
      db
        .select({
          productId: productViews.productId,
          channel: productViews.channel,
          views: sql<number>`sum(${productViews.views})::int`,
          visitors: sql<number>`sum(${productViews.visitors})::int`,
        })
        .from(productViews)
        .innerJoin(products, eq(products.id, productViews.productId))
        .where(and(gte(productViews.day, since), inScope))
        .groupBy(productViews.productId, productViews.channel),
      db
        .select({ productId: productViews.productId, views: sql<number>`sum(${productViews.views})::int` })
        .from(productViews)
        .innerJoin(products, eq(products.id, productViews.productId))
        .where(and(gte(productViews.day, before), sql`${productViews.day} < ${since}::date`, inScope))
        .groupBy(productViews.productId),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.status, "published"), inScope)),
    ]);

    /* The most viewed first, then — while there is room — the shelf's
       unviewed products, newest first, so a product nobody opens is listed too. */
    const viewed = new Map<number, number>();
    for (const row of productChannels) viewed.set(row.productId, (viewed.get(row.productId) ?? 0) + row.views);
    const chosen = Array.from(viewed, ([id, views]) => ({ id, views }))
      .sort((a, b) => b.views - a.views || a.id - b.id)
      .slice(0, VIEW_PRODUCT_ROWS)
      .map(entry => entry.id);
    if (chosen.length < VIEW_PRODUCT_ROWS) {
      const unviewed = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.status, "published"), inScope, chosen.length ? notInArray(products.id, chosen) : undefined))
        .orderBy(desc(products.id))
        .limit(VIEW_PRODUCT_ROWS - chosen.length);
      chosen.push(...unviewed.map(row => row.id));
    }

    const [facts, orderCounts] = await Promise.all([
      productFacts(db, chosen, scope, sinceAt, actor.kind === "admin" && scope.vendorId === undefined),
      distinctOrders(db, scope, sinceAt, beforeAt),
    ]);

    return buildViewsReport({
      now,
      range: input.range,
      ready: true,
      dayChannels,
      sources,
      productChannels,
      productPrevious,
      products: facts,
      orders: orderCounts,
      productCount: shelfCount[0]?.count ?? 0,
    });
  } catch (error) {
    if (isMissingTable(error)) return empty(false);
    throw error;
  }
}

/* What each listed product is, sold and is waiting in carts for. */
async function productFacts(db: Db, ids: number[], scope: Scope, sinceAt: Date, withStore: boolean): Promise<ProductFacts[]> {
  if (ids.length === 0) return [];
  const [rows, images, sold, carts] = await Promise.all([
    db
      .select({
        productId: products.id,
        title: products.title,
        titleAr: products.titleAr,
        handle: products.handle,
        status: products.status,
        vendorName: vendors.name,
      })
      .from(products)
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(inArray(products.id, ids)),
    db
      .selectDistinctOn([productImages.productId], { productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(and(inArray(productImages.productId, ids), eq(productImages.kind, "image")))
      .orderBy(productImages.productId, productImages.position, productImages.id),
    db
      .select({
        productId: orderItems.productId,
        units: sql<number>`sum(${orderItems.quantity})::int`,
        orders: sql<number>`count(distinct ${orderItems.orderId})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(
        inArray(orderItems.productId, ids),
        gte(orders.placedAt, sinceAt),
        ne(orders.status, "cancelled"),
        ne(orderItems.fulfilment, "cancelled"),
        /* An exchange's replacement is the same item counted twice. */
        gt(orderItems.lineTotal, "0"),
        scope.vendorId === undefined ? undefined : eq(orderItems.vendorId, scope.vendorId),
      ))
      .groupBy(orderItems.productId),
    db
      .select({ productId: productVariants.productId, carts: sql<number>`count(distinct ${cartItems.cartId})::int` })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(and(inArray(productVariants.productId, ids), gte(cartItems.createdAt, sinceAt)))
      .groupBy(productVariants.productId),
  ]);
  const imageOf = new Map(images.map(row => [row.productId, row.url]));
  const soldOf = new Map(sold.map(row => [row.productId, row]));
  const cartsOf = new Map(carts.map(row => [row.productId, row.carts]));
  return rows.map(row => ({
    productId: row.productId,
    title: row.title,
    titleAr: row.titleAr,
    handle: row.handle,
    image: imageOf.get(row.productId) ?? null,
    vendorName: withStore ? row.vendorName : null,
    published: row.status === "published",
    inCarts: cartsOf.get(row.productId) ?? 0,
    units: soldOf.get(row.productId)?.units ?? 0,
    orders: soldOf.get(row.productId)?.orders ?? 0,
  }));
}

/* The orders a scope's products were on, this period and the one before. */
async function distinctOrders(db: Db, scope: Scope, sinceAt: Date, beforeAt: Date): Promise<{ current: number; previous: number }> {
  /* A Date in a raw fragment skips the column's mapper, which postgres.js
     refuses; the instant goes as text and is cast. */
  const since = sinceAt.toISOString();
  const [row] = await db
    .select({
      current: sql<number>`count(distinct ${orderItems.orderId}) filter (where ${orders.placedAt} >= ${since}::timestamptz)::int`,
      previous: sql<number>`count(distinct ${orderItems.orderId}) filter (where ${orders.placedAt} < ${since}::timestamptz)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      gte(orders.placedAt, beforeAt),
      ne(orders.status, "cancelled"),
      ne(orderItems.fulfilment, "cancelled"),
      gt(orderItems.lineTotal, "0"),
      scope.vendorId === undefined ? undefined : eq(orderItems.vendorId, scope.vendorId),
      scope.productId === undefined ? undefined : eq(orderItems.productId, scope.productId),
    ));
  return { current: row?.current ?? 0, previous: row?.previous ?? 0 };
}
