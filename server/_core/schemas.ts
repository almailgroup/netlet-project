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

/**
 * The largest value a Postgres `integer` holds, which is what every serial
 * primary key in `drizzle/schema.ts` is.
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
 * `Cart` in `shared/commerce/types.ts` calls a line's id a string, so the
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
