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

export const BULK_ACTIONS = ["publish", "archive", "draft", "reprice", "restock"] as const;
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
