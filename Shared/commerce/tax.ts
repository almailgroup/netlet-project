/**
 * Tax, added at checkout (migration 0087, on the owner's word: "a Tax field
 * below the pricing summary, configurable for future activation on specific
 * products or all products").
 *
 * Pure and imported by both sides, for the reason the order arithmetic is:
 * what it decides is money a shopper hands a driver, and the summary on the
 * page and the figure the order freezes must be one function.
 *
 * **Off until NetLet switches it on.** Kuwait charges no VAT today, so the
 * `tax` switch starts off and a shop behaves exactly as it did before this
 * existed. Four answers the owner gave shape the rest:
 *
 * - **Added at checkout.** A seller's price is what the shelf says, and tax
 *   is a line of its own under the subtotal and delivery — the total goes up
 *   by it. It never touches a line's total, so commission plus the seller's
 *   share still equals the line, and finance and payouts read exactly what
 *   they read before.
 * - **On the goods, never on delivery.**
 * - **One shop rate** (`tax.ratePercent`, an administrator's setting).
 * - **NetLet alone decides which products.** Every product (`taxAllProducts`
 *   on), or only the ones NetLet chose; and either way a product can be
 *   marked taxed or not taxed on its own, which wins over the shop's default.
 *
 * **Each line's tax is its own**, on what the line costs the shopper — its
 * units and extras at their price, less its own code — rounded to the fil,
 * half up, and frozen on the order line. An order-wide code, points and a
 * gift card come off the total after tax, the order the till already
 * settles in, so a refund of one item hands back that item's tax exactly.
 */
import { addMoney, fromFils, toFils } from "../money.js";

/** The highest rate an administrator may set; the GCC's standard is five. */
export const MAX_TAX_PERCENT = 30;

/** Whether a product follows the shop's default, or NetLet chose for it. */
export type ProductTaxChoice = "taxed" | "exempt";

export type TaxRules = {
  /** The `tax` switch. */
  on: boolean;
  /** The shop's rate, a percentage with up to two decimals ("5.00"). */
  ratePercent: string;
  /** The `taxAllProducts` switch: every product, or only those marked taxed. */
  allProducts: boolean;
};

/** No tax, as a shop with the switch off — and the answer before 0087 is pasted. */
export const NO_TAX: TaxRules = { on: false, ratePercent: "0.00", allProducts: true };

/**
 * A product's own choice from its `product_tax` row: no row follows the shop,
 * a rate of nothing is "not taxed", and any other row (the shop's rate, null)
 * is "taxed". One shop rate, so a row never carries a rate of its own.
 */
export function choiceFromRow(rate: string | null | undefined, present: boolean): ProductTaxChoice | null {
  if (!present) return null;
  return rate !== null && rate !== undefined && toFils(rate) === 0n ? "exempt" : "taxed";
}

/** What a choice is stored as: the shop's rate (null), or nothing. */
export function rowRateFor(choice: ProductTaxChoice): string | null {
  return choice === "exempt" ? "0.00" : null;
}

/** The rate in hundredths of a percent, or nothing for a rate that cannot be read. */
function hundredthsOf(ratePercent: string): bigint {
  const number = Number.parseFloat(ratePercent);
  if (!Number.isFinite(number) || number <= 0) return 0n;
  return BigInt(Math.round(Math.min(number, MAX_TAX_PERCENT) * 100));
}

/** Whether tax is being charged at all: on, at a rate above nothing. */
export function taxCharging(rules: TaxRules): boolean {
  return rules.on && hundredthsOf(rules.ratePercent) > 0n;
}

/**
 * Whether this product is taxed now: only while tax is charging, by its own
 * choice where NetLet made one, and otherwise by the shop's default.
 */
export function isTaxed(rules: TaxRules, choice: ProductTaxChoice | null): boolean {
  if (!taxCharging(rules)) return false;
  return choice ? choice === "taxed" : rules.allProducts;
}

/** The tax on an amount at a rate, to the fil, half up. Never below nothing. */
export function taxOn(amount: string, ratePercent: string): string {
  const fils = toFils(amount);
  const hundredths = hundredthsOf(ratePercent);
  if (fils <= 0n || hundredths === 0n) return "0.000";
  return fromFils((fils * hundredths + 5_000n) / 10_000n);
}

/** The rate as it is shown and frozen: two decimals ("5.00"). */
export function rateText(ratePercent: string): string {
  return (Number(hundredthsOf(ratePercent)) / 100).toFixed(2);
}

/** The rate as a person reads it: "5%", "2.5%". */
export function rateLabel(ratePercent: string): string {
  const exact = Number(hundredthsOf(ratePercent)) / 100;
  return `${Number.isInteger(exact) ? exact.toFixed(0) : String(exact)}%`;
}

export type TaxableLine = {
  /** What the line costs the shopper: units and extras, less its own code. */
  lineTotal: string;
  choice: ProductTaxChoice | null;
};

/** Each line's tax, in the order given, and what they come to. */
export function taxLines(rules: TaxRules, lines: readonly TaxableLine[]): { amounts: string[]; total: string } {
  const amounts = lines.map(line => (isTaxed(rules, line.choice) ? taxOn(line.lineTotal, rules.ratePercent) : "0.000"));
  return { amounts, total: addMoney("0.000", ...amounts) };
}

/**
 * Splits a frozen line's tax when part of the line is cancelled (changing an
 * order before pickup): the kept part's tax is the rule's on its own total,
 * and the rest is the cancelled part's — so the two add up to what was frozen,
 * to the fil, whatever the rounding did.
 */
export function splitTax(frozenTax: string, ratePercent: string, keptLineTotal: string): { kept: string; gone: string } {
  const whole = toFils(frozenTax);
  const kept = toFils(taxOn(keptLineTotal, ratePercent));
  const capped = kept > whole ? whole : kept;
  return { kept: fromFils(capped), gone: fromFils(whole - capped) };
}
