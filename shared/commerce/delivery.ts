/**
 * What delivery costs, per seller.
 *
 * Requirement 3.2.4. A NetLet basket can hold four things from three shops,
 * and `sliceByVendor` has grouped an order that way since orders landed — what
 * was missing is the money. Pure, for the reason the order arithmetic is pure:
 * this decides what a shopper is charged, and a figure you can only check by
 * building a real multi-vendor basket is a figure nobody checks.
 *
 * ## Four rules
 *
 * **Each seller charges their own, and the shopper pays each.** Three shops is
 * three parcels from three warehouses. Averaging them into one figure hides
 * which seller is expensive and charges the cheap one's customers for it.
 *
 * **Free-over is per seller, never per basket.** A shopper spending KWD 20 at
 * one shop and KWD 5 at another has not earned free delivery from the second,
 * and giving it to them spends a seller's money on somebody else's sale.
 *
 * **The shortfall is shown.** "KWD 3.500 more for free delivery from Acme" is
 * checkable; a threshold nobody can see is just a higher price with a rumour
 * attached. Same argument `vendorHealth` makes for carrying the raw counts
 * behind its score.
 *
 * **A seller who has recorded no fee delivers free.** That is a gap in our own
 * form rather than evidence they deliver for nothing — and charging a shopper
 * a number the seller never set would be inventing a price. It errs toward the
 * shopper, the direction `missingStoreDetails` and the return window both take.
 */
import { compareMoney, fromFils, toFils } from "../money.js";

/** What a seller charges to deliver, as the store's page records it. */
export type DeliveryRule = {
  /** Per order from this seller, however many lines it holds. */
  flat: string | null;
  /** Goods total at or above which this seller delivers free. Null: never. */
  freeOver: string | null;
};

export const FREE: DeliveryRule = { flat: null, freeOver: null };

/** One seller's share of a basket, as the caller already grouped it. */
export type DeliveryGroup = {
  vendorId: number | null;
  vendorName: string;
  /** What the goods from this seller come to, before delivery. */
  goods: string;
  rule: DeliveryRule;
};

export type VendorDelivery = {
  vendorId: number | null;
  vendorName: string;
  goods: string;
  fee: string;
  /** True when a fee exists and the basket cleared this seller's threshold. */
  free: boolean;
  /**
   * What the shopper would have to add *at this seller* to stop paying. Null
   * when there is no threshold, or when they have already cleared it — a
   * shortfall of zero is not a nudge, it is noise.
   */
  toFree: string | null;
};

export type DeliveryQuote = {
  perVendor: VendorDelivery[];
  total: string;
};

/** A money string, or nothing at all. Blank and rubbish both mean "not set". */
function amount(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  return toFils(text);
}

/**
 * The fee each seller charges on this basket, and the sum.
 *
 * Order is the caller's, so the quote lines up with however the bag is already
 * drawn rather than re-sorting it underneath them.
 */
export function quoteDelivery(groups: DeliveryGroup[]): DeliveryQuote {
  let total = 0n;

  const perVendor = groups.map(group => {
    const flat = amount(group.rule.flat);
    const threshold = amount(group.rule.freeOver);
    const goods = toFils(group.goods);

    // No fee recorded is free, and there is no threshold to report against it.
    if (flat === null || flat <= 0n) {
      return { vendorId: group.vendorId, vendorName: group.vendorName, goods: group.goods, fee: "0.000", free: true, toFree: null };
    }

    const cleared = threshold !== null && goods >= threshold;
    if (!cleared) total += flat;

    return {
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      goods: group.goods,
      fee: cleared ? "0.000" : fromFils(flat),
      free: cleared,
      /* Only while it is still a nudge: once cleared there is nothing to add,
         and without a threshold there is nothing to aim at. */
      toFree: threshold !== null && !cleared ? fromFils(threshold - goods) : null,
    };
  });

  return { perVendor, total: fromFils(total) };
}

/** The frozen shape an order keeps, so an old order still says who charged what. */
export type FrozenDelivery = { vendorId: number | null; vendorName: string; fee: string }[];

/**
 * The quote, reduced to what the order needs to remember.
 *
 * An order is an obligation, so the breakdown is copied beside the total — the
 * same reason the commission rate is copied onto a line. Recomputing last
 * year's delivery against today's fees is how a refund comes out at a
 * different figure from the payment.
 */
export function freezeDelivery(quote: DeliveryQuote): FrozenDelivery {
  return quote.perVendor.map(row => ({ vendorId: row.vendorId, vendorName: row.vendorName, fee: row.fee }));
}

/** Whether a rule would ever charge anything, for a page deciding to draw it. */
export function chargesDelivery(rule: DeliveryRule): boolean {
  const flat = amount(rule.flat);
  return flat !== null && flat > 0n;
}

/** Sum a frozen breakdown back up — a check, and what an old order renders. */
export function frozenTotal(frozen: FrozenDelivery): string {
  return fromFils(frozen.reduce((sum, row) => sum + toFils(row.fee), 0n));
}

/** True when two money strings are the same amount, whatever their spelling. */
export function sameMoney(a: string, b: string): boolean {
  return compareMoney(a, b) === 0;
}
