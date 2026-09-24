/**
 * Turning a basket into an order, as arithmetic rather than as a database write.
 *
 * Pure, like the permission model and the commission rules, and for the same
 * reason: this decides what a person is charged and what a vendor is owed, and
 * a rule you can only exercise by placing a real order against a real database
 * is a rule nobody checks.
 *
 * The one idea the whole file is built on: **a cart stores no prices and an
 * order stores nothing else.** A basket is a list of intentions, so its total
 * moves as the catalog moves. An order is an obligation, so every number in it
 * is copied at the moment of sale and never recomputed — not the price, not
 * the product's title, not the commission rate. Recomputing an old order
 * against today's catalog is how a refund comes out at a different figure from
 * the payment.
 */
import { commissionFor, type CommissionRule } from "../inventory/commission.js";
import { addMoney, multiplyMoney, money } from "../money.js";
import { fulfilmentFor, type StockLevels } from "./preorder.js";
import { addonsTotal, type ChosenAddon } from "./addons.js";

/** A basket line, with everything needed to price and attribute it. */
export type PriceableLine = {
  variantId: number;
  productId: number;
  vendorId: number;
  quantity: number;
  /** Live, from the catalog — this is the last moment it is allowed to move. */
  unitPrice: string;
  productTitle: string;
  variantTitle: string | null;
  vendorName: string | null;
  sku: string | null;
  /**
   * Both stock pools, so the take can decide which one serves this line.
   *
   * Optional because the pure arithmetic does not need it — `freezeLine` only
   * records what was promised — and a caller that predates pre-order stays
   * correct by defaulting to no allowance.
   */
  levels?: StockLevels | null;
  /** The vendor's rate card, and the product's override if it has one. */
  vendorRule: CommissionRule;
  productRule?: CommissionRule | null;
  /**
   * The optional extras this shopper ticked (3.1.2), priced from the catalog.
   *
   * Optional, so a caller that predates add-ons stays correct with none — the
   * same shape `levels` uses for pre-order.
   */
  addons?: ChosenAddon[];
  /**
   * The bundle this line came from (3.3.11), when one did.
   *
   * The *price* is already the bundle's share — `unitPrice` carries it — so
   * this is only the label the order freezes, for an order that has to say
   * later why a sofa cost 180 rather than 200.
   */
  bundleId?: number | null;
  bundleName?: string | null;
};

/** One line as it will be written, with nothing left to compute. */
export type FrozenLine = {
  variantId: number;
  productId: number;
  vendorId: number;
  vendorName: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  /** The goods, per unit. The extras are their own figure below. */
  unitPrice: string;
  quantity: number;
  /** What the shopper ticked (3.1.2), copied so an old order still says what. */
  addons: ChosenAddon[];
  /** The bundle it was sold in, copied for the same reason. */
  bundleId: number | null;
  bundleName: string | null;
  /** Those extras for the whole line: per unit, times the quantity. */
  addonsTotal: string;
  /** The goods and the extras together — everything this line is worth. */
  lineTotal: string;
  commissionPercent: string;
  commissionFixed: string;
  commissionAmount: string;
  vendorNet: string;
  /**
   * Whether this was sold before the goods existed, and what date was given.
   *
   * Frozen like the price and the commission rate: an order is an obligation,
   * so what the shopper was told at the moment of sale is what a complaint is
   * measured against. Moving the expected date later must not rewrite it.
   *
   * `freezeLine` sets this from the levels it was handed, which is the
   * *offer* — the server re-decides it against the row it actually took from,
   * because between reading and taking, somebody else may have emptied the
   * shelf.
   */
  preordered: boolean;
  preorderReleaseAt: Date | null;
};

export type OrderTotals = {
  itemsTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  commissionTotal: string;
};

export type DraftOrder = { lines: FrozenLine[]; totals: OrderTotals };

/**
 * A line becomes a line: price × quantity, split by the rate in force now.
 *
 * `commissionFor` decides which rule applies — a product's own rate overrides
 * its vendor's, and an absent product rate is not a zero one. The percent and
 * fixed that actually applied are carried through so a vendor statement can
 * say why a figure is what it is instead of only asserting it.
 */
export function freezeLine(line: PriceableLine): FrozenLine {
  const quantity = Math.max(0, Math.trunc(line.quantity));
  /*
   * The extras are charged per unit — two fridges need two fittings — and
   * they are part of what this line is worth, so the commission split runs
   * over them too and `commission + vendorNet === lineTotal` still holds
   * exactly. `unitPrice` stays the goods: a line saying the fridge cost 245
   * when it cost 240 and a 5 fitting is a line nobody can check.
   */
  const addons = line.addons ?? [];
  const extras = addonsTotal(addons, quantity);
  const split = commissionFor(line.unitPrice, quantity, line.vendorRule, line.productRule, extras);

  return {
    variantId: line.variantId,
    productId: line.productId,
    vendorId: line.vendorId,
    vendorName: line.vendorName,
    productTitle: line.productTitle,
    variantTitle: line.variantTitle,
    sku: line.sku,
    unitPrice: money(line.unitPrice),
    quantity,
    addons,
    addonsTotal: extras,
    bundleId: line.bundleId ?? null,
    bundleName: line.bundleName ?? null,
    lineTotal: addMoney(multiplyMoney(line.unitPrice, quantity), extras),
    commissionPercent: split.percentApplied,
    commissionFixed: money(split.fixedApplied),
    commissionAmount: split.commission,
    vendorNet: split.net,
    ...promiseFor(line, quantity),
  };
}

