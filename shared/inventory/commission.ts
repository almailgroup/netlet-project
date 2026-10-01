/**
 * What NetLet takes from a sale, and what the vendor keeps.
 *
 * Pure, like the permission model, and for the same reason: this decides who
 * is owed money, and a rule you can only exercise through a database is a rule
 * nobody checks.
 *
 * The requirements ask for "fully flexible commission setup: percentage or
 * fixed amount, per vendor company or per individual product". That is two
 * independent axes, so:
 *
 * - **Shape**: a percentage, a fixed amount, or both together.
 * - **Scope**: a product's own rate wins over its vendor's, and null on the
 *   product means "use the vendor's" rather than "zero". Those are very
 *   different answers and conflating them is how a vendor ends up paying
 *   nothing by accident.
 *
 * Money is a decimal string throughout — never a float. The dinar has three
 * decimal places and a binary fraction cannot hold 24.375; `shared/money.ts`
 * is where that arithmetic lives, so this file decides the rule and not the
 * rounding.
 */
import { fromFils, toFils } from "../money.js";

/**
 * NetLet's standard rate, as a percentage of each sale (3.3.2).
 *
 * One constant, because three places state it: a new store's default, the
 * `/sell` page telling an applicant what they will pay before they apply, and
 * the approval form an administrator sets the rate on. Two of those used to be
 * a literal each, which is one policy in two places and a page that could
 * quote a rate the database no longer charges.
 */
export const DEFAULT_COMMISSION_PERCENT = "10.00";

export type CommissionRule = {
  /** Percent of the line, 0–100, as a decimal string. Null means none. */
  percent?: string | null;
  /** A flat amount per line, as a decimal string. Null means none. */
  fixed?: string | null;
};

export type CommissionBreakdown = {
  /** What the sale was worth. */
  gross: string;
  /** NetLet's cut. */
  commission: string;
  /** What the vendor is owed. */
  net: string;
  /** Which rule applied, so an invoice can say why. */
  source: "product" | "vendor";
  percentApplied: string;
  fixedApplied: string;
};

/**
 * Which rule governs a line: the product's own, or its vendor's.
 *
 * A product overrides only if it sets something. A product row with both
 * columns null is not an override of "nothing" — it is the absence of one.
 */
export function resolveRule(
  vendor: CommissionRule,
  product?: CommissionRule | null,
): { rule: CommissionRule; source: "product" | "vendor" } {
  const overrides =
    product != null &&
    ((product.percent !== null && product.percent !== undefined) ||
      (product.fixed !== null && product.fixed !== undefined));
  return overrides ? { rule: product, source: "product" } : { rule: vendor, source: "vendor" };
}

/**
 * Split one line between NetLet and the vendor.
 *
 * `quantity` multiplies both the line and the fixed amount: a fixed fee is per
 * item sold, not per order line, which is what a vendor selling ten of
 * something expects to be charged.
 *
 * The commission is clamped to the line total. A fixed fee larger than a cheap
 * item would otherwise produce a negative payout — NetLet charging a vendor for
 * making a sale — which is never the intent of a rate card.
 */
export function commissionFor(
  unitPrice: string,
  quantity: number,
  vendor: CommissionRule,
  product?: CommissionRule | null,
  /**
   * Anything else this line is worth, already totalled for the whole line.
   *
   * Today that is the optional extras (3.1.2) — a fitting, an extended
   * warranty. They are the seller's own service on the seller's own line, so
   * the platform's cut is taken on them exactly as it is on the goods, and
   * `commission + net === lineTotal` keeps holding on every line, which is the
   * identity the finance panel is tested against.
   */
  extra = "0.000",
): CommissionBreakdown {
  const { rule, source } = resolveRule(vendor, product);

  const grossFils =
    toFils(unitPrice) * BigInt(Math.max(0, Math.trunc(quantity))) + toFils(extra);

  const percent = rule.percent?.trim() || "0";
  const fixed = rule.fixed?.trim() || "0";

  // Percent in hundredths so "12.50" stays exact: fils × 1250 / 10000.
  const percentHundredths = BigInt(Math.round(Number.parseFloat(percent) * 100));
  const fromPercent = (grossFils * percentHundredths) / 10_000n;
  const fromFixed = toFils(fixed) * BigInt(Math.max(0, Math.trunc(quantity)));

  let commissionFils = fromPercent + fromFixed;
  if (commissionFils > grossFils) commissionFils = grossFils;
  if (commissionFils < 0n) commissionFils = 0n;

  return {
    gross: fromFils(grossFils),
    commission: fromFils(commissionFils),
    net: fromFils(grossFils - commissionFils),
    source,
    percentApplied: percent,
    fixedApplied: fixed,
  };
}

/** Sum a set of breakdowns — an order, a payout run, a report row. */
export function totalCommission(lines: CommissionBreakdown[]): {
  gross: string;
  commission: string;
  net: string;
} {
  let gross = 0n;
  let commission = 0n;
  for (const line of lines) {
    gross += toFils(line.gross);
    commission += toFils(line.commission);
  }
  return { gross: fromFils(gross), commission: fromFils(commission), net: fromFils(gross - commission) };
}
