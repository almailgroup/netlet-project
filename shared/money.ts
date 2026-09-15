/**
 * Dinar arithmetic, in fils, with no float anywhere near it.
 *
 * The Kuwaiti dinar has three decimal places, and a binary fraction cannot
 * hold 24.375 — so every amount in NetLet is a decimal string in the database
 * (`numeric`, never `real`) and every sum happens here, on `bigint` counts of
 * fils, the dinar's 1/1000 minor unit.
 *
 * This exists as its own module because the arithmetic had already been
 * written twice — once in `commission.ts` to split a line, once in
 * `catalog.ts` to total a cart — and orders would have made it three. Three
 * copies of money code is three places for a rounding rule to disagree, and
 * the disagreement shows up as a customer charged a fils more than the page
 * quoted, which is the kind of bug nobody reports and everybody notices.
 */

/** The dinar's minor unit per major unit. */
export const FILS_PER_DINAR = 1000n;

/** Decimal places a dinar amount carries, in the database and on the page. */
export const MONEY_SCALE = 3;

/**
 * A decimal string to fils.
 *
 * Extra decimal places are truncated rather than rounded: a price with four
 * decimals is already wrong, and rounding it up would quietly charge more than
 * whoever typed it intended. Truncating is the direction that cannot overcharge.
 */
export function toFils(amount: string | number): bigint {
  const text = typeof amount === "number" ? amount.toFixed(MONEY_SCALE) : amount.trim();
  if (text === "") return 0n;

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");

  const value =
    BigInt(whole === "" ? "0" : whole) * FILS_PER_DINAR +
    BigInt(fraction.padEnd(MONEY_SCALE, "0").slice(0, MONEY_SCALE) || "0");

  return negative ? -value : value;
}

/** Fils back to the decimal string the database and the page both want. */
export function fromFils(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  const text = `${abs / FILS_PER_DINAR}.${String(abs % FILS_PER_DINAR).padStart(MONEY_SCALE, "0")}`;
  return negative ? `-${text}` : text;
}

/** Sum any number of amounts. */
export function addMoney(...amounts: (string | number)[]): string {
  let total = 0n;
  for (const amount of amounts) total += toFils(amount);
  return fromFils(total);
}

export function subtractMoney(from: string, amount: string): string {
  return fromFils(toFils(from) - toFils(amount));
}

/**
 * An amount times a whole number of items.
 *
 * Quantity is truncated to a non-negative integer, because a line for −2 or
 * 1.5 of something is not a thing that can be bought, and letting it through
 * here turns a bad input into a bad total.
 */
export function multiplyMoney(amount: string, quantity: number): string {
  return fromFils(toFils(amount) * BigInt(Math.max(0, Math.trunc(quantity))));
}

/**
 * A percentage of an amount, exact to the fils.
 *
 * The percent is taken in hundredths so "12.5" stays exact rather than
 * becoming 0.125 in binary: fils × 1250 ÷ 10000, with the division truncating
 * — which rounds NetLet's own cut down, never the vendor's payout.
 */
export function percentOf(amount: string, percent: string | number): string {
  const hundredths = BigInt(Math.round(Number.parseFloat(String(percent) || "0") * 100));
  return fromFils((toFils(amount) * hundredths) / 10_000n);
}

/** Below, at, or above zero — without parsing the string twice at the call site. */
export function isZeroMoney(amount: string): boolean {
  return toFils(amount) === 0n;
}

export function isNegativeMoney(amount: string): boolean {
  return toFils(amount) < 0n;
}

/** Compare two amounts: negative, zero or positive, like a sort comparator. */
export function compareMoney(a: string, b: string): number {
  const left = toFils(a);
  const right = toFils(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Normalise any accepted form to the canonical three-decimal string. */
export function money(amount: string | number): string {
  return fromFils(toFils(amount));
}
