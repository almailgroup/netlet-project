/**
 * NetLet membership (4.1): free delivery, member prices, priority dispatch.
 *
 * Pure and shared, because every rule here is money a shopper pays or a
 * promise they decide on.
 *
 * ## Built now, activated later
 *
 * Buying a membership is a recurring payment, and payments are deliberately
 * untouched — so nothing on the storefront offers one, because a button that
 * cannot take the money is worse than no button. What exists now is every
 * benefit, and the one honest way in: **NetLet grants it** — to staff, to a
 * pilot group, to a shopper it owes an apology. When a payment provider
 * arrives, buying is a second `source` writing the same rows.
 *
 * ## Free delivery is NetLet's cost, recorded
 *
 * Each seller charges their own delivery (3.2.4), so a member's free delivery
 * is not the seller's to give: the seller's fee stands, the shopper pays
 * nothing, and the order freezes what was waived, per seller, beside the
 * breakdown. Who that money is settled with is a decision about who keeps
 * delivery fees at all; this records it so whichever way that goes, the
 * figure is there.
 *
 * ## A member price is an advertised saving
 *
 * A seller sets it per variant, below the shelf. It reaches a member only
 * while the store's Ministry of Commerce discount permit is valid — the rule
 * the strikethrough follows — and only a member ever sees it: telling
 * somebody "members pay KWD 18" when they cannot become one is a price they
 * are shown and cannot have. It never stacks with another reduction;
 * `shopperPrice` gives the lowest.
 *
 * ## Fast is first in the queue
 *
 * NetLet cannot make a van faster. What it can do is put a member's parcel
 * first on the dispatch board, so the next free driver takes it — the order
 * freezes that it was a member's, like every other fact about a sale.
 */
import { compareMoney, toFils, fromFils } from "../money.js";
import type { DeliveryQuote } from "./delivery.js";

/** The longest one grant may run, so a typo cannot hand out a decade. */
export const MAX_GRANT_MONTHS = 12;
export const MAX_GRANT_NOTE = 300;

export type MembershipRow = { id: number; startsAt: Date; endsAt: Date; cancelledAt: Date | null };

/** Whether a row is giving its benefits right now. */
export function isActive(row: MembershipRow, now: Date = new Date()): boolean {
  return row.cancelledAt === null && row.startsAt.getTime() <= now.getTime() && now.getTime() < row.endsAt.getTime();
}

/** When the shopper's membership runs to, across back-to-back grants, or null for none now. */
export function memberUntil(rows: readonly MembershipRow[], now: Date = new Date()): Date | null {
  const live = rows.filter(row => row.cancelledAt === null && row.endsAt.getTime() > now.getTime());
  if (!live.some(row => isActive(row, now))) return null;
  /* Grants queue end to end, so the membership lasts to the last one's end. */
  return new Date(Math.max(...live.map(row => row.endsAt.getTime())));
}

/**
 * Where a new grant starts and ends: after whatever is already running, so a
 * second grant extends a membership rather than overlapping the first.
 */
export function grantWindow(rows: readonly MembershipRow[], months: number, now: Date = new Date()): { startsAt: Date; endsAt: Date } {
  const until = memberUntil(rows, now);
  const startsAt = until ?? now;
  const endsAt = new Date(startsAt);
  endsAt.setUTCMonth(endsAt.getUTCMonth() + months);
  return { startsAt, endsAt };
}

export function validMonths(months: number): boolean {
  return Number.isInteger(months) && months >= 1 && months <= MAX_GRANT_MONTHS;
}

/** What is wrong with a member price a seller typed, or null. Blank clears it. */
export function memberPriceProblem(listPrice: string, memberPrice: string | null): "membership.priceNotBelow" | "membership.priceZero" | null {
  if (memberPrice === null) return null;
  if (toFils(memberPrice) <= 0n) return "membership.priceZero";
  if (compareMoney(memberPrice, listPrice) >= 0) return "membership.priceNotBelow";
  return null;
}

/**
 * The member price a shopper gets, or null: only for a member, only below the
 * shelf as it stands now (a seller who lowered the shelf under it has made it
 * moot), and only while the store may advertise a saving.
 */
export function memberPriceFor(input: { member: boolean; listPrice: string; memberPrice: string | null; permitValid: boolean }): string | null {
  if (!input.member || !input.permitValid || input.memberPrice === null) return null;
  return compareMoney(input.memberPrice, input.listPrice) < 0 && toFils(input.memberPrice) > 0n ? input.memberPrice : null;
}

/**
 * A member's delivery, waived: every seller's fee becomes nothing to the
 * shopper, and what each would have charged is kept as `waived`. Over a
 * minimum when NetLet has set one; a basket under it pays as anybody would.
 */
export function waiveDelivery(quote: DeliveryQuote, goodsTotal: string, freeOver: string | null): DeliveryQuote & { waived: string } {
  if (freeOver !== null && compareMoney(goodsTotal, freeOver) < 0) return { ...quote, waived: "0.000" };
  let waived = 0n;
  const perVendor = quote.perVendor.map(row => {
    const fee = toFils(row.fee);
    waived += fee;
    return fee > 0n ? { ...row, fee: "0.000", free: true, toFree: null, waived: row.fee } : { ...row, toFree: null };
  });
  return { perVendor, total: "0.000", waived: fromFils(waived) };
}