/**
 * What this line promises the shopper, from the levels as they read now.
 *
 * A line with no levels at all is an ordinary stocked line: every caller that
 * predates pre-order keeps its old answer rather than acquiring a new one.
 */
function promiseFor(line: PriceableLine, quantity: number): { preordered: boolean; preorderReleaseAt: Date | null } {
  if (!line.levels) return { preordered: false, preorderReleaseAt: null };
  const fulfilment = fulfilmentFor(line.levels, quantity);
  return fulfilment.kind === "preorder"
    ? { preordered: true, preorderReleaseAt: fulfilment.releaseAt }
    : { preordered: false, preorderReleaseAt: null };
}

/**
 * The whole basket, priced.
 *
 * Delivery is a parameter rather than something computed here, because it is
 * not a property of the basket: it depends on the governorate, the courier and
 * a rate card that does not exist yet. Passing it in keeps this honest about
 * what it does and does not know, and means the day delivery gets a price,
 * nothing in this file changes.
 */
export function draftOrder(lines: PriceableLine[], deliveryTotal = "0.000"): DraftOrder {
  const frozen = lines.map(freezeLine).filter(line => line.quantity > 0);

  const itemsTotal = addMoney(...frozen.map(line => line.lineTotal));
  const commissionTotal = addMoney(...frozen.map(line => line.commissionAmount));
  const delivery = money(deliveryTotal);

  return {
    lines: frozen,
    totals: {
      itemsTotal,
      deliveryTotal: delivery,
      grandTotal: addMoney(itemsTotal, delivery),
      commissionTotal,
    },
  };
}

/**
 * The same order, grouped the way a seller sees it.
 *
 * One basket spanning three vendors is three parcels from three warehouses.
 * Each vendor sees their own lines, their own subtotal, and what they are owed
 * — never the rest of the basket, and never the shopper's grand total, which
 * includes other sellers' goods and is none of theirs.
 */
export type VendorSlice = {
  vendorId: number;
  vendorName: string | null;
  lines: FrozenLine[];
  itemsTotal: string;
  commissionTotal: string;
  vendorNet: string;
};

export function sliceByVendor(lines: FrozenLine[]): VendorSlice[] {
  const byVendor = new Map<number, FrozenLine[]>();
  for (const line of lines) {
    const existing = byVendor.get(line.vendorId);
    if (existing) existing.push(line);
    else byVendor.set(line.vendorId, [line]);
  }

  return [...byVendor.entries()]
    // Stable order, so two reads of the same order agree.
    .sort(([a], [b]) => a - b)
    .map(([vendorId, vendorLines]) => ({
      vendorId,
      vendorName: vendorLines[0]?.vendorName ?? null,
      lines: vendorLines,
      itemsTotal: addMoney(...vendorLines.map(line => line.lineTotal)),
      commissionTotal: addMoney(...vendorLines.map(line => line.commissionAmount)),
      vendorNet: addMoney(...vendorLines.map(line => line.vendorNet)),
    }));
}

/**
 * A reference a shopper can read down a phone.
 *
 * Deliberately not the serial id: that tells anyone who orders twice exactly
 * how many orders NetLet took in between. The random tail is short because it
 * only has to be unique within a day's orders, not unguessable — the order is
 * behind a session, and a reference is a label rather than a credential.
 *
 * The alphabet drops the characters people mishear or mistype: no O or 0, no
 * I, 1 or L, no S or 5. That matters for a number read aloud to support.
 */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

export function orderReference(when: Date, random: () => number = Math.random): string {
  const year = when.getUTCFullYear();
  const month = String(when.getUTCMonth() + 1).padStart(2, "0");
  const day = String(when.getUTCDate()).padStart(2, "0");

  let tail = "";
  for (let index = 0; index < 5; index += 1) {
    tail += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }
  return `NL-${year}${month}${day}-${tail}`;
}

/**
 * Whether a basket can become an order at all.
 *
 * Returns message keys rather than sentences, so the client says it in the
 * shopper's own language and the server and the page cannot word the same
 * refusal two different ways.
 */
export type OrderRefusal =
  | "order.empty"
  | "order.noContact"
  | "order.noAddress"
  /* The method the shopper chose is not available on this basket (3.2.2). */
  | "order.paymentUnavailable"
  /* The points were spent somewhere else between pressing and placing
     (3.1.15). Refused rather than charged in full: quietly taking more than
     the button said is the one outcome worse than refusing. */
  | "order.pointsGone"
  /* The code or the gift card stopped working between pressing and placing
     (3.2.3). Refused rather than charged in full, the same as the points. */
  | "order.voucherGone"
  | "order.zeroPriced";

export function refusalFor(
  lines: PriceableLine[],
  details: { email?: string | null; addressLine?: string | null },
): OrderRefusal | null {
  const buyable = lines.filter(line => Math.trunc(line.quantity) > 0);
  if (buyable.length === 0) return "order.empty";
  if (!details.email?.trim()) return "order.noContact";
  if (!details.addressLine?.trim()) return "order.noAddress";

  /*
   * The same money rule `assertPriced` enforces on publishing, checked again
   * here: a variant at zero is buyable for nothing the moment it is live, and
   * an order is the last place to catch one that slipped through — after this
   * it is a payment for KWD 0.000 and a parcel nobody was paid for.
   */
  if (buyable.some(line => Number.parseFloat(line.unitPrice) <= 0)) return "order.zeroPriced";

  return null;
}
