/**
 * A discount offer needs a licence, and in Kuwait that is the law.
 *
 * Requirement 3.3.19: "Requiring discount-license information to be attached
 * whenever a vendor creates a discount offer (a legal requirement in Kuwait)."
 * The Ministry of Commerce issues a discount permit for a *period*, so the
 * thing a vendor holds is not a flag but a number and a window — and a window
 * is the part that makes this interesting, because it stops being valid
 * without anybody touching the product.
 *
 * **That is why the rule is applied on the read, not only on the write.** A
 * check at the moment an offer is created is the obvious design and is not
 * enough: the licence expires on a Tuesday, no vendor saves anything, and the
 * shop keeps advertising a struck-through price it is no longer permitted to
 * advertise. `fromInventory` drops `compareAtPrice` when the licence is not
 * valid *now*, so the strikethrough, the `−27%` badge and the savings line all
 * disappear together, by construction rather than by three call sites each
 * remembering.
 *
 * The product is not hidden and the price does not move. An expired permit
 * means the shop may not call it a discount; it does not mean the thing cannot
 * be sold, and pulling it off the shelf would punish a shopper for a vendor's
 * paperwork.
 *
 * Pure, and in `shared`, because both sides need the same answer: the admin
 * portal has to refuse the save and the storefront has to refuse the badge, and
 * a rule that lived on one side would let the other contradict it.
 */

/** What a vendor recorded. Both null until somebody enters a permit. */
export type DiscountLicence = {
  number?: string | null;
  /** Inclusive. Null means the vendor gave a number and no end date. */
  expiresAt?: Date | string | null;
};

export type LicenceVerdict =
  | { allowed: true }
  /** `missing` — nothing recorded at all. `expired` — recorded and out of date. */
  | { allowed: false; reason: "missing" | "expired" };

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether this vendor may advertise a discount right now.
 *
 * A number with no end date is allowed. A permit whose expiry a vendor has not
 * recorded is a gap in our own form rather than evidence they have none, and
 * refusing on it would punish the seller for our missing field — the same
 * direction `missingStoreDetails` errs in, and the same one the return window
 * takes when a delivery date is unknown.
 *
 * An unparseable date is treated as no date, for the same reason.
 */
export function discountAllowed(licence: DiscountLicence | null | undefined, now: Date = new Date()): LicenceVerdict {
  const number = licence?.number?.trim();
  if (!number) return { allowed: false, reason: "missing" };

  const expires = asDate(licence?.expiresAt);
  if (expires && expires.getTime() < now.getTime()) return { allowed: false, reason: "expired" };

  return { allowed: true };
}

/**
 * Whether a price pair is an offer at all.
 *
 * Only a compare-at price *above* the price is a discount. Equal or lower is
 * not a claim about a saving, so it needs no permit — and a vendor who typed
 * the same number twice should not be told they need paperwork for it.
 */
export function isOffer(price: string, compareAtPrice: string | null | undefined): boolean {
  if (!compareAtPrice) return false;
  const now = Number(price);
  const was = Number(compareAtPrice);
  return Number.isFinite(now) && Number.isFinite(was) && was > now;
}

/**
 * How many days are left, for a warning before the shop goes quiet.
 *
 * Null when there is no expiry or no licence. Negative is possible and is the
 * honest answer: an admin looking at a store wants "expired 9 days ago" rather
 * than a flat "expired".
 */
export function daysUntilExpiry(licence: DiscountLicence | null | undefined, now: Date = new Date()): number | null {
  const expires = asDate(licence?.expiresAt);
  if (!expires || !licence?.number?.trim()) return null;
  return Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
}
