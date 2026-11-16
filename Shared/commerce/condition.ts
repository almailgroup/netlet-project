/**
 * New or refurbished — what condition a product is sold in, on the owner's
 * word ("a section for used products, completely separate from the new
 * products … refurbished, meaning that they are used").
 *
 * **It is a specification row, not a column.** `products.attributes` already
 * holds the rows a product is described by (the Brand, the "Type", the
 * warranty), and a column would be a migration whose code fails every read
 * of `products` until it is pasted (Drizzle selects every column it knows).
 * The row is `{ namespace: "spec", key: "condition", value: "refurbished" }`
 * and nothing else: a product without it is new, so every product the shop
 * already holds stays new without anybody touching it.
 *
 * **It is written by its own control and nothing else.** The specification
 * editor neither shows the row nor drops it (`isConditionRow`, which the
 * free-form rows leave out and `mergeAttributes` keeps beside the score), and
 * the server keeps the stored one whatever a spec save sends, so an app build
 * that knows nothing of conditions cannot turn a refurbished phone back into a
 * new one by saving its specifications.
 *
 * **What a shopper sees is two shops.** Every read of the shop's new products
 * — the shelves, a department, the counts, search, trending, bestsellers,
 * recommendations, the stores selling a department — leaves the refurbished
 * out, and the refurbished section reads them alone; the server's SQL asks
 * the same row this file writes (`REFURBISHED_JSON`, jsonb containment), so
 * the two cannot disagree.
 */
import type { Attribute } from "./attributeSchema.js";

export const PRODUCT_CONDITIONS = ["new", "refurbished"] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];

/** Which shop a read is for: the new products, the refurbished section, or both (a product page, a bag line). */
export const CATALOGUE_CONDITIONS = ["new", "refurbished", "any"] as const;
export type CatalogueCondition = (typeof CATALOGUE_CONDITIONS)[number];

export const CONDITION_KEY = "condition";
const NAMESPACE = "spec";
const REFURBISHED = "refurbished";

/** The one row a refurbished product carries, as jsonb containment reads it. */
export const REFURBISHED_ROW = { namespace: NAMESPACE, key: CONDITION_KEY, value: REFURBISHED } as const;
/** `attributes @> REFURBISHED_JSON` is the server's test for a refurbished product. */
export const REFURBISHED_JSON = JSON.stringify([REFURBISHED_ROW]);

/** Whether a row is the condition row, which no specification editor draws. */
export function isConditionRow(row: Pick<Attribute, "namespace" | "key">): boolean {
  return row.namespace === NAMESPACE && row.key === CONDITION_KEY;
}

/**
 * The condition the rows say. Exactly the row the server's containment reads,
 * so a page and the SQL that chose the products cannot disagree about one.
 */
export function conditionOf(attributes: readonly Pick<Attribute, "namespace" | "key" | "value">[] | null | undefined): ProductCondition {
  return (attributes ?? []).some(row => isConditionRow(row) && row.value === REFURBISHED) ? "refurbished" : "new";
}

/** Whether a product is sold refurbished. */
export function isRefurbished(product: { attributes?: readonly Pick<Attribute, "namespace" | "key" | "value">[] | null }): boolean {
  return conditionOf(product.attributes) === "refurbished";
}

/**
 * The rows with the condition set: one refurbished row, or none for new.
 * Any earlier condition row goes, wherever it sat; every other row is kept
 * as it was.
 */
export function withCondition(attributes: readonly Attribute[], condition: ProductCondition): Attribute[] {
  const rest = attributes.filter(row => !isConditionRow(row));
  return condition === "refurbished"
    ? [...rest, { namespace: NAMESPACE, key: CONDITION_KEY, label: "Condition", value: REFURBISHED }]
    : rest;
}

/** Whether a product in this condition belongs on a read for that shop. */
export function belongsTo(condition: ProductCondition, shop: CatalogueCondition): boolean {
  return shop === "any" || shop === condition;
}
