/**
 * Whether migration 0094 is pasted, and `price_offers` as it was before it.
 *
 * 0094 adds `started_by` to `price_offers` — who began an agreed price, the
 * shopper asking or the store sending one to a cart — and **Drizzle names
 * every column it knows**: a `select()` lists them all, an `insert` writes
 * `default` into each one it is not given, and a bare `.returning()` returns
 * them all. So code that knows the column, deployed before the owner pastes
 * the SQL, would fail every price request, every inbox and every bag with an
 * agreed price in it. Closed, not broken, instead (the warranty lengths'
 * rule): until the column is there the reads say every price was the
 * shopper's, a shopper's request is written through the table below, which
 * does not know the column, and a store cannot send a price yet. Once a read
 * finds it, it is there for good.
 */
import { getTableColumns, sql } from "drizzle-orm";
import { integer, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { priceOffers } from "../../database/schema.js";
import type { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Who began an agreed price. */
export type OfferStarter = "shopper" | "store";

/** How long a "not yet" stands before the database is asked again. */
const ASK_AGAIN_MS = 60_000;

let pasted = false;
let askedAt = -Infinity;

export async function offerStartsReady(db: Pick<Db, "execute">): Promise<boolean> {
  if (pasted) return true;
  if (Date.now() - askedAt < ASK_AGAIN_MS) return false;
  askedAt = Date.now();
  try {
    const result = (await db.execute(sql`
      select count(*)::int as found from information_schema.columns
      where table_schema = current_schema() and table_name = 'price_offers' and column_name = 'started_by'`)) as unknown;
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as { found?: number | string }[];
    pasted = Number(rows[0]?.found ?? 0) === 1;
  } catch {
    pasted = false;
  }
  return pasted;
}

/** For a test that takes the column away and puts it back. */
export function forgetOfferStarts() {
  pasted = false;
  askedAt = -Infinity;
}

const { startedBy: _startedBy, ...beforeColumns } = getTableColumns(priceOffers);

/** What a read of the whole row selects: every column, or every one with the starter read as the shopper. */
export function offerFields(ready: boolean) {
  return { ...beforeColumns, startedBy: ready ? priceOffers.startedBy : sql<string>`'shopper'` };
}

/** A stored starter, as one of the two. Anything else was a shopper's. */
export const starterOf = (value: string | null | undefined): OfferStarter => (value === "store" ? "store" : "shopper");

/* The table as it was before 0094, for a shopper's request until it is
   pasted; afterwards the column's default says "shopper" for it. The foreign
   keys and indexes are the database's, so they are not repeated here. */
export const priceOffersBefore0094 = pgTable("price_offers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  variantId: integer("variant_id").notNull(),
  productId: integer("product_id"),
  vendorId: integer("vendor_id"),
  productTitle: varchar("product_title", { length: 255 }).notNull(),
  listPrice: numeric("list_price", { precision: 12, scale: 3 }).notNull(),
  askedPrice: numeric("asked_price", { precision: 12, scale: 3 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  shopperNote: text("shopper_note"),
  vendorNote: text("vendor_note"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  offeredPrice: numeric("offered_price", { precision: 12, scale: 3 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  answeredBy: integer("answered_by"),
  usedOnOrderId: integer("used_on_order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
