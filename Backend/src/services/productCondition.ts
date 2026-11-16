/**
 * New or refurbished, as the SQL the shop's reads narrow by — the database
 * half of `Shared/commerce/condition.ts`, which says why it is a
 * specification row and not a column.
 *
 * jsonb containment asks for exactly the row `withCondition` writes, so a
 * product the page calls refurbished is one this chose as refurbished. The
 * attributes column is NOT NULL with a default of `[]`, so the negation never
 * meets a null and quietly drops a row.
 */
import { sql, type SQL } from "drizzle-orm";
import { products } from "../../database/schema.js";
import { REFURBISHED_JSON, type CatalogueCondition } from "../../../Shared/commerce/condition.js";

/** Products sold refurbished. */
export function refurbishedOnly(): SQL {
  return sql`(${products.attributes} @> ${REFURBISHED_JSON}::jsonb)`;
}

/** Products sold new: every product without the refurbished row. */
export function newOnly(): SQL {
  return sql`(not (${products.attributes} @> ${REFURBISHED_JSON}::jsonb))`;
}

/** The narrowing a read for that shop needs, or nothing for both. */
export function conditionWhere(condition: CatalogueCondition): SQL | undefined {
  if (condition === "any") return undefined;
  return condition === "refurbished" ? refurbishedOnly() : newOnly();
}
