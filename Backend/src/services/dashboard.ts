/**
 * The portal's dashboard, from the frozen order lines and the shelf
 * (`Shared/commerce/dashboard.ts` is the arithmetic).
 *
 * Scoped in the query, as the sales summary is: an administrator reads the
 * whole shop, a store's manager or owner the lines their store sold and their
 * own shelf. `payouts.view` is the gate, the summary's, because a store's
 * takings are the money it runs on. Who opened an account is NetLet's to know,
 * so a store's dashboard has no such line.
 *
 * The three reads need nothing from each other and go together: each is a
 * round trip to a database that is not beside the function.
 */
import { and, eq, gt, gte, ne, sql } from "drizzle-orm";
import { categories, orderItems, orders, products, productVariants, users } from "../../database/schema.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { kuwaitDay, KUWAIT_OFFSET_MS } from "../../../Shared/kuwaitDay.js";
import {
  buildDashboard,
  daysEnding,
  dashboardStart,
  DASHBOARD_LINE_CEILING,
  type Dashboard,
  type DashboardRange,
  type StockHealth,
} from "../../../Shared/commerce/dashboard.js";
import { getDb } from "./db.js";

const NO_STOCK: StockHealth = { healthy: 0, low: 0, out: 0, preorder: 0 };

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/* The shelf a shopper can buy from: `stockState`'s rule, counted. */
async function shelfOf(db: Db, vendorId: number | undefined): Promise<StockHealth> {
  const [row] = await db
    .select({
      out: sql<number>`count(*) filter (where ${productVariants.stock} <= 0 and ${productVariants.preorderStock} <= 0)::int`,
      preorder: sql<number>`count(*) filter (where ${productVariants.stock} <= 0 and ${productVariants.preorderStock} > 0)::int`,
      low: sql<number>`count(*) filter (where ${productVariants.stock} > 0 and ${productVariants.lowStockAt} is not null and ${productVariants.stock} <= ${productVariants.lowStockAt})::int`,
      healthy: sql<number>`count(*) filter (where ${productVariants.stock} > 0 and (${productVariants.lowStockAt} is null or ${productVariants.stock} > ${productVariants.lowStockAt}))::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.status, "published"), vendorId === undefined ? undefined : eq(products.vendorId, vendorId)));
  return row ?? NO_STOCK;
}

/** The shelf's health alone, for a rank that reads the shelf and not the money (`staff`). */
export async function stockHealth(actor: Actor): Promise<StockHealth> {
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  assertCan(actor, "product.view", vendorId);
  const db = await getDb();
  return db ? shelfOf(db, vendorId) : NO_STOCK;
}

export async function dashboard(actor: Actor, range: DashboardRange, now = new Date()): Promise<Dashboard> {
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  assertCan(actor, "payouts.view", vendorId);
  const admin = actor.kind === "admin";
  const db = await getDb();
  if (!db) return buildDashboard({ lines: [], now, range, stock: NO_STOCK, accountDays: admin ? [] : null });

  const since = dashboardStart(now, range);
  const accountsSince = new Date(Date.parse(`${daysEnding(now, range)[0]}T00:00:00Z`) - KUWAIT_OFFSET_MS);

  const [lines, shelf, accounts] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        placedAt: orders.placedAt,
        lineTotal: orderItems.lineTotal,
        quantity: orderItems.quantity,
        buyerId: orders.userId,
        department: categories.slug,
        productId: orderItems.productId,
        productTitle: orderItems.productTitle,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(products, eq(products.id, orderItems.productId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(
        gte(orders.placedAt, since),
        ne(orders.status, "cancelled"),
        ne(orderItems.fulfilment, "cancelled"),
        /* An exchange's replacement is the same item counted twice. */
        gt(orderItems.lineTotal, "0"),
        vendorId === undefined ? undefined : eq(orderItems.vendorId, vendorId),
      ))
      .limit(DASHBOARD_LINE_CEILING + 1),
    shelfOf(db, vendorId),
    admin
      ? db.select({ createdAt: users.createdAt }).from(users).where(gte(users.createdAt, accountsSince))
      : Promise.resolve(null),
  ]);

  const truncated = lines.length > DASHBOARD_LINE_CEILING;
  return buildDashboard({
    lines: truncated ? lines.slice(0, DASHBOARD_LINE_CEILING) : lines,
    now,
    range,
    stock: shelf,
    accountDays: accounts ? accounts.map(row => kuwaitDay(row.createdAt)) : null,
    truncated,
  });
}

/**
 * Units each variant sold over the last four weeks, for the days-of-cover
 * line beside a low shelf. Only the variants asked about, and only the
 * actor's own store's lines for a store.
 */
export async function unitsSoldLately(actor: Actor, variantIds: number[], now = new Date()): Promise<Map<number, number>> {
  const sold = new Map<number, number>();
  if (variantIds.length === 0) return sold;
  const db = await getDb();
  if (!db) return sold;
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  const since = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ variantId: orderItems.variantId, units: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      gte(orders.placedAt, since),
      ne(orders.status, "cancelled"),
      ne(orderItems.fulfilment, "cancelled"),
      gt(orderItems.lineTotal, "0"),
      sql`${orderItems.variantId} in (${sql.join(variantIds.map(id => sql`${id}`), sql`, `)})`,
      vendorId === undefined ? undefined : eq(orderItems.vendorId, vendorId),
    ))
    .groupBy(orderItems.variantId);
  for (const row of rows) if (row.variantId !== null) sold.set(row.variantId, row.units ?? 0);
  return sold;
}
