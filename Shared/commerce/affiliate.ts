/**
 * Affiliate marketing (3.7): somebody with an audience shares a link, and a
 * sale that comes through it earns them a share.
 *
 * Pure, because every number here is money somebody is owed — the reason the
 * referral ledger is pure, and this shares that ledger rather than building a
 * second one.
 *
 * ## Paid out of NetLet's cut, never the seller's
 *
 * An affiliate is NetLet's marketing, so NetLet pays for it: each line earns
 * the affiliate's rate on its frozen total, **capped at the commission NetLet
 * took on that line**. The seller's net is untouched, and NetLet can never pay
 * an affiliate more for a sale than it earned from it — a rate set high by
 * mistake costs margin, not money NetLet does not have.
 *
 * ## Earned when the sale completes, reversed when it does not
 *
 * Credited when the cash is collected, the moment a referral pays and for the
 * same reason: an order nobody paid for has earned nobody anything. A line
 * refunded afterwards takes its share back, as a negative entry worked out from
 * the same frozen figures, so the reversal is exact to the fil and needs no
 * record of what was paid beyond the order itself.
 *
 * ## Attribution is the last link, for thirty days, and never your own
 *
 * The browser keeps the last affiliate code it arrived with and the moment it
 * arrived. An order inside `ATTRIBUTION_DAYS` carries it, the server checks the
 * affiliate is approved and is not the buyer, and the order freezes who and at
 * what rate. Buying through your own link is refused for the reason
 * self-referral is: it is a discount the affiliate gives themselves.
 *
 * ## The shopper is told
 *
 * A shopper who arrived through a link sees whose, and that it earns them a
 * commission at no cost to the shopper. Paid promotion that hides itself is
 * what advertising rules exist to stop, and saying it costs nothing.
 *
 * ## Money, not points
 *
 * An affiliate's earnings sit in the same ledger as referral points but in
 * their own pot, counted in fils and cashed out at face value. Referral points
 * cash out less a 10% cash-collection fee, the document's rule for points; an
 * affiliate's commission is payment for work and is paid whole.
 */
import { fromFils, toFils } from "../money.js";
import { isKept } from "./collection.js";

/** The rate a new affiliate earns, in percent of the goods. Admin-set per affiliate after that. */
export const DEFAULT_AFFILIATE_PERCENT = "3.00";

/** The highest rate an administrator may set. */
export const MAX_AFFILIATE_PERCENT = 20;

/** How long a click keeps counting. */
export const ATTRIBUTION_DAYS = 30;

/** The smallest affiliate balance worth a payout, in fils: KWD 5.000. */
export const MIN_AFFILIATE_PAYOUT_FILS = 5000n;

export const AFFILIATE_STATUSES = ["pending", "active", "suspended"] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

/** The ledger pot an entry belongs to. Referral points, or affiliate money. */
export const POTS = ["points", "affiliate"] as const;
export type Pot = (typeof POTS)[number];

const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23456789";

/**
 * An affiliate's code from their account id: `AF` and the same misheard-free
 * alphabet the referral code uses. Derived rather than stored, for the
 * referral code's reason — one account, one code, nothing to edit into a
 * collision — and prefixed differently so the two kinds of link cannot be
 * mistaken for each other by the person reading one out.
 */
export function affiliateCodeFor(userId: number): string {
  let value = Math.max(1, Math.trunc(userId));
  let code = "";
  while (value > 0) {
    code = ALPHABET[value % ALPHABET.length] + code;
    value = Math.floor(value / ALPHABET.length);
  }
  return `AF${code.padStart(4, ALPHABET[0])}`;
}

/** The account an affiliate code names, or null. */
export function userIdFromAffiliateCode(code: string): number | null {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed.startsWith("AF")) return null;
  const body = trimmed.slice(2);
  if (!body || body.length > 8 || [...body].some(character => !ALPHABET.includes(character))) return null;
  let value = 0;
  for (const character of body) value = value * ALPHABET.length + ALPHABET.indexOf(character);
  return value > 0 ? value : null;
}

/** Whether a click from `clickedAt` still counts at `now`. */
export function withinAttribution(clickedAt: Date | string | number, now: Date): boolean {
  const at = new Date(clickedAt).getTime();
  if (!Number.isFinite(at) || at > now.getTime() + 60_000) return false;
  return now.getTime() - at <= ATTRIBUTION_DAYS * 86_400_000;
}

/** A frozen order line, as much of it as the commission needs. */
export type AffiliateLine = { lineTotal: string; commissionAmount: string; fulfilment: string };

/**
 * One line's share, in fils: the rate on its total, rounded down, and never
 * more than NetLet's own commission on it. Rounded down because rounding a
 * payout up invents money.
 */
