/**
 * A column of the query around a subquery, written with its table's name.
 *
 * Drizzle writes a column bare — `"id"` rather than `"wishlists"."id"` — in
 * the selected fields of a query over one table with no join. Inside a
 * correlated subquery that is a different column: in
 * `(select count(*) from wishlist_items where wishlist_id = id)` the `id` is
 * the item's own, so every list read "0 items" however full it was, and the
 * voucher list counted each code's uses the same wrong way. Nothing failed —
 * it was valid SQL answering another question. A join changes how Drizzle
 * writes it, so the same fragment was right in one query and wrong in the
 * next. Written through this, the outer column is the outer column wherever
 * it sits; `sqlFragments.test.ts` refuses a selected subquery without it.
 */
import { getTableName, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function outer(column: PgColumn) {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
