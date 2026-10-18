/**
 * Input schemas every router shares, for the things a column can actually hold.
 *
 * A zod schema that accepts more than the database does moves the refusal from
 * the router to the driver, and a driver refusal is a 500: the wrong status, a
 * raw Postgres sentence where a message key belongs, and a line in the error
 * log for something a shopper did by typing in the address bar. So the shape
 * of the column is part of the contract, not an implementation detail.
 *
 * Both of these are one export rather than a pattern each router repeats, for
 * the reason the password floor is one function: a bound written out sixty-five
 * times is a bound that is missing from one of them. It already was — every
 * `offerId` in `routers/offers.ts` was an unbounded `z.number().int()`, so a
 * negative one reached the query and `-9007199254740991` reached Postgres.
 */
import { z } from "zod";
import { DAY_ONLY, endOfKuwaitDay } from "../../../Shared/kuwaitDay.js";

/**
 * The largest value a Postgres `integer` holds, which is what every serial
 * primary key in `Backend/database/schema.ts` is.
 *
 * `.positive()` alone is not enough and that is the part that is easy to miss:
 * 2147483648 is positive, passes every check a router made, and fails inside
 * the database with "value is out of range for type integer".
 */
export const MAX_INT4 = 2_147_483_647;

/**
 * A row id: a whole number that a `serial` column could have issued.
 *
 * Anything outside it cannot name a row that exists, so refusing it in the
 * schema says the same thing a lookup would — and says it before spending a
 * query.
 */
export const rowId = z.number().int().positive().max(MAX_INT4);

/**
 * A percentage, to two decimal places, which is what `numeric(5, 2)` holds.
 *
 * Capped at 100 rather than at 999.99 because this is a commission rate, and
 * a rate above 100% means `commission + vendorNet === lineTotal` resolves with
 * the seller owing NetLet money on a sale they made. The column would accept
 * 500.00 quite happily; the arithmetic downstream is what cannot.
 */
export const percentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Expected a percentage like 12.5")
  .refine(value => Number.parseFloat(value) <= 100, "A rate above 100% would owe the seller nothing");

/**
 * A row id that travels as a string, which is how a cart line's does.
 *
 * `Cart` in `Shared/commerce/types.ts` calls a line's id a string, so the
 * router receives one and the data layer turns it back into a number — and
 * `Number("oops")` is `NaN`, which reaches Postgres as `NaN` and comes back as
 * a 500. Digits only, and within the same range a `serial` could have issued.
 */
export const rowIdText = z
  .string()
  .regex(/^\d+$/, "Expected a row id")
  .refine(value => {
    const id = Number(value);
    return id >= 1 && id <= MAX_INT4;
  }, "Outside the range of a row id");

/**
 * A pin on a map (3.2.7), or nothing.
 *
 * Only the shape here: a finite pair and no other keys. Whether it is in
 * Kuwait is `pinProblem` in `Shared/commerce/geo.ts`, which the picker asks
 * too, so the refusal arrives as a message key the page already knows how to
 * say rather than as a zod sentence.
 */
export const pinInput = z
  .object({ lat: z.number().finite(), lng: z.number().finite() })
  .strict()
  .nullish();

/**
 * The last day something is good for — a code's end, a card's or a permit's
 * expiry — as a date box sends it.
 *
 * A bare `yyyy-mm-dd` means the whole of that day in Kuwait, not its first
 * second in UTC, which is three in the morning there: the code that "ends on
 * the 20th" used to stop working at 3am on the 20th. A full timestamp is taken
 * as given, so an API caller that means a moment can still say one.
 */
export const lastDay = z.preprocess(
  value => (typeof value === "string" && DAY_ONLY.test(value) ? endOfKuwaitDay(value) : value),
  z.coerce.date(),
);

/**
 * An address as its parts (`Shared/commerce/kuwaitAddress.ts`), each bounded by
 * its column so a long one is refused here rather than by the driver. Which
 * are required, and what a PACI number looks like, is the shared rule's to say.
 */
export const addressPartsInput = z.object({
  area: z.string().max(60).nullish(),
  block: z.string().max(10).nullish(),
  street: z.string().max(120).nullish(),
  avenue: z.string().max(60).nullish(),
  building: z.string().max(60).nullish(),
  floor: z.string().max(10).nullish(),
  apartment: z.string().max(20).nullish(),
  paciNumber: z.string().max(12).nullish(),
}).nullish();