export function lineShareFils(line: Pick<AffiliateLine, "lineTotal" | "commissionAmount">, ratePercent: string): bigint {
  const total = toFils(line.lineTotal);
  const basisPoints = toFils(ratePercent) / 10n; // "3.00" → 3000 fils → 300 basis points
  const share = (total * basisPoints) / 10_000n;
  const ceiling = toFils(line.commissionAmount);
  return share < 0n ? 0n : share > ceiling ? ceiling : share;
}

/** The order's share across the lines that were actually sold. */
export function orderShareFils(lines: AffiliateLine[], ratePercent: string): bigint {
  return lines.filter(line => isKept(line.fulfilment)).reduce((sum, line) => sum + lineShareFils(line, ratePercent), 0n);
}

/**
 * The share a **store** funds on one of its own products (3.7.1, migration
 * 0063): its rate on the line's total, rounded down. Frozen on the line as
 * `affiliate_vendor_percent` and passed through NetLet's commission — added to
 * it and taken off the seller's net at the sale — so `commission + net` is
 * still the line's total, and NetLet pays the affiliate exactly what the store
 * gave up. A line whose seller would net less than the share is never given a
 * percent at the sale (`affiliateFitsLine`), so this needs no ceiling to stay
 * the figure that was actually moved.
 */
export function vendorAffiliateFils(lineTotal: string, percent: string | null | undefined): bigint {
  if (!percent) return 0n;
  const total = toFils(lineTotal);
  const share = (total * (toFils(percent) / 10n)) / 10_000n;
  return share > 0n ? share : 0n;
}

/** Whether a store's affiliate rate fits a line: the share must come out of what the seller nets. */
export function affiliateFitsLine(lineTotal: string, vendorNet: string, percent: string): boolean {
  return vendorAffiliateFils(lineTotal, percent) <= toFils(vendorNet);
}

/**
 * NetLet's own commission on a line: what it took, less the store-funded
 * affiliate share that only passes through it. What a referral's percentage is
 * taken of (3.1.15), so a referral can never be paid out of an affiliate's money.
 */
export function netletCommissionFils(line: { lineTotal: string; commissionAmount: string; affiliateVendorPercent?: string | null }): bigint {
  const own = toFils(line.commissionAmount) - vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent);
  return own > 0n ? own : 0n;
}

/**
 * An order's frozen lines with each store's affiliate share passed through
 * NetLet's commission (3.7.1): `optedIn` is the products' own rates, and a line
 * takes part only when its product has one and the share fits inside what its
 * seller nets. The commission total follows, so the order's figures still add
 * up to what each line already did.
 */
export function withAffiliateShares<
  L extends { productId: number; lineTotal: string; commissionAmount: string; vendorNet: string },
  T extends { commissionTotal: string },
>(draft: { lines: L[]; totals: T }, optedIn: ReadonlyMap<number, string>): { lines: (L & { affiliateVendorPercent: string | null })[]; totals: T } {
  let commission = 0n;
  const lines = draft.lines.map(line => {
    const percent = optedIn.get(line.productId) ?? null;
    if (!percent || !affiliateFitsLine(line.lineTotal, line.vendorNet, percent)) {
      commission += toFils(line.commissionAmount);
      return { ...line, affiliateVendorPercent: null };
    }
    const share = vendorAffiliateFils(line.lineTotal, percent);
    const commissionAmount = toFils(line.commissionAmount) + share;
    commission += commissionAmount;
    return {
      ...line,
      commissionAmount: fromFils(commissionAmount),
      vendorNet: fromFils(toFils(line.vendorNet) - share),
      affiliateVendorPercent: share > 0n ? percent : null,
    };
  });
  return { lines, totals: { ...draft.totals, commissionTotal: fromFils(commission) } };
}

/** The store-funded shares across the lines that were actually sold. */
export function vendorShareFils(lines: { lineTotal: string; fulfilment: string; affiliateVendorPercent?: string | null }[]): bigint {
  return lines.filter(line => isKept(line.fulfilment)).reduce((sum, line) => sum + vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent), 0n);
}

/**
 * A rate a store may offer affiliates on one of its products (3.7.1): above
 * nothing — a product offered at 0% is not offered — and at most the ceiling,
 * two decimals. Normalised to two places, or null when it is not one.
 */
export function storeAffiliateRate(percent: string): string | null {
  const trimmed = percent.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 && value <= MAX_AFFILIATE_PERCENT ? value.toFixed(2) : null;
}

/** A rate an administrator may set: a percentage, two decimals, 0 to the ceiling. */
export function acceptableRate(percent: string): boolean {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(percent)) return false;
  const value = Number(percent);
  return value >= 0 && value <= MAX_AFFILIATE_PERCENT;
}

/** Whether a balance in the affiliate pot may be paid out. */
export function canPayOut(balanceFils: bigint): { ok: true } | { ok: false; shortBy: string } {
  return balanceFils >= MIN_AFFILIATE_PAYOUT_FILS ? { ok: true } : { ok: false, shortBy: fromFils(MIN_AFFILIATE_PAYOUT_FILS - (balanceFils > 0n ? balanceFils : 0n)) };
}
