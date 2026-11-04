/**
 * Acting on several products at once from the admin list.
 *
 * Every bulk action is the single-product one applied to each product in
 * turn, so every rule that guards one — a price before publishing, a
 * warranty on electronics, a seller's publish going to review, NetLet's own
 * shelf counted only by NetLet — guards each of them, and the answer names
 * the ones refused and why rather than failing the batch or skipping them in
 * silence. Pure, so the form asks the server's own question before the press.
 */
import { fromFils, toFils } from "../money.js";
import { SPEC_NAMESPACE, type Attribute } from "../commerce/attributeSchema.js";
import { contactFindings } from "../commerce/contactFilter.js";

export const BULK_ACTIONS = ["publish", "archive", "draft", "reprice", "restock", "department", "brand"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** One page of the list at most: a bulk action is for what somebody can see. */
export const BULK_LIMIT = 100;
export const MIN_PERCENT = -90;
export const MAX_PERCENT = 1000;
export const MAX_RESTOCK = 100_000;

/**
 * A price moved by a percentage, to the fil, half up. Held in basis points so
 * 12.5% is exact; a percentage with more than two decimals is rounded to two.
 */
export function scalePrice(price: string, percent: number): string {
  const basis = BigInt(Math.round(percent * 100));
  const scaled = (toFils(price) * (10_000n + basis) * 2n + 10_000n) / 20_000n;
  return fromFils(scaled);
}

export function percentProblem(percent: number): "admin.bulkPercentInvalid" | null {
  return Number.isFinite(percent) && percent !== 0 && percent >= MIN_PERCENT && percent <= MAX_PERCENT ? null : "admin.bulkPercentInvalid";
}

export function restockProblem(amount: number): "admin.bulkRestockInvalid" | null {
  return Number.isInteger(amount) && amount >= 1 && amount <= MAX_RESTOCK ? null : "admin.bulkRestockInvalid";
}

/** The longest brand a product may carry. */
export const BRAND_MAX = 60;

/**
 * Why a brand cannot be set, or null. A brand is shown to every shopper, on
 * the card's search, the Brand filter and `/brands`, so it is held to the
 * listing's contact rule as well as a length: a phone number typed as the
 * brand would be the off-platform sale on every product it was set on.
 */
export function brandProblem(brand: string): "admin.bulkBrandInvalid" | null {
  const name = brand.trim();
  if (!name || name.length > BRAND_MAX) return "admin.bulkBrandInvalid";
  return contactFindings(name).length ? "admin.bulkBrandInvalid" : null;
}

/**
 * A product's specification rows with its Brand set — the row `brandOf`
 * reads, the Brand filter groups on and `commerce.brands` counts. Any earlier
 * brand row is replaced, wherever it sat, so a product carries one; the
 * product's own reviews and every other row are kept as they were.
 */
export function withBrand(attributes: readonly Attribute[], brand: string): Attribute[] {
  const row: Attribute = { namespace: SPEC_NAMESPACE, key: "brand", label: "Brand", value: brand.trim() };
  const at = attributes.findIndex(attribute => attribute.key === "brand" && attribute.namespace !== "reviews");
  if (at === -1) return [...attributes, row];
  return attributes.flatMap((attribute, index) =>
    index === at ? [row] : attribute.key === "brand" && attribute.namespace !== "reviews" ? [] : [attribute]);
}
