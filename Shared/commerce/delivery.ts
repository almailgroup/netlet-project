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
 *
 * ## And a fifth, once a basket could go to two doors
 *
 * **A parcel is a seller and a destination** (3.2.6). Two doors are two
 * journeys out of one warehouse, so a seller asked for both charges for both,
 * and the threshold is measured against what is going to *that* door. KWD 15
 * home and KWD 15 to the office is not KWD 30 toward one KWD 20 threshold —
 * that buys two deliveries with one threshold, which is the same money the
 * per-basket rule already refuses to spend on somebody else's sale.
 *
 * ## And a sixth: the shopper picks the speed, per line (3.2.5)
 *
 * **A store that offers fast delivery records its fee**, and a line in the bag
 * carries the shopper's choice — regular unless changed. Fast and regular lines
 * from one store to one door are **two parcels**, because they leave at
 * different times, and each is charged its own fee. Fast is always charged:
 * the free-over threshold is the regular fee's, a reward for spending enough
 * to make a routine trip worth it, and fast is the shopper paying for a
 * different trip. A line asking for fast from a store that has no fast fee is
 * a regular line — the store never offered it.
 */
import { compareMoney, fromFils, toFils } from "../money.js";
import { parcelKey, type DestinationId, type DestinedLine } from "./addresses.js";

/** Which trip a line takes (3.2.5). */
export const DELIVERY_CHOICES = ["regular", "fast"] as const;
export type DeliveryChoice = (typeof DELIVERY_CHOICES)[number];

export function isDeliveryChoice(value: unknown): value is DeliveryChoice {
  return typeof value === "string" && (DELIVERY_CHOICES as readonly string[]).includes(value);
}

/** What a seller charges to deliver, as the store's page records it. */
export type DeliveryRule = {
  /** Per order from this seller, however many lines it holds. */
  flat: string | null;
  /** Goods total at or above which this seller delivers free. Null: never. */
  freeOver: string | null;
  /** The fast trip's fee (3.2.5), per parcel; null or absent: no fast option. */
  fastFlat?: string | null;
};

export const FREE: DeliveryRule = { flat: null, freeOver: null };

/** One parcel: a seller, a destination, and what is going in it. */
export type DeliveryGroup = {
  vendorId: number | null;
  vendorName: string;
  /**
   * Which door this parcel is for. Null is the order's own address, which is
   * a destination like any other rather than the absence of one — the parcel
   * still has to be carried and still has to be paid for.
   */
  destinationId?: DestinationId;
  /** What the shopper calls that door. Null for the order's own address. */
  destinationLabel?: string | null;
  /** The fast trip, when this parcel is one (3.2.5). Absent is regular. */
  choice?: DeliveryChoice;
  /** What the goods in this parcel come to, before delivery. */
  goods: string;
  rule: DeliveryRule;
};

