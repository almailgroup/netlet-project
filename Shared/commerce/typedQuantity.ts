/**
 * A quantity typed into a bag line, on the owner's word: the number between
 * the minus and the plus is a box, so somebody who wants twenty does not press
 * the plus nineteen times.
 *
 * Pure and shared, for the reason the password floor is: the web's box and the
 * app's read a typed number the same way. Arabic-Indic digits are folded (an
 * Arabic keyboard is the obvious way to type one on the Arabic page); zero
 * takes the line out, the way the bin does; anything over the server's ceiling
 * is held to it and says so; and anything that is not a whole number — empty,
 * "2.5", "two" — changes nothing, so a slip of the thumb cannot empty a line.
 */
import { MAX_LINE_QUANTITY } from "./types.js";

export type TypedQuantity =
  | { kind: "set"; quantity: number; /** The number typed was over the ceiling and was held to it. */ capped: boolean }
  | { kind: "remove" };

/** Latin digits for the Arabic-Indic and Extended Arabic-Indic ones; nothing else changes. */
export function latinDigits(text: string): string {
  return [...text]
    .map(character => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      return character;
    })
    .join("");
}

/** What the box may hold while it is typed in: digits only, at most four of them. */
export function quantityDraft(text: string): string {
  return latinDigits(text).replace(/\D/g, "").slice(0, 4);
}

export function typedQuantity(text: string, ceiling: number = MAX_LINE_QUANTITY): TypedQuantity | null {
  const digits = latinDigits(text).trim();
  if (!/^\d{1,4}$/.test(digits)) return null;
  const value = Number(digits);
  if (value === 0) return { kind: "remove" };
  return { kind: "set", quantity: Math.min(value, ceiling), capped: value > ceiling };
}

/**
 * How many a bag line may hold: what is on the shelf for its variant (or, for a
 * pre-order, what the seller will promise — the larger pool, `maxQuantityFor`),
 * less what the bag's other lines of the same variant already take, held to the
 * line ceiling and never below one.
 *
 * The bag took up to the ceiling whatever the shelf held, so somebody could
 * press or type forty lamps with twenty-eight on the shelf, see nothing amiss,
 * and be told at Place order that something "has just sold out". A bag read
 * before lines carried `maxQuantity` has no figure, and the ceiling alone holds.
 */
export type StockedLine = { lineId: string; variantId: string; quantity: number; maxQuantity?: number };

export function lineCeiling(line: StockedLine, lines: readonly StockedLine[]): number {
  if (line.maxQuantity === undefined) return MAX_LINE_QUANTITY;
  const others = lines
    .filter(other => other.variantId === line.variantId && other.lineId !== line.lineId)
    .reduce((total, other) => total + other.quantity, 0);
  return Math.max(1, Math.min(MAX_LINE_QUANTITY, line.maxQuantity - others));
}

/**
 * The lines asking for more of their variant than there is, with how many
 * there are — the bag says so beside each, and checkout will not place the
 * order until they are lowered, rather than refusing it after the press.
 */
export function shortLines(lines: readonly StockedLine[]): Map<string, number> {
  const asked = new Map<string, number>();
  for (const line of lines) asked.set(line.variantId, (asked.get(line.variantId) ?? 0) + line.quantity);
  const short = new Map<string, number>();
  for (const line of lines) {
    if (line.maxQuantity === undefined) continue;
    if ((asked.get(line.variantId) ?? 0) > line.maxQuantity) short.set(line.lineId, Math.max(0, line.maxQuantity));
  }
  return short;
}

/**
 * How many more of a variant one press may put in the bag: what there is
 * (`maxQuantity`), less what the bag already holds of it in any line, held to
 * the line ceiling and never below one — the product page's and the
 * preview's stepper. With nothing left the add is the bag's to refuse.
 */
export function roomFor(maxQuantity: number, inBag: number): number {
  return Math.max(1, Math.min(MAX_LINE_QUANTITY, maxQuantity - inBag));
}

/**
 * The most a product card may put in its plain line: that line's own ceiling
 * once it is in the bag, otherwise what is left of the variant — the card's
 * stepper and the photo's, so the two cannot offer different numbers.
 */
export function cardCeiling(
  variant: { id: string; maxQuantity: number } | undefined,
  line: StockedLine | undefined,
  lines: readonly StockedLine[],
): number {
  if (!variant) return MAX_LINE_QUANTITY;
  if (line) return lineCeiling({ ...line, maxQuantity: line.maxQuantity ?? variant.maxQuantity }, lines);
  const inBag = lines.filter(other => other.variantId === variant.id).reduce((total, other) => total + other.quantity, 0);
  return roomFor(variant.maxQuantity, inBag);
}
