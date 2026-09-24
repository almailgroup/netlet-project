/**
 * Selling several things together for less than the sum of them.
 *
 * Requirement 3.3.11, cross-vendor included. Pure, for the reason the order
 * arithmetic is: the whole difficulty here is money, and specifically **whose**
 * money the saving comes out of when a bundle spans two shops.
 *
 * ## A bundle is not a product
 *
 * It has no stock, no variants and no page of its own to be bought from. It is
 * a list of variants and a price for taking them together, and buying one puts
 * its members in the basket as ordinary lines. Everything downstream — the
 * stock take, the delivery split, the commission, the fulfilment state — keeps
 * working untouched, because there is nothing new for it to understand.
 *
 * ## The saving is split across the lines, in proportion
 *
 * This is the rule the cross-vendor case turns on. If a bundle of a KWD 200
 * sofa and a KWD 40 lamp saves KWD 24, and that 24 came off the lamp, the lamp
 * would be sold at 16 and its seller would be paying for the sofa seller's
 * promotion. Split in proportion to each line's value, every seller gives up
 * the same *share* of what they brought, and `commission + vendorNet ===
 * lineTotal` still holds on every line because each line's total is simply
 * lower.
 *
 * **Every line is priced per unit, and rounding always favours the shopper.**
 * This is the part that took a second attempt. A line's share of the bundle
 * price has to divide by its quantity, because everything downstream — the
 * line total, the commission split, the delivery grouping — is `unitPrice ×
 * quantity`, and a share of 10.000 across 3 does not. Worse, no allocation
 * exists in general: with two members of quantity 2 there is no way to spend
 * an odd fil at all, because raising either unit price costs two.
 *
 * So each unit price is rounded **down** to the fil and the line total follows
 * from it. The shopper therefore pays *at most* the bundle price and never
 * more — at worst a fil or two less, which the shop absorbs. That is the same
 * direction `cashOutValue` and `discountOf` already round in, and the opposite
 * error would be a page advertising one figure and a till charging another.
 *
 * ## All of it or none of it
 *
 * A bundle price applies while every member is in the basket. Take one out and
 * the rest go back to their own prices — the bag says so rather than quietly
 * repricing — because a "bundle" of two thirds of a bundle is a discount
 * nobody agreed to. The same "wholly or not at all" a pre-ordered line follows.
 *
 * ## A bundle price is an advertised saving
 *
 * Kuwaiti law requires a Ministry of Commerce permit before a shop may
 * advertise one, and a bundle showing "save KWD 24" is exactly that. So the
 * permit rule that governs `compareAtPrice` governs this too, and **whose
 * permit depends on who made the bundle**: a seller's own bundle needs theirs.
 * That check is applied on the *read*, where `discountLicence` already lives,
 * so a permit lapsing on a Tuesday takes the bundle off the shelf rather than
 * leaving the shop advertising a saving it may not.
 */
import { addMoney, compareMoney, fromFils, multiplyMoney, toFils } from "../money.js";

export type BundleMember = {
  variantId: number;
  vendorId: number | null;
  quantity: number;
  /** What this variant costs on its own, now. */
  unitPrice: string;
};

export type Bundle = {
  id: number;
  name: string;
  nameAr: string | null;
  /** Null for a bundle NetLet put together, which is how one spans two shops. */
  vendorId: number | null;
  /** What the whole set costs together. */
  bundlePrice: string;
  members: BundleMember[];
};

/** What the members come to bought separately. */
export function separatelyTotal(members: BundleMember[]): string {
  return members.length === 0
    ? "0.000"
    : addMoney(...members.map(member => multiplyMoney(member.unitPrice, Math.max(0, Math.trunc(member.quantity)))));
}

/** What the bundle saves, or "0.000" when it saves nothing. */
export function savingOf(bundle: Pick<Bundle, "bundlePrice" | "members">): string {
  const separately = separatelyTotal(bundle.members);
  return compareMoney(separately, bundle.bundlePrice) > 0
    ? fromFils(toFils(separately) - toFils(bundle.bundlePrice))
    : "0.000";
}

/**
 * Whether this is a bundle at all.
 *
 * Two members at least — one thing "together" is a price change — and a price
 * genuinely below the sum. A bundle that saves nothing is a set of products
 * with a heading, and putting a permit and a badge on it would be claiming a
 * saving that is not there. `isOffer` draws the same line for `compareAtPrice`.
 */
export function isSellableBundle(bundle: Pick<Bundle, "bundlePrice" | "members">): boolean {
  return bundle.members.length >= 2 && toFils(savingOf(bundle)) > 0n;
}

/** Whether a bundle's members come from more than one shop. */
export function isCrossVendor(members: BundleMember[]): boolean {
  return new Set(members.map(member => member.vendorId)).size > 1;
}

export type PricedMember = BundleMember & {
  /** What one of these costs inside the bundle. Everything downstream multiplies it. */
  bundleUnitPrice: string;
  /** That unit price times the quantity — what this line actually comes to. */
  lineTotal: string;
  /** What it would have been separately, for showing the saving. */
  separately: string;
};

/**
 * Split the bundle price across its members, as a price per unit.
 *
 * In proportion to what each line is worth, so every seller gives up the same
 * share of what they brought rather than one of them funding the promotion —
 * the rule the cross-vendor case turns on.
 *
 * Per **unit**, because everything downstream multiplies by quantity, and
 * rounded down for the reason in this file's header: no exact allocation
 * exists in general, so the error is taken in the shopper's favour.
 */
export function splitBundlePrice(bundle: Pick<Bundle, "bundlePrice" | "members">): PricedMember[] {
  const lines = bundle.members.map(member => {
    const quantity = BigInt(Math.max(1, Math.trunc(member.quantity)));
    return { member, quantity, separatelyFils: toFils(member.unitPrice) * quantity };
  });

  const separatelyTotalFils = lines.reduce((sum, line) => sum + line.separatelyFils, 0n);
  const bundleFils = toFils(bundle.bundlePrice);

  /* Nothing to split proportionally against: every line is free, so the bundle
     price cannot be attributed and each line keeps its own figure. */
  if (separatelyTotalFils <= 0n) {
    return lines.map(line => ({
      ...line.member,
      bundleUnitPrice: fromFils(toFils(line.member.unitPrice)),
      lineTotal: fromFils(line.separatelyFils),
      separately: fromFils(line.separatelyFils),
    }));
  }

  return lines.map(line => {
    /* This line's share of the bundle, then down to a whole fil per unit. */
    const shareFils = (bundleFils * line.separatelyFils) / separatelyTotalFils;
    const unitFils = shareFils / line.quantity;
    return {
      ...line.member,
      bundleUnitPrice: fromFils(unitFils),
      lineTotal: fromFils(unitFils * line.quantity),
      separately: fromFils(line.separatelyFils),
    };
  });
}

/** What the split actually comes to, which is the bundle price or a fil under. */
export function chargedTotal(priced: PricedMember[]): string {
  return priced.length === 0 ? "0.000" : addMoney(...priced.map(line => line.lineTotal));
}

/**
 * Whether a basket still holds every member of this bundle.
 *
 * The saving applies while it does and stops the moment it does not: two
 * thirds of a bundle is a discount nobody agreed to. The bag says so rather
 * than repricing in silence.
 */
export function bundleComplete(bundle: Pick<Bundle, "members">, inBasket: { variantId: number; quantity: number }[]): boolean {
  return bundle.members.every(member => {
    const line = inBasket.find(entry => entry.variantId === member.variantId);
    return line !== undefined && line.quantity >= member.quantity;
  });
}
