/**
 * What the product page's price says for the quantity chosen, on the owner's
 * word: "the main price should update automatically based on the selected
 * quantity … clearly display the individual unit price below or beside the
 * total price".
 *
 * **The headline is what the press would cost**: the price of one, plus the
 * extras ticked for it (installation and a warranty plan are per unit, as the
 * bag charges them — `addonsTotal`), times how many. The was-price is the same
 * sum on the was-price, so the struck figure less the total is the real saving
 * and the percent badge beside it, which is the product's own, still holds.
 *
 * **The unit line is always drawn**, at one too ("KWD 12.500 each"): a line
 * that appeared only from two would push the stepper down under the thumb
 * pressing its plus. It names the price of one with the extras, says so when
 * there are extras, and for something sold by weight names the step it is
 * sold in ("KWD 0.500 per 500 g") rather than "each".
 *
 * Integer fils throughout (`multiplyMoney`), so 3 × 12.375 is 37.125 and never
 * 37.12499999. The app's `QuantityPrice` is the same rule on these cases.
 *
 * Nothing here decides what is charged: the bag and the order price a line
 * themselves. This is what the page says before the press, and it says what
 * they would.
 */
import { addMoney, compareMoney, multiplyMoney } from "../money.js";
import type { Money } from "./types.js";
import { EACH, measureOf, type Measure, type SellUnit } from "./units.js";

export type QuantityPrice = {
  /** What this many cost, extras included. */
  total: Money;
  /** The was-price for this many, extras alike; null when there is no saving to show. */
  wasTotal: Money | null;
  /** One of them, extras included — what the unit line names. */
  unit: Money;
  /** How many the total is for, at least one. */
  quantity: number;
  /** Whether any extra is in the unit. */
  withExtras: boolean;
  /** One step of something sold by weight or volume ("500 g"), or null for a counted product. */
  step: { value: number; unit: SellUnit } | null;
};

/** At least one, a whole number: a sold-out page has no stepper, and a total for nothing reads as free. */
function wholeAtLeastOne(quantity: number): number {
  return Number.isFinite(quantity) ? Math.max(1, Math.trunc(quantity)) : 1;
}

export function priceForQuantity(input: {
  price: Money;
  compareAt?: Money | null;
  quantity: number;
  /** The extras ticked, each priced per unit. */
  extras?: readonly Money[];
  measure?: Measure | null;
}): QuantityPrice {
  const quantity = wholeAtLeastOne(input.quantity);
  const currencyCode = input.price.currencyCode;
  const extras = input.extras ?? [];
  const extrasEach = extras.length ? addMoney(...extras.map(extra => extra.amount)) : "0";
  const unit = addMoney(input.price.amount, extrasEach);
  const was = input.compareAt && compareMoney(input.compareAt.amount, input.price.amount) > 0
    ? addMoney(input.compareAt.amount, extrasEach)
    : null;
  return {
    total: { amount: multiplyMoney(unit, quantity), currencyCode },
    wasTotal: was === null ? null : { amount: multiplyMoney(was, quantity), currencyCode: input.compareAt!.currencyCode },
    unit: { amount: unit, currencyCode },
    quantity,
    withExtras: extras.length > 0,
    step: measureOf(input.measure ?? EACH, 1),
  };
}

/** The unit line's sentence: which dictionary key, by quantity, extras and how the thing is sold. */
export type UnitLineKey =
  | "product.priceEach"
  | "product.priceEachTimes"
  | "product.priceEachExtras"
  | "product.priceEachTimesExtras"
  | "product.pricePerStep"
  | "product.pricePerStepTimes";

export function unitLineKey(quote: QuantityPrice): UnitLineKey {
  const many = quote.quantity > 1;
  if (quote.step) return many ? "product.pricePerStepTimes" : "product.pricePerStep";
  if (quote.withExtras) return many ? "product.priceEachTimesExtras" : "product.priceEachExtras";
  return many ? "product.priceEachTimes" : "product.priceEach";
}
