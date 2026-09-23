/**
 * Asking the seller for a better price.
 *
 * Requirement 3.1.13: a shopper may request a special discount on a product,
 * and the vendor opts in. This is the whole rule set and it is pure, for the
 * reason the order arithmetic and the commission split are: what it decides is
 * a price somebody pays, and a rule you can only exercise by talking a real
 * vendor into a real discount is a rule nobody checks.
 *
 * ## What is stored and what is worked out
 *
 * Four stored states — `pending`, `offered`, `declined`, `withdrawn` — and two
 * more that are **derived on the read**: expired, from the date, and used,
 * from the order it was spent on. Deriving them is the same decision the
 * discount permit makes and for the same reason: a stored `expired` needs
 * something to go round and write it, and until that something runs the row
 * says a price is still good when it is not. Nothing has to run here.
 *
 * ## The rules that cost money
 *
 * **An agreed price is a ceiling, never a floor.** If the catalog price falls
 * below what the seller agreed, the shopper pays the catalog price. Charging
 * somebody more than the shelf says because they once asked for a discount is
 * the single worst thing this feature could do.
 *
 * **A shopper may not ask for more than the asking price**, and a seller may
 * not answer with more either — an "offer" above the shelf price is not an
 * offer. Neither may be zero: that is the money rule `assertPriced` puts on
 * the two doors onto the shelf, applied here, where a free product would
 * otherwise arrive by negotiation.
 *
 * **A personal price is not an advertised discount**, so it needs no Ministry
 * of Commerce permit — `shared/inventory/discountLicence.ts` governs what the
 * shop *advertises*, and this is a figure quoted to one shopper who asked for
 * it. That is also why it never sets `compareAtPrice`: the strikethrough and
 * the `−27%` badge are the machinery of a public claim, and reusing them here
 * would turn a private answer into one.
 *
 * **The vendor opts in, and a product overrides its vendor.** Same shape as
 * the commission rate, deliberately: an explicit `false` on a product means
 * "not this one", an absent value means "no opinion, ask the vendor". A seller
 * who will haggle over a sofa and not over batteries needs both answers.
 */
import { compareMoney, isNegativeMoney, isZeroMoney } from "../money.js";

/** How long a seller has to answer before the request goes stale. */
export const ASK_WINDOW_DAYS = 7;

/**
 * How long an answered price is good for.
 *
 * Shorter than the ask window on purpose: a seller deciding whether to take
 * less has the week, and a shopper holding a price the seller has already
 * committed to has three days to use it. An open-ended personal price is a
 * discount the seller can never withdraw.
 */
export const OFFER_WINDOW_DAYS = 3;

/** What a shopper may write alongside the request, and the seller back. */
export const MAX_NOTE = 400;

/** What the row holds. */
export const OFFER_STATUSES = ["pending", "offered", "declined", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** What the row *means*, once the clock and the order are taken into account. */
export type OfferState = OfferStatus | "expired" | "used";

/** The columns this module reads. Anything else is the database half's. */
export type OfferRow = {
  status: OfferStatus;
  offeredPrice: string | null;
  expiresAt: Date | string | null;
  usedOnOrderId: number | null;
};

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * What the row means now.
 *
 * Order matters: spent beats expired beats stored. A request the shopper
 * already bought against is `used` even if the window has since closed —
 * otherwise an order placed on the last afternoon would be reported a week
 * later as a price that ran out.
 */
export function resolveOffer(row: OfferRow, now: Date = new Date()): OfferState {
  if (row.usedOnOrderId !== null) return "used";
  if (row.status === "declined" || row.status === "withdrawn") return row.status;
  const expires = asDate(row.expiresAt);
  /*
   * A missing date leaves it open, which is the direction `missingStoreDetails`
   * and the return window both err in: a gap in our own row is our problem,
   * and a seller's answer should not evaporate because a column was null.
   */
  if (expires && expires.getTime() <= now.getTime()) return "expired";
  return row.status;
}

/** A price the shopper can actually spend right now. */
export function isSpendable(row: OfferRow, now: Date = new Date()): boolean {
  return resolveOffer(row, now) === "offered" && row.offeredPrice !== null;
}

/** Still waiting on the seller. */
export function isOpen(row: OfferRow, now: Date = new Date()): boolean {
  return resolveOffer(row, now) === "pending";
}

/**
 * What this shopper pays for one unit.
 *
 * The lower of the agreed price and the shelf price, always. An agreed price
 * is a ceiling: a shopper who negotiated 45 and came back to find the shelf at
 * 40 pays 40, because the alternative is charging somebody a penalty for
 * having asked.
 */
export function priceFor(listPrice: string, row: OfferRow | null, now: Date = new Date()): string {
  if (!row || !isSpendable(row, now) || row.offeredPrice === null) return listPrice;
  return compareMoney(row.offeredPrice, listPrice) < 0 ? row.offeredPrice : listPrice;
}

/** A positive amount of money, and not a blank. */
function isPositive(amount: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(amount.trim()) && !isZeroMoney(amount) && !isNegativeMoney(amount);
}

/**
 * May the shopper ask this?
 *
 * Below the shelf price and above nothing. Asking for *more* is not a discount
 * request, and asking for zero is asking for a gift — the same money rule
 * `assertPriced` applies at the two doors onto the shelf.
 */
export function acceptableAsk(listPrice: string, ask: string): boolean {
  return isPositive(ask) && isPositive(listPrice) && compareMoney(ask, listPrice) < 0;
}

/**
 * May the seller answer with this?
 *
 * At or below the shelf price — equal is allowed, because a seller who wants
 * to say "no discount, but here is my price" should not have to decline — and
 * above nothing, for the reason above.
 */
export function acceptableOffer(listPrice: string, offered: string): boolean {
  return isPositive(offered) && isPositive(listPrice) && compareMoney(offered, listPrice) <= 0;
}

/**
 * Whether this product may be haggled over.
 *
 * The product's own value wins and an absent one inherits — the same rule
 * commission follows, and for the same reason: "not this product" and "no
 * opinion about this product" are different instructions, and collapsing them
 * loses one of them.
 */
export function negotiable(vendorAccepts: boolean, productAccepts: boolean | null): boolean {
  return productAccepts ?? vendorAccepts;
}

/** When a request the seller has not answered goes stale. */
export function askExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + ASK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** When an answered price runs out. */
export function offerExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + OFFER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Whole days left on a live price, for the line that tells the shopper.
 *
 * Rounded up, so the last few hours read as "1 day left" rather than "0" — a
 * price that is still spendable must never be described as gone.
 */
export function daysLeft(row: OfferRow, now: Date = new Date()): number | null {
  const expires = asDate(row.expiresAt);
  if (!expires || !isSpendable(row, now)) return null;
  return Math.max(1, Math.ceil((expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}
