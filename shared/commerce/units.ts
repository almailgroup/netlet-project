/**
 * Selling things that are not counted.
 *
 * A supermarket has two kinds of shelf. Most of it is counted — four tins, one
 * kettle — and some of it is measured: tomatoes by the kilo, olive oil by the
 * litre. NetLet only ever knew how to count, and the grocery section needs
 * both. This is the arithmetic for both, and it is pure for the reason the
 * order arithmetic is pure: a price shown per kilo and a price charged at the
 * till that disagree is a shop somebody stops trusting.
 *
 * **`quantity` stays an integer everywhere, and that is the whole design.**
 * The obvious move is to make quantity fractional so a shopper can buy 1.5 kg,
 * and it is a trap: a cart line, an order line, a stock take and a
 * `stock >= n` predicate would all become floating point, and 0.1 + 0.2 is not
 * 0.3 in any of them. Instead a variant declares the **step** it is sold in —
 * 250 g, say — and quantity counts steps. Six steps is 1.5 kg, exactly, in
 * integers, and every existing query keeps working unchanged.
 *
 * It is the same discipline `shared/money.ts` already applies to the dinar:
 * hold the small unit as an integer and derive the human number for display.
 * Weight gets grams, volume gets millilitres, and nothing is ever a float.
 */

/**
 * What a variant's price is quoted against.
 *
 * `each` is the default and the whole of the shop today — a variant with no
 * unit set behaves exactly as it always has, which is what lets this land
 * before the grocery section exists.
 */
export const SELL_UNITS = ["each", "g", "kg", "ml", "l"] as const;
export type SellUnit = (typeof SELL_UNITS)[number];

/** Which family a unit belongs to. Two units only compare inside one family. */
export type Dimension = "count" | "mass" | "volume";

export const DIMENSION_OF: Record<SellUnit, Dimension> = {
  each: "count",
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
};

/**
 * How many base units one of these is.
 *
 * Grams and millilitres are the base, chosen so every real shelf quantity is a
 * whole number of them: a 250 g step, a 1.5 l bottle, a 330 ml can. Anything
 * finer than a gram is not a thing a grocer weighs.
 */
const BASE_PER_UNIT: Record<SellUnit, number> = { each: 1, g: 1, kg: 1000, ml: 1, l: 1000 };

/** The unit a shopper expects a price to be quoted in, per family. */
export const CANONICAL: Record<Dimension, SellUnit> = { count: "each", mass: "kg", volume: "l" };

export type Measure = {
  /** What the variant is sold in. */
  unit: SellUnit;
  /**
   * How much one `quantity` step is, in `unit`.
   *
   * A 500 g bag of rice is `{ unit: "g", stepAmount: 500 }` and one quantity
   * is one bag. Loose tomatoes in quarter-kilos are `{ unit: "g", stepAmount:
   * 250 }` and six quantities is 1.5 kg. A kettle is `{ unit: "each",
   * stepAmount: 1 }`, which is every product in the shop today.
   */
  stepAmount: number;
};

export const EACH: Measure = { unit: "each", stepAmount: 1 };

/** Whether this variant is measured rather than counted. */
export function isMeasured(measure: Measure): boolean {
  return DIMENSION_OF[measure.unit] !== "count";
}

/** How much `quantity` steps come to, in base units (grams, ml, or items). */
export function baseUnitsFor(measure: Measure, quantity: number): number {
  return Math.round(measure.stepAmount * BASE_PER_UNIT[measure.unit]) * quantity;
}

/**
 * How much `quantity` steps actually weigh, in grams — or null.
 *
 * This is what decides the vehicle for a line nobody gave a size class to
 * (`shared/commerce/vehicle.ts`), so it is deliberately narrow: mass only.
 *
 * A litre of oil is *about* a kilo, and "about" is exactly the guess this
 * codebase refuses everywhere else it touches dispatch — a density assumption
 * dressed up as a measurement. Volume and count both answer null, and the
 * seller's declared size class is what speaks for them; unknown beats guessing
 * small, which is how a sofa gets sent on a motorcycle.
 */