export type VendorDelivery = {
  vendorId: number | null;
  vendorName: string;
  destinationId?: DestinationId;
  destinationLabel?: string | null;
  /** `fast` on a fast parcel (3.2.5); absent or regular otherwise. */
  choice?: DeliveryChoice;
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
  /**
   * What this seller charges and a member did not pay (4.1): the fee stands,
   * NetLet carries it. Absent when nothing was waived.
   */
  waived?: string;
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
    /* A fast parcel is charged the fast fee, whatever it holds (3.2.5). */
    if (group.choice === "fast") {
      const fast = amount(group.rule.fastFlat) ?? 0n;
      total += fast;
      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        destinationId: group.destinationId ?? null,
        destinationLabel: group.destinationLabel ?? null,
        choice: "fast" as const,
        goods: group.goods,
        fee: fromFils(fast),
        free: fast === 0n,
        toFree: null,
      };
    }
    const flat = amount(group.rule.flat);
    const threshold = amount(group.rule.freeOver);
    const goods = toFils(group.goods);

    // No fee recorded is free, and there is no threshold to report against it.
    if (flat === null || flat <= 0n) {
      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        destinationId: group.destinationId ?? null,
        destinationLabel: group.destinationLabel ?? null,
        goods: group.goods,
        fee: "0.000",
        free: true,
        toFree: null,
      };
    }

    const cleared = threshold !== null && goods >= threshold;
    if (!cleared) total += flat;

    return {
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      destinationId: group.destinationId ?? null,
      destinationLabel: group.destinationLabel ?? null,
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

/**
 * The frozen shape an order keeps, so an old order still says who charged what.
 *
 * `destinationLabel` is optional rather than required because every order
 * placed before a basket could go to two doors has a breakdown without one, and
 * a column that reads as missing on old rows is honest where a backfilled
 * "Home" would be an invention.
 */
export type FrozenDelivery = {
  vendorId: number | null;
  vendorName: string;
  destinationLabel?: string | null;
  /** `fast` on a fast parcel (3.2.5); absent on a regular one and on every order before. */
  choice?: "fast";
  fee: string;
  /** A member's waived fee (4.1), what the seller charges and NetLet carries. Absent before memberships, and when nothing was waived. */
  waived?: string;
}[];

/**
 * The quote, reduced to what the order needs to remember.
 *
 * An order is an obligation, so the breakdown is copied beside the total — the
 * same reason the commission rate is copied onto a line. Recomputing last
 * year's delivery against today's fees is how a refund comes out at a
 * different figure from the payment.
 */
export function freezeDelivery(quote: DeliveryQuote): FrozenDelivery {
  return quote.perVendor.map(row => ({
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    destinationLabel: row.destinationLabel ?? null,
    ...(row.choice === "fast" ? { choice: "fast" as const } : {}),
    fee: row.fee,
    ...(row.waived ? { waived: row.waived } : {}),
  }));
}

/**
 * Fold priced lines into one group per parcel.
 *
 * This is where "a parcel is a seller and a destination" actually happens, and
 * it is here rather than in the server so the rule can be exercised without a
 * database: the interesting case is one seller, two doors, and a threshold the
 * combined total would have cleared and neither door does.
 *
 * `rules` answers what a given seller charges. A seller not in it delivers
 * free, which is the same direction an unrecorded fee already errs in.
 *
 * Order is first-seen, so the quote lines up with however the bag is drawn
 * rather than re-sorting it underneath the shopper.
 */
export function groupForDelivery(
  lines: DestinedLine[],
  rules: Map<number | null, DeliveryRule>,
): DeliveryGroup[] {
  const groups = new Map<string, DeliveryGroup>();

  for (const line of lines) {
    const rule = rules.get(line.vendorId) ?? FREE;
    /* Fast only where the store offers it; otherwise the line rides regular. */
    const fast = line.choice === "fast" && offersFast(rule);
    const key = parcelKey(line.vendorId, line.destinationId) + (fast ? "|fast" : "");
    const held = groups.get(key);
    if (held) {
      held.goods = fromFils(toFils(held.goods) + toFils(line.value));
      continue;
    }
    groups.set(key, {
      vendorId: line.vendorId,
      vendorName: line.vendorName,
      destinationId: line.destinationId,
      destinationLabel: line.destinationLabel,
      ...(fast ? { choice: "fast" as const } : {}),
      goods: line.value,
      rule,
    });
  }

  return [...groups.values()];
}

/** Whether a store offers the fast trip at all (3.2.5): a fee recorded, zero included. */
export function offersFast(rule: Pick<DeliveryRule, "fastFlat">): boolean {
  return amount(rule.fastFlat) !== null;
}

/** The choice a line actually rides: fast only where its store offers it. */
export function effectiveChoice(choice: string | null | undefined, rule: Pick<DeliveryRule, "fastFlat">): DeliveryChoice {
  return choice === "fast" && offersFast(rule) ? "fast" : "regular";
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
