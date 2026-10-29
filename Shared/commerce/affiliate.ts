/**
 * Affiliate marketing (3.7): somebody shares a product's link, and a sale that
 * comes through it earns them **NetLet points** — one point a fil (`FILS_PER_POINT`),
 * spent at face value or converted to money (`cashOutValue`).
 *
 * Pure, because every number here is money somebody is owed — the reason the
 * referral ledger is pure, and this shares that ledger rather than building a
 * second one.
 *
 * ## One programme, joined in one press, paid in points
 *
 * On the owner's word ("users can enroll for affiliate marketing easily and
 * earn NetLet points"). It was two things for a while: a product link any
 * account could share for points (3.1.14), and an affiliate programme you
 * applied to, waited on a review for, shared as `?aff=` on any page, and were
 * paid in money in a pot of its own. Now the affiliate link *is* the product
 * link (`/products/x?ref=NL…`), joining is instant (agreeing to say the links
 * are paid is the one condition), and only a member's link earns — the rule
 * that makes joining mean something. An old `?aff=AF…` on a product page is
 * read as that product's link for the same account (`sharerIdFromCode`).
 *
 * ## What a sale earns
 *
 * Two parts, both of NetLet's commission on the line and so never more than
 * NetLet took: the programme's share of NetLet's own commission
 * (`referral.productPercent`, `referralSharePoints`), and on a product its
 * store has offered to affiliates (3.7.1) the store's own rate on the line
 * (`vendorAffiliateFils`), which comes off the seller's net and passes through
 * NetLet's commission (`withAffiliateShares`). Credited as points when the
 * cash is collected, held until the line's return window passes, and taken
 * back by a reversal if the line comes back first.
 *
 * ## Never your own, and the shopper is told
 *
 * A link is never credited to the buyer — self-referral is a discount the
 * sharer gives themselves. A shopper whose bag holds something they arrived at
 * through a member's link sees whose, and that it earns them points at no
 * cost to the shopper: paid promotion that hides itself is what advertising
 * rules exist to stop.
 *
 * ## What was money stays money
 *
 * Orders placed under the old programme carry the affiliate on the order
 * (`orders.affiliate_id`) and pay into the `affiliate` pot, counted in fils and
 * paid out whole, exactly as they were promised; nothing new is attributed that
 * way. A balance there keeps its payout button until it is paid.
 */
import { fromFils, toFils } from "../money.js";
import { isKept } from "./collection.js";
import { MAX_ACCOUNT_ID, userIdFromCode } from "./referral.js";

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
  return value > 0 && value <= MAX_ACCOUNT_ID ? value : null;
}

/**
 * The account a shared link names: a product link's `NL` code, or an old
 * affiliate link's `AF` one — both are the account's id in the same alphabet,
 * so an `?aff=` link already out there keeps earning its sharer, now as the
 * product link it was opened on.
 */
export function sharerIdFromCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.startsWith("AF") ? userIdFromAffiliateCode(trimmed) : userIdFromCode(trimmed);
}

/**
 * The name a new member is shown to shoppers by, offered from their account:
 * the first word of the name as typed, as the header greets them. Null when
 * the account has none, and the form asks.
 */
export function suggestedDisplayName(accountName: string | null | undefined): string | null {
  const first = accountName?.trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, 80) : null;
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
