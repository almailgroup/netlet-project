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
