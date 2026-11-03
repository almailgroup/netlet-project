/**
 * A discount code on one product, rather than the whole basket — on the
 * owner's word (migration 0074): "apply a discount code to a specific product
 * in the shopping cart … the discount should apply only to that specific
 * product, without affecting the prices of other products", and "support
 * product-specific and seller-specific discount codes, especially since NetLet
 * is a multi-vendor marketplace".
 *
 * Pure, for the reason `vouchers.ts` is: what this decides is money somebody
 * pays and money a store is paid.
 *
 * ## What a code covers
 *
 * `order` is every code before this one: the whole basket, typed in the
 * order's own box. `store` covers every product of one store, and `products`
 * the ones listed for it. A store's or a product's code is typed on its line
 * at checkout and comes off that line alone; the order box refuses it, and a
 * line refuses an order code, each saying where the code belongs.
 *
 * ## Who pays for it
 *
 * Whoever made it, on the owner's word: a store's own code comes out of the
 * store's earnings and NetLet's commission is taken on what the shopper
 * actually paid; a code NetLet makes is paid by NetLet and the store is paid
 * in full (`freezeLine`). **A store's code needs its discount permit**, also
 * on the owner's word — the same Ministry permit its struck-through prices
 * need — and without a valid one it is refused with a reason saying so.
 *
 * ## Per line, not per unit
 *
 * A percentage is of the line's value — the goods and their extras — so it
 * follows the quantity by itself. A fixed amount is off the line, capped at
 * it, and a minimum spend is the line's value: a code typed on a line is a
 * promise about that line. A line in a set (a bundle) refuses a code, because
 * its price is already a set's price.
 */
import { discountOf, voucherRefusal, type DiscountCode, type VoucherRefusal } from "./vouchers.js";

export const CODE_SCOPES = ["order", "store", "products"] as const;
export type CodeScope = (typeof CODE_SCOPES)[number];

export const CODE_FUNDERS = ["netlet", "store"] as const;
export type CodeFunder = (typeof CODE_FUNDERS)[number];

/** A code with what it covers and who pays for it. */
export type ScopedCode = DiscountCode & {
  scope: CodeScope;
  /** The store whose products it covers; null for an order code. */
  vendorId: number | null;
  fundedBy: CodeFunder;
  /** For `products`: which. */
  productIds: readonly number[];
};

export type LineCodeRefusal =
  | VoucherRefusal
  | "voucher.orderWide"
  | "voucher.notForProduct"
  | "voucher.notOnSet"
  | "voucher.storeUnavailable"
  | "voucher.giftOnLine"
  | "voucher.lineBelowMinimum";

/** The line a code is typed on. */
export type CodeLine = {
  productId: number;
  vendorId: number;
  /** The goods and their extras for this line, at the price the shopper pays. */
  value: string;
  /** Sold in a set, whose price is already the set's. */
  inBundle: boolean;
};

export function isCodeScope(value: unknown): value is CodeScope {
  return typeof value === "string" && (CODE_SCOPES as readonly string[]).includes(value);
}

export function isCodeFunder(value: unknown): value is CodeFunder {
  return typeof value === "string" && (CODE_FUNDERS as readonly string[]).includes(value);
}

/** Whether a store's or a product's code is for this line's product at all. */
export function codeCovers(code: Pick<ScopedCode, "scope" | "vendorId" | "productIds">, line: Pick<CodeLine, "productId" | "vendorId">): boolean {
  if (code.scope === "store") return code.vendorId !== null && code.vendorId === line.vendorId;
  if (code.scope === "products") {
    if (code.vendorId !== null && code.vendorId !== line.vendorId) return false;
    return code.productIds.includes(line.productId);
  }
  return false;
}

/**
 * Why this code cannot come off this line, as a message key, or null. In the
 * order a shopper can act on: the wrong box, the wrong product, a set, a store
 * whose discounts are not available, then the code's own terms.
 */
export function lineCodeRefusal(
  code: ScopedCode,
  line: CodeLine,
  context: { used: number; usedByShopper: number; permitValid: boolean; now?: Date },
): LineCodeRefusal | null {
  if (code.scope === "order") return "voucher.orderWide";
  if (!codeCovers(code, line)) return "voucher.notForProduct";
  if (line.inBundle) return "voucher.notOnSet";
  if (code.fundedBy === "store" && !context.permitValid) return "voucher.storeUnavailable";
  const refusal = voucherRefusal(code, { goods: line.value, used: context.used, usedByShopper: context.usedByShopper, now: context.now });
  /* The minimum is this product's own total, so the sentence says so rather
     than the basket's. */
  return refusal === "voucher.belowMinimum" ? "voucher.lineBelowMinimum" : refusal;
}

/** What a code takes off one line: of the line's value, capped at it. */
export function lineCodeDiscount(code: Pick<ScopedCode, "kind" | "value">, value: string): string {
  return discountOf(code, value);
}

/** The order's own box takes an order code; a store's or a product's belongs on its line. */
export function orderBoxRefusal(scope: CodeScope): "voucher.forProducts" | null {
  return scope === "order" ? null : "voucher.forProducts";
}

/**
 * What a code may be made with, by whom — the server's refusal, asked early by
 * the portal's form. A store makes codes for its own store or its own
 * products, paid by itself; NetLet makes any, and says who pays.
 */
export function codeShapeProblem(input: {
  scope: CodeScope;
  vendorId: number | null;
  fundedBy: CodeFunder;
  productIds: readonly number[];
}): "promotion.needsStore" | "promotion.needsProducts" | "promotion.orderIsNetlet" | null {
  if (input.scope === "order") return input.vendorId === null && input.fundedBy === "netlet" ? null : "promotion.orderIsNetlet";
  if (input.vendorId === null) return "promotion.needsStore";
  if (input.scope === "products" && input.productIds.length === 0) return "promotion.needsProducts";
  return null;
}
