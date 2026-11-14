/**
 * Whether migration 0083 is pasted, and the two extras tables as they were
 * before it.
 *
 * 0083 adds `warranty_months` to `product_addons` and `order_item_addons`, and
 * **Drizzle names every column it knows**: a `select()` lists them all and an
 * `insert` writes `default` into each one it is not given. So code that knows
 * the column, deployed before the owner pastes the SQL, would fail every read
 * of a product — `hydrate` reads every product's extras — and the shop with it.
 * Closed, not broken, instead: until the column is there the reads leave it out
 * and say every plan has no length, and the writes go through the tables below,
 * which do not know it. Once a read finds it, it is there for good.
 */
import { getTableColumns, sql } from "drizzle-orm";
import { integer, numeric, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { orderItemAddons, productAddons } from "../../database/schema.js";
import type { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** How long a "not yet" stands before the database is asked again. */
const ASK_AGAIN_MS = 60_000;

let pasted = false;
let askedAt = -Infinity;

export async function warrantyLengthsReady(db: Pick<Db, "execute">): Promise<boolean> {
  if (pasted) return true;
  if (Date.now() - askedAt < ASK_AGAIN_MS) return false;
  askedAt = Date.now();
  try {
    const result = (await db.execute(sql`
      select count(*)::int as found from information_schema.columns
      where table_schema = current_schema() and column_name = 'warranty_months'
        and table_name in ('product_addons', 'order_item_addons')`)) as unknown;
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as { found?: number | string }[];
    pasted = Number(rows[0]?.found ?? 0) === 2;
  } catch {
    pasted = false;
  }
  return pasted;
}

/** For a test that takes the column away and puts it back. */
export function forgetWarrantyLengths() {
  pasted = false;
  askedAt = -Infinity;
}

const { warrantyMonths: _product, ...productColumns } = getTableColumns(productAddons);
const { warrantyMonths: _order, ...orderColumns } = getTableColumns(orderItemAddons);

/** What a read of `product_addons` selects: every column, or every one but the length. */
export function productAddonFields(ready: boolean) {
  return { ...productColumns, warrantyMonths: ready ? productAddons.warrantyMonths : sql<number | null>`null` };
}

/** The same for `order_item_addons`. */
export function orderAddonFields(ready: boolean) {
  return { ...orderColumns, warrantyMonths: ready ? orderItemAddons.warrantyMonths : sql<number | null>`null` };
}

/* The tables as they were before 0083, for the writes until it is pasted. The
   foreign keys are the database's, so they are not repeated here. */
export const productAddonsBefore0083 = pgTable("product_addons", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  kind: varchar("kind", { length: 20 }).notNull().default("other"),
  label: varchar("label", { length: 160 }).notNull(),
  labelAr: varchar("label_ar", { length: 160 }),
  price: numeric("price", { precision: 12, scale: 3 }).notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderItemAddonsBefore0083 = pgTable("order_item_addons", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  addonId: integer("addon_id"),
  kind: varchar("kind", { length: 20 }).notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  price: numeric("price", { precision: 12, scale: 3 }).notNull(),
});

/** A row for either shape: the length dropped when the column is not there yet. */
export function withoutLength<T extends { warrantyMonths?: number | null }>(row: T): Omit<T, "warrantyMonths"> {
  const { warrantyMonths: _gone, ...rest } = row;
  return rest;
}