export function massGramsFor(measure: Measure, quantity: number): number | null {
  if (DIMENSION_OF[measure.unit] !== "mass") return null;
  const grams = baseUnitsFor(measure, Math.max(1, Math.trunc(quantity)));
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

/**
 * The price per canonical unit — per kilo, per litre — as a money string.
 *
 * This is the number the law and the shopper both care about, and the one that
 * makes two sizes of the same thing comparable. Computed in fils and rounded
 * once at the end: doing it in floats gives 2.4000000000000004 on a price that
 * is supposed to have three decimal places.
 *
 * Null for a counted product, because "per each" is not a unit price — it is
 * just the price, and printing it twice is noise.
 */
export function unitPrice(stepPrice: string, measure: Measure): { amount: string; unit: SellUnit } | null {
  if (!isMeasured(measure)) return null;

  const base = baseUnitsFor(measure, 1);
  if (base <= 0) return null;

  const dimension = DIMENSION_OF[measure.unit];
  const canonical = CANONICAL[dimension];
  const perCanonical = BASE_PER_UNIT[canonical];

  // Integer fils throughout, one rounding at the end. See the file comment.
  const fils = toFilsLocal(stepPrice);
  const scaled = (fils * BigInt(perCanonical) * 1000n) / BigInt(base);
  const rounded = (scaled + 500n) / 1000n;

  return { amount: fromFilsLocal(rounded), unit: canonical };
}

/**
 * How much of the thing `quantity` steps is, said the way a person would.
 *
 * `{ value, unit }` rather than a formatted string, because the unit is a
 * translated word and formatting belongs to whoever knows the language. 1500 g
 * comes back as 1.5 kg, 800 g stays 800 g — the threshold is the canonical
 * unit, which is where a grocer's label switches too.
 */
export function measureOf(measure: Measure, quantity: number): { value: number; unit: SellUnit } | null {
  if (!isMeasured(measure)) return null;

  const base = baseUnitsFor(measure, quantity);
  const dimension = DIMENSION_OF[measure.unit];
  const canonical = CANONICAL[dimension];
  const perCanonical = BASE_PER_UNIT[canonical];

  if (base >= perCanonical) {
    // Up to three decimals, and trailing zeros dropped: 1.5 kg, not 1.500 kg.
    return { value: Math.round((base / perCanonical) * 1000) / 1000, unit: canonical };
  }
  return { value: base, unit: dimension === "mass" ? "g" : "ml" };
}

/**
 * Whether a measure is one the shop can actually sell.
 *
 * A zero or negative step is a division by zero waiting to happen in
 * `unitPrice`, and a fractional step in base units would put the float back in
 * through the other door — a 0.5 g step is not a thing, and allowing it means
 * `baseUnitsFor` rounds and the arithmetic stops being exact.
 */
export function isValidMeasure(measure: Measure): boolean {
  if (!SELL_UNITS.includes(measure.unit)) return false;
  if (!Number.isFinite(measure.stepAmount) || measure.stepAmount <= 0) return false;
  if (!isMeasured(measure)) return measure.stepAmount === 1;

  const base = measure.stepAmount * BASE_PER_UNIT[measure.unit];
  return Number.isInteger(base);
}

/*
 * `shared/money.ts` imports nothing from here and this imports nothing from
 * it, on purpose: money is used by the order arithmetic and a cycle between
 * the two would be a cycle in the part of the codebase that must stay easy to
 * reason about. These two helpers are the same three-decimal rule, locally.
 */
function toFilsLocal(amount: string): bigint {
  const [whole, fraction = ""] = String(amount).trim().split(".");
  const padded = (fraction + "000").slice(0, 3);
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * 1000n + BigInt(padded || "0"));
}

function fromFilsLocal(fils: bigint): string {
  const negative = fils < 0n;
  const absolute = negative ? -fils : fils;
  const whole = absolute / 1000n;
  const fraction = (absolute % 1000n).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
