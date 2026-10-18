/**
 * How soon a seller says a thing ships.
 *
 * Requirement 3.2.5. Pure, and the reason is the same one the delivery fee has:
 * this is a promise a shopper decides on, and a promise you can only check by
 * placing an order is one nobody checks.
 *
 * ## What it is, and what it is not
 *
 * **It is the seller's own statement, not a computed guarantee.** NetLet has no
 * carrier integration — `docs/REQUIREMENTS.md` says so under 3.4 — so anything
 * calling itself an ETA here would be invented. A seller picks a band, the
 * shop repeats it, and the copy says who is promising.
 *
 * **Bands, not a number of hours.** "2 to 4 days" is what a seller can honestly
 * commit to and what a shopper can act on; "38 hours" is precision nobody has.
 *
 * **A product overrides its store**, in the shape commission and price requests
 * already use: null on the product means "no opinion, ask the store", which is
 * a different instruction from choosing the slowest band.
 *
 * **The Kuwaiti weekend is Friday and Saturday.** Counting plain calendar days
 * would promise a Thursday order on Saturday, which is a promise nobody in
 * Kuwait can keep. Business days are counted with that weekend, which is the
 * whole reason this is not `date + n`.
 *
 * **A pre-ordered line has no speed at all.** It ships when it arrives, and
 * `Shared/commerce/preorder.ts` already carries that date — two promises about
 * one parcel is how a shopper ends up believing the wrong one.
 */
import { KUWAIT_OFFSET_MS } from "../kuwaitDay.js";

/** The bands a seller may pick, slowest last. */
export const DELIVERY_SPEEDS = [
  "same_day",
  "next_day",
  "two_to_four",
  "up_to_week",
  "made_to_order",
] as const;
export type DeliverySpeed = (typeof DELIVERY_SPEEDS)[number];

/** Business days each band covers. Null where there is no honest number. */
const WINDOW: Record<DeliverySpeed, { min: number; max: number } | null> = {
  same_day: { min: 0, max: 0 },
  next_day: { min: 1, max: 1 },
  two_to_four: { min: 2, max: 4 },
  up_to_week: { min: 4, max: 7 },
  /* Made to order has no window by definition. Inventing one would turn "we
     will build it for you" into a date the seller never gave. */
  made_to_order: null,
};

export function isDeliverySpeed(value: unknown): value is DeliverySpeed {
  return typeof value === "string" && (DELIVERY_SPEEDS as readonly string[]).includes(value);
}

/**
 * The band that applies, product over store.
 *
 * Null from both means the seller has said nothing, and nothing is what the
 * page then shows — a default band would be NetLet making a promise on a
 * seller's behalf.
 */
export function resolveSpeed(
  vendorSpeed: string | null | undefined,
  productSpeed: string | null | undefined,
): DeliverySpeed | null {
  if (isDeliverySpeed(productSpeed)) return productSpeed;
  if (isDeliverySpeed(vendorSpeed)) return vendorSpeed;
  return null;
}

/** The band's window in business days, or null where there is none. */
export function windowFor(speed: DeliverySpeed): { min: number; max: number } | null {
  return WINDOW[speed];
}

/**
 * Friday and Saturday, which is the weekend this shop sells into — on Kuwait's
 * calendar. Read off the UTC day, an order placed at 1am on a Kuwaiti Friday
 * was a Thursday order and was promised "today".
 */
export function isWeekend(date: Date): boolean {
  const day = new Date(date.getTime() + KUWAIT_OFFSET_MS).getUTCDay();
  return day === 5 || day === 6;
}

/**
 * `days` business days after `from`, skipping the Kuwaiti weekend.
 *
 * Zero days still moves off a weekend: a "same day" order placed on a Friday
 * goes out on Sunday, and saying otherwise would promise a delivery on a day
 * the warehouse is shut.
 */
export function addBusinessDays(from: Date, days: number): Date {
  /* The Kuwaiti day it was placed on, held as that day's UTC midnight. */
  const local = new Date(from.getTime() + KUWAIT_OFFSET_MS);
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  let left = Math.max(0, Math.trunc(days));
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() + 1);
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) left -= 1;
  }
  return date;
}

export type Arrival = { speed: DeliverySpeed; from: Date; to: Date } | { speed: DeliverySpeed; from: null; to: null };

/**
 * When the seller's band says it would arrive, as a pair of dates.
 *
 * A pair rather than one date, because the band is a range and collapsing it
 * to its optimistic end is how a shop gets a reputation for being late. The
 * dates are null for a band that has no window, which the page states in words
 * instead.
 */
export function arrivalFor(speed: DeliverySpeed, placedAt: Date = new Date()): Arrival {
  const span = WINDOW[speed];
  if (!span) return { speed, from: null, to: null };
  return { speed, from: addBusinessDays(placedAt, span.min), to: addBusinessDays(placedAt, span.max) };
}

/**
 * What to show for one basket line.
 *
 * A pre-ordered line is `null`: it ships when it arrives, and the pre-order
 * date is the promise there. Two answers about one parcel is how a shopper
 * believes the wrong one.
 */
export function speedForLine(
  line: { preordered?: boolean },
  vendorSpeed: string | null | undefined,
  productSpeed: string | null | undefined,
): DeliverySpeed | null {
  if (line.preordered) return null;
  return resolveSpeed(vendorSpeed, productSpeed);
}

/**
 * The slowest band in a set, which is when the whole basket is complete.
 *
 * A basket arrives when its last parcel does. Reporting the fastest line would
 * be answering a question nobody asked.
 */
export function slowestSpeed(speeds: (DeliverySpeed | null)[]): DeliverySpeed | null {
  let worst: DeliverySpeed | null = null;
  for (const speed of speeds) {
    if (!speed) continue;
    if (!worst || DELIVERY_SPEEDS.indexOf(speed) > DELIVERY_SPEEDS.indexOf(worst)) worst = speed;
  }
  return worst;
}
