/**
 * Placing an order, and reading orders back.
 *
 * The arithmetic is not here — `Shared/commerce/order.ts` does that, purely,
 * so what a shopper is charged and what a vendor is owed can be argued with in
 * a test rather than discovered in production. What is here is the part that
 * needs a database: reading live prices one last time, taking the stock, and
 * writing the whole thing or none of it.
 *
 * Outside `db.ts` for the reason `profile.ts` and `rateLimit.ts` are: functions
 * inside `db.ts` call its module-local `getDb`, which nothing outside can
 * redirect, so they cannot be tested against a real database.
 */
import { cleanParts, composeAddressLine, missingParts, partsProblems, type AddressParts } from "../../../Shared/commerce/kuwaitAddress.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  cartItemAddons,
  cartItems,
  carts,
  orderItemAddons,
  orderItems,
  orders,
  discountRedemptions,
  giftCardUses,
  pointEntries,
  priceOffers,
  productAddons,
  productImages,
  productVariants,
  products,
  vendors,
} from "../../database/schema.js";
import {
  draftOrder,
  orderReference,
  refusalFor,
  sliceByVendor,
  type OrderRefusal,
  type PriceableLine,
} from "../../../Shared/commerce/order.js";
import type { Pool } from "../../../Shared/commerce/preorder.js";
import { nextStates } from "../../../Shared/commerce/fulfilment.js";
import { orderProgress, type OrderProgress } from "../../../Shared/commerce/orderProgress.js";
import { mayMoveLine } from "../../../Shared/commerce/netletFulfilment.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { shopperPrice } from "../../../Shared/commerce/shopperPrice.js";
import { memberPriceFor, waiveDelivery } from "../../../Shared/commerce/membership.js";
import { discountAllowed } from "../../../Shared/inventory/discountLicence.js";
import { freezeDelivery, groupForDelivery, quoteDelivery, type DeliveryQuote, type DeliveryRule } from "../../../Shared/commerce/delivery.js";
import { freezeDestination, type DestinedLine } from "../../../Shared/commerce/addresses.js";
import { massGramsFor, type SellUnit } from "../../../Shared/commerce/units.js";
import { destinationsForCart } from "./addresses.js";
import { codAvailability, COD_DEFAULT } from "../../../Shared/commerce/payment.js";
import { pointsSpendableOn, spendValue } from "../../../Shared/commerce/referral.js";
import { addonsTotal, type AddonKind } from "../../../Shared/commerce/addons.js";
import { giftCardPayment, settle } from "../../../Shared/commerce/vouchers.js";
import { bundlePricing } from "./bundles.js";
import { claimRedemption, quoteVoucher, recordGiftCardUse, refundGiftCard, returnRedemption, spendGiftCard, stampRedemption } from "./vouchers.js";
import { addMoney, multiplyMoney, subtractMoney, toFils } from "../../../Shared/money.js";
import { liveOffersFor, markOffersUsed } from "./offers.js";
import { freeDeliveryOver, isMemberNow } from "./membership.js";
import { balanceFor, qualifyReferral, returnPoints, takePoints } from "./referral.js";
import { getDb } from "./db.js";
import { stillOwedFor } from "./owed.js";
import { issueInvoice, issueQuietly } from "./invoices.js";
import { affiliateQuietly, creditAffiliate, earningAffiliate } from "./affiliates.js";
import { featureOn } from "./features.js";
import { markClaimsBought } from "./wishlists.js";
import { isKept, type StillOwed } from "../../../Shared/commerce/collection.js";
import { pinProblem, storedPin, type Pin } from "../../../Shared/commerce/geo.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type PlaceOrderDetails = {
  email: string;
  userId?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryZoneId?: string | null;
  addressLine?: string | null;
  addressNotes?: string | null;
  /** Exactly where, if a pin was dropped (3.2.7). */
  pin?: Pin | null;
  /**
   * Area, block, street, house… (`kuwaitAddress.ts`). When given, the line is
   * composed from them and they are frozen on the order beside it.
   */
  addressParts?: AddressParts | null;
  /**
   * The standing order placing this (3.1.19): which one, and the saving on its
   * variant. Set only by the subscription run, never from a request — the
   * checkout router has no field that reaches it.
   */
  subscription?: { id: number; variantId: number; percent: number } | null;
  /**
   * Delivery is **computed here, never passed in**.
   *
   * It used to be a parameter, on the honest grounds that there was no rate
   * card to compute it from. There is one now — each seller's own fee, per
   * `Shared/commerce/delivery.ts` — and taking the figure from the caller
   * would be letting whoever posts the order set their own postage. The same
   * reason the line prices are read one last time here rather than trusted
   * from the basket that was priced a moment ago.
   */
  /**
   * How the shopper says they will pay (3.2.2). Only `cod` today.
   *
   * The order is written `pending_payment` whatever this says: cash has not
   * changed hands at checkout, and recording it as paid would put revenue in
   * the finance panel that nobody has collected.
   */
  paymentMethod?: string | null;
  /**
   * The affiliate link the shopper arrived through, if they did (3.7).
   *
   * Only a claim: the server attributes the order only to an approved
   * affiliate who is not the buyer, while the switch is on, and freezes their
   * rate beside it. The thirty-day window is the browser's to enforce, because
   * only the browser saw the click.
   */
  affiliateCode?: string | null;
  /**
   * Whether to spend the shopper's loyalty points on this order (3.1.15).
   *
   * A yes-or-no rather than a number, because the balance is the server's to
   * know: a figure passed in would be a figure to check, and the only answer
   * that check could give is the one read here anyway. How much it covers is
   * capped at the order — points are a discount, not a deposit.
   */
  usePoints?: boolean;
  /**
   * A discount code or a gift card the shopper typed (3.2.3).
   *
   * One field for both, because somebody holding a code does not necessarily
   * know which kind it is, and the shop can answer that itself. What it is
   * worth is decided here, against the catalog, at the last moment.
   */
  voucherCode?: string | null;
};

/** Thrown with a message key, so the client says it in the shopper's language. */
export class OrderRefused extends Error {
  constructor(public readonly reason: OrderRefusal | "order.outOfStock" | "order.noCart") {
    super(reason);
    this.name = "OrderRefused";
  }
}

/**
 * The basket, priced against the catalog as it stands right now.
 *
 * Deliberately the same conditions the storefront sells under — published
 * product, approved vendor — because a line that has become unbuyable since it
 * went in the basket must not be sold. It is dropped rather than errored, the
 * same way `getCart` drops it, and `refusalFor` then refuses an order that has
 * nothing left in it.
 */
async function priceableLines(
  db: Db,
  cartId: string,
  userId: number | null | undefined,
  /* A standing order's saving on its one variant (3.1.19), decided by the run
     against the store's permit a moment ago. */
  subscription?: { variantId: number; percent: number },
): Promise<{
  lines: PriceableLine[];
  offerIds: number[];
  delivery: DeliveryQuote;
  cod: ReturnType<typeof codAvailability>;
  /** Placed by a member (4.1), and what of their delivery NetLet carries. */
  member: boolean;
  deliveryWaived: string;
}> {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      vendorId: vendors.id,
      vendorName: vendors.name,
      quantity: cartItems.quantity,
      bundleId: cartItems.bundleId,
      /* Which door this line goes to (3.2.6); null is the order's own. */
      addressId: cartItems.addressId,
      unitPrice: productVariants.price,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      stock: productVariants.stock,
      preorderStock: productVariants.preorderStock,
      preorderReleaseAt: productVariants.preorderReleaseAt,
      /* What it takes to carry it (2.2, 3.4.14). The size class is the
         seller's declaration on the product; the weight is derived from the
         unit it is sold in, and only where that unit is a mass. */
      sizeClass: products.sizeClass,
      unit: productVariants.unit,
      stepAmount: productVariants.stepAmount,
      deliveryFlat: vendors.deliveryFlat,
      deliveryFreeOver: vendors.deliveryFreeOver,
      acceptsCod: vendors.acceptsCod,
      codCeiling: vendors.codCeiling,
      vendorPercent: vendors.commissionPercent,
      vendorFixed: vendors.commissionFixed,
      productPercent: products.commissionPercent,
      productFixed: products.commissionFixed,
      /* A member's price (4.1) and the permit it needs, read at the last moment like the price. */
      memberPrice: productVariants.memberPrice,
      licenceNumber: vendors.discountLicenceNumber,
      licenceExpiresAt: vendors.discountLicenceExpiresAt,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(
      and(
        eq(cartItems.cartId, cartId),
        eq(products.status, "published"),
        eq(vendors.status, "approved"),
      ),
    );

  /*
   * A price the seller agreed with this shopper wins over the shelf, and
   * `priceFor` is the one place that decides — including the case where the
   * shelf has since fallen below the agreement, where the shopper pays the
   * lower figure. Read here, one last time, for the same reason the price is:
   * the basket was priced a moment ago and this is the number that gets frozen.
   */
  const agreed = await liveOffersFor(db, userId, rows.map(row => row.variantId));
  const offerIds: number[] = [];

  /*
   * What the bundles in this basket make each line cost (3.3.11). Read here at
   * the last moment like every other price, and it decides *before* the agreed
   * price does: a bundle is a set at a set price, and a personal discount on
   * one member would be two reductions stacked on one line, neither of which
   * the other knew about.
   */
  const bundled = await bundlePricing(db, rows.map(row => ({
    variantId: row.variantId,
    quantity: row.quantity,
    bundleId: row.bundleId,
  })));

  /*
   * The extras the shopper ticked (3.1.2), priced from the catalog here for
   * the same reason the goods are: the basket stores which, never what they
   * cost, and this is the last moment the figure is allowed to move.
   */
  /*
   * The doors this basket points at (3.2.6), read here at the last moment for
   * the reason the prices are: what gets frozen onto the line is what the
   * address said when the order was placed, not when the bag was drawn.
   */
  const doors = await destinationsForCart(db, cartId);

  const extras = await db
    .select({
      variantId: cartItems.variantId,
      id: productAddons.id,
      kind: productAddons.kind,
      label: productAddons.label,
      price: productAddons.price,
    })
    .from(cartItemAddons)
    .innerJoin(cartItems, eq(cartItems.id, cartItemAddons.cartItemId))
    .innerJoin(productAddons, eq(productAddons.id, cartItemAddons.addonId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(productAddons.position, productAddons.id);

  /* Membership is asked once, of the account placing the order, at the last moment (4.1). */
  const member = await isMemberNow(db, userId ?? null);

  /*
   * What each line costs this shopper — `shopperPrice`, the one rule the bag
   * uses too, so the threshold below, the line and the bag cannot disagree.
   * Before it, this threshold ignored a subscriber's saving the line took.
   */
  const pricing = new Map(rows.map(row => {
    const inBundle = bundled.get(row.variantId);
    const offer = inBundle ? null : agreed.get(row.variantId) ?? null;
    const price = shopperPrice({
      listPrice: row.unitPrice,
      bundlePrice: inBundle?.unitPrice ?? null,
      agreed: offer,
      subscriberPercent: subscription && subscription.variantId === row.variantId ? subscription.percent : null,
      memberPrice: memberPriceFor({
        member,
        listPrice: row.unitPrice,
        memberPrice: row.memberPrice,
        permitValid: discountAllowed({ number: row.licenceNumber, expiresAt: row.licenceExpiresAt }).allowed,
      }),
    });
    // Only an agreement that actually set the price is spent. One the shelf —
    // or another reduction — has undercut leaves the shopper free to use it
    // another day.
    if (offer && price.reason === "agreed") offerIds.push(offer.id);
    return [row.variantId, price.charged] as const;
  }));

  const lines = rows.map(row => {
    const inBundle = bundled.get(row.variantId);
    const charged = pricing.get(row.variantId)!;
    return {
    variantId: row.variantId,
    productId: row.productId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    quantity: row.quantity,
    unitPrice: charged,
    productTitle: row.productTitle,
    variantTitle: row.variantTitle,
    sku: row.sku,
    levels: {
      stock: row.stock,
      preorderStock: row.preorderStock,
      preorderReleaseAt: row.preorderReleaseAt,
    },
    bundleId: inBundle?.bundleId ?? null,
    bundleName: inBundle?.bundleName ?? null,
    /* Copied, never referenced: an address edited in March must not rewrite
       where a parcel was sent in September. */
    destination: row.addressId && doors.has(row.addressId)
      ? freezeDestination(doors.get(row.addressId)!)
      : null,
    sizeClass: row.sizeClass,
    /* Per unit, so the parcel's own arithmetic multiplies it by the quantity
       exactly once — `vehicleForQuantity` is what does that. */
    weightGrams: massGramsFor({ unit: row.unit as SellUnit, stepAmount: Number(row.stepAmount) }, 1),
    vendorRule: { percent: row.vendorPercent, fixed: row.vendorFixed },
    // Null on both columns is the absence of an override, not an override of
    // zero — `resolveRule` depends on being handed null rather than a zeroed
    // object, so the shape is preserved rather than flattened here.
    productRule:
      row.productPercent === null && row.productFixed === null
        ? null
        : { percent: row.productPercent, fixed: row.productFixed },
    addons: extras
      .filter(addon => addon.variantId === row.variantId)
      .map(addon => ({ id: addon.id, kind: addon.kind as AddonKind, label: addon.label, price: addon.price })),
    };
  });

  /*
   * Grouped here because the grouping needs the rows the query returned; the
   * arithmetic on top is pure and lives in `Shared/commerce/delivery.ts`.
   * Charged prices, not shelf prices — a personally agreed price counts toward
   * a seller's free-delivery threshold, because it is what the shopper spent.
   */
  const codRules = new Map(rows.map(row => [row.vendorId, { accepts: row.acceptsCod, ceiling: row.codCeiling }]));
  const rules = new Map<number | null, DeliveryRule>(
    rows.map(row => [row.vendorId, { flat: row.deliveryFlat, freeOver: row.deliveryFreeOver }]),
  );

  const destined: DestinedLine[] = rows.map(row => {
    const charged = pricing.get(row.variantId)!;
    /* The extras are money spent with that seller, so they count toward their
       free-delivery threshold exactly as the goods do. */
    const value = addMoney(
      multiplyMoney(charged, row.quantity),
      addonsTotal(
        extras
          .filter(addon => addon.variantId === row.variantId)
          .map(addon => ({ id: addon.id, kind: addon.kind as AddonKind, label: addon.label, price: addon.price })),
        row.quantity,
      ),
    );
    const destinationId = row.addressId && doors.has(row.addressId) ? row.addressId : null;
    return {
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      destinationId,
      destinationLabel: destinationId ? doors.get(destinationId)!.label : null,
      value,
    };
  });

  /* A parcel is a seller and a destination (3.2.6): two doors are two journeys
     out of one warehouse, and each is measured against the threshold on its
     own. The fold is pure, so the case worth checking needs no database. */
  const groups = groupForDelivery(destined, rules);
  /* A member's delivery is waived over NetLet's minimum, and what each seller
     would have charged is kept beside the breakdown (4.1). */
  const quoted = quoteDelivery(groups);
  const delivery = member
    ? waiveDelivery(quoted, addMoney("0.000", ...destined.map(line => line.value)), await freeDeliveryOver(db))
    : { ...quoted, waived: "0.000" };

  return {
    lines,
    offerIds,
    member,
    deliveryWaived: delivery.waived,
    delivery,
    /*
     * Cash is still decided per *seller*, not per parcel: a driver's ceiling is
     * about how much cash one company will carry, and a shopper who split a
     * basket across two doors has not changed what that seller is owed. So the
     * parcels are folded back together before they are asked.
     */
    cod: codAvailability(
      [...groups.reduce((byVendor, group) => {
        const held = byVendor.get(group.vendorId);
        if (held) held.goods = addMoney(held.goods, group.goods);
        else byVendor.set(group.vendorId, { vendorName: group.vendorName, goods: group.goods });
        return byVendor;
      }, new Map<number | null, { vendorName: string; goods: string }>()).entries()].map(([vendorId, seller]) => ({
        vendorName: seller.vendorName,
        goods: seller.goods,
        rule: codRules.get(vendorId ?? -1) ?? COD_DEFAULT,
      })),
    ),
  };
}

/**
 * Take the stock, or refuse.
 *
 * `stock = stock - n WHERE stock >= n` is the whole safety property: two
 * shoppers racing for the last item both read "1 available", and without the
 * condition inside the write both would be sold it. Postgres evaluates the
 * predicate against the row it locks, so exactly one update matches and the
 * other comes back having changed nothing.
 *
 * A short read is not corrected, it is refused — overselling by one is a
 * conversation with a customer, and there is no amount of stock arithmetic
 * that makes an item appear in a warehouse.
 */
async function takeStock(db: Db, variantId: number, quantity: number): Promise<Shelf | null> {
  const [taken] = await db
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} - ${quantity}` })
    .where(and(eq(productVariants.id, variantId), sql`${productVariants.stock} >= ${quantity}`))
    .returning({ centreId: productVariants.centreId });
  return taken ? { centreId: taken.centreId } : null;
}

/**
 * Take from the pre-order allowance, or refuse.
 *
 * The same predicate on a different column, and that is the entire design of
 * pre-order in this codebase: a vendor who promises 50 sells 50, and the
 * fifty-first shopper is refused by the same race-safe mechanism as the one
 * reaching for the last item on the shelf. A pre-order is a second pool, never
 * an exemption from the rule.
 */
async function takePreorder(db: Db, variantId: number, quantity: number): Promise<Shelf | null> {
  const [taken] = await db
    .update(productVariants)
    .set({ preorderStock: sql`${productVariants.preorderStock} - ${quantity}` })
    .where(and(eq(productVariants.id, variantId), sql`${productVariants.preorderStock} >= ${quantity}`))
    .returning({ centreId: productVariants.centreId });
  return taken ? { centreId: taken.centreId } : null;
}

/**
 * Take the line's units from whichever pool can serve it, and say which.
 *
 * Stock first: a variant with three on the shelf and an allowance behind it
 * sells the three as ordinary stock, because calling that a pre-order would
 * delay a parcel that could have gone out today.
 *
 * The decision is made *here*, against the row the write locks, rather than
 * trusted from the read that priced the basket. Between those two moments
 * somebody else may have emptied the shelf, and a line that was offered from
 * stock then has to fall through to the allowance — otherwise the order would
 * record a promise the warehouse cannot keep.
 */
export async function takeUnits(db: Db, variantId: number, quantity: number): Promise<Taken | null> {
  /* Whose shelf it came off is read from the row this write changed, not the
     read that priced the basket — between the two, NetLet may have taken the
     variant in (4.2), and the line must say where the box actually is. */
  const fromStock = await takeStock(db, variantId, quantity);
  if (fromStock) return { pool: "stock", centreId: fromStock.centreId };
  const fromPreorder = await takePreorder(db, variantId, quantity);
  if (fromPreorder) return { pool: "preorder", centreId: fromPreorder.centreId };
  return null;
}

/** Whose shelf: a NetLet centre's id, or null for the seller's own. */
type Shelf = { centreId: number | null };
/** Which pool a line's units came from, and whose shelf. */
export type Taken = { pool: Pool; centreId: number | null };

/**
 * Put units back in the pool they came from, for a line that could not be
 * completed.
 *
 * `shelf`, when given, is the centre the units are physically on (null for the
 * seller's own), and they go back only if the variant is still counted there
 * (4.2): a line sold off NetLet's shelf and cancelled after the variant went
 * back to its seller is two boxes in NetLet's building, not two on the
 * seller's count.
 */
export async function returnUnits(db: Db, variantId: number, quantity: number, pool: Pool, shelf?: number | null): Promise<void> {
  const column = pool === "stock" ? productVariants.stock : productVariants.preorderStock;
  await db
    .update(productVariants)
    .set(pool === "stock"
      ? { stock: sql`${column} + ${quantity}` }
      : { preorderStock: sql`${column} + ${quantity}` })
    .where(and(
      eq(productVariants.id, variantId),
      shelf === undefined ? undefined : shelf === null ? isNull(productVariants.centreId) : eq(productVariants.centreId, shelf),
    ));
}

/**
 * Turn a basket into an order.
 *
 * The order is born `pending_payment` and nothing here pretends otherwise:
 * until a payment provider exists, this is where the money path stops. That is
 * deliberate rather than unfinished — the order has to exist before a payment
 * can reference it, and building it the other way round is how a paid basket
 * ends up with nothing to attach to.
 *
 * Stock is taken before the write and handed back if the write fails, so a
 * crash between the two does not quietly consume inventory.
 */
export async function placeOrder(cartId: string, details: PlaceOrderDetails) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) throw new OrderRefused("order.noCart");

  const { lines, offerIds, delivery, cod, member, deliveryWaived } = await priceableLines(
    db, cartId, details.userId,
    details.subscription ? { variantId: details.subscription.variantId, percent: details.subscription.percent } : undefined,
  );
  /* Given as parts, the line is theirs, and a part a driver needs is refused
     like a missing line — before anything is taken. */
  const parts = cleanParts(details.addressParts);
  if (parts) {
    const partIssue = missingParts(parts).length ? "address.needsParts" as const : partsProblems(parts)[0] as "address.partTooLong" | "address.badPaci" | undefined;
    if (partIssue) throw new OrderRefused(partIssue);
    details = { ...details, addressLine: composeAddressLine(parts) };
  }
  const refusal = refusalFor(lines, details);
  if (refusal) throw new OrderRefused(refusal);
  /* A pin somewhere else is a parcel sent somewhere else: refused, never
     quietly dropped, so the shopper learns the map missed. */
  const pinIssue = details.pin ? pinProblem(details.pin) : null;
  if (pinIssue) throw new OrderRefused(pinIssue);

  /*
   * Checked here rather than trusted from the basket that was priced a moment
   * ago, for the reason the prices and the delivery are: a seller may have
   * turned cash off, or the basket may have grown past their ceiling, between
   * the page rendering and the button being pressed.
   */
  if (details.paymentMethod === "cod" && !cod.available) {
    throw new OrderRefused("order.paymentUnavailable");
  }

  const draft = draftOrder(lines, delivery.total);

  /* Who brought this order, if anybody (3.7): resolved before anything is
     taken, so a lookup that fails cannot strand stock. */
  const affiliate = details.affiliateCode && (await featureOn("affiliates"))
    ? await earningAffiliate(db, details.affiliateCode, details.userId)
    : null;

  // Take every line's units first. Anything already taken goes back to the pool
  // it came from if a later line cannot be served, so a part-served basket
  // never half-happens.
  const taken: { variantId: number; quantity: number; pool: Pool }[] = [];
  const pools = new Map<number, Pool>();
  const shelves = new Map<number, number | null>();
  for (const line of draft.lines) {
    const took = await takeUnits(db, line.variantId, line.quantity);
    if (took) {
      taken.push({ variantId: line.variantId, quantity: line.quantity, pool: took.pool });
      pools.set(line.variantId, took.pool);
      shelves.set(line.variantId, took.centreId);
      continue;
    }
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    throw new OrderRefused("order.outOfStock");
  }

  /*
   * Points are taken next, and *after* the stock rather than before it: every
   * take from here on has to be undone if a later one fails, and a refusal
   * thrown between two of them is the one place that is easy to get wrong.
   * This one was — the out-of-stock refusal above returned the units and left
   * the shopper's points spent on an order that never existed.
   *
   * Refusing outright when the balance has moved under them is deliberate.
   * Placing the order at full price instead would charge somebody more than
   * the button they pressed said, which is worse than refusing.
   */
  /*
   * The code comes off before the points, because a code is a discount and so
   * are points — and the gift card goes last, against what is still owed,
   * since a gift card *pays* rather than reduces. `settle` is the one place
   * that order lives, so the checkout summary and this cannot disagree.
   */
  const typed = details.voucherCode?.trim() ?? "";
  const quoted = typed
    ? await quoteVoucher(db, typed, {
        goods: draft.totals.itemsTotal,
        owed: draft.totals.grandTotal,
        userId: details.userId ?? null,
      })
    : null;
  /* A code that has stopped working between the page and the button refuses
     the order rather than quietly charging the full price — the same rule the
     points take follows, and for the same reason. */
  if (quoted && !quoted.ok) {
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    throw new OrderRefused("order.voucherGone");
  }
  /*
   * The code's use is *taken* here, not recorded afterwards.
   *
   * `quoteVoucher` counts the redemptions and compares them with the ceiling,
   * and a count is a read: two tabs both saw "used 0 of 1" and both went
   * through, so a code good for one customer came off two orders. Taking it
   * before the order exists — under a lock, like the points, and handed back
   * like the stock — is what makes the ceiling true.
   */
  const claimId = quoted?.ok && quoted.kind === "discount"
    ? await claimRedemption(db, quoted.code, { userId: details.userId ?? null, amount: quoted.amount })
    : null;
  if (quoted?.ok && quoted.kind === "discount" && claimId === null) {
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    throw new OrderRefused("order.voucherGone");
  }

  const discountValue = claimId !== null && quoted?.ok ? quoted.amount : "0.000";
  const afterDiscount = subtractMoney(draft.totals.grandTotal, discountValue);

  const wantedPoints = details.usePoints && details.userId
    ? pointsSpendableOn(await balanceFor(db, details.userId), afterDiscount)
    : 0;
  const pointsEntryId = wantedPoints > 0 && details.userId
    ? await takePoints(db, details.userId, wantedPoints, "spent_on_order")
    : null;
  if (wantedPoints > 0 && pointsEntryId === null) {
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    if (claimId !== null) await returnRedemption(db, claimId);
    throw new OrderRefused("order.pointsGone");
  }
  const pointsSpent = pointsEntryId === null ? 0 : wantedPoints;
  const pointsValue = spendValue(pointsSpent);

  /*
   * The card is taken the way the stock and the points are: before the write,
   * with the predicate inside it, and handed back if anything later fails.
   */
  const owedBeforeCard = subtractMoney(afterDiscount, pointsValue);
  const giftAsked =
    quoted?.ok && quoted.kind === "gift" ? giftCardPayment(quoted.remaining, owedBeforeCard) : "0.000";
  const giftTaken = toFils(giftAsked) > 0n && quoted?.ok && quoted.kind === "gift"
    ? await spendGiftCard(db, quoted.code, giftAsked)
    : false;
  if (toFils(giftAsked) > 0n && !giftTaken) {
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    if (pointsEntryId !== null) await returnPoints(db, pointsEntryId);
    if (claimId !== null) await returnRedemption(db, claimId);
    throw new OrderRefused("order.voucherGone");
  }
  const giftCardValue = giftTaken ? giftAsked : "0.000";
  const settled = settle({
    goods: draft.totals.itemsTotal,
    delivery: draft.totals.deliveryTotal,
    discount: discountValue,
    points: pointsValue,
    giftCard: giftCardValue,
  });

  try {
    /*
     * One transaction for every row the order is. Stock, points, the card and
     * the code were taken before it, each with its own predicate, and the
     * catch below hands them back — which used to leave the order and its
     * lines standing when a later write failed: an order for goods whose stock
     * had gone back on the shelf, paid with a card balance that had been
     * restored.
     */
    const order = await db.transaction(async tx => {
      const w = tx as unknown as Db;
      const [order] = await w
        .insert(orders)
        .values({
          reference: orderReference(new Date()),
          userId: details.userId ?? null,
          email: details.email.trim().toLowerCase(),
          itemsTotal: draft.totals.itemsTotal,
          deliveryTotal: draft.totals.deliveryTotal,
          /* Net of the points, so the column that says what is owed needs no
             arithmetic to read — and no line moves, because the discount comes
             out of NetLet's cut rather than the seller's net. */
          /* Net of all three, so the column that says what is owed needs no
             arithmetic to read. Every one of them is frozen beside it. */
          grandTotal: settled.payable,
          pointsSpent,
          pointsValue,
          discountCode: toFils(discountValue) > 0n && quoted?.ok ? quoted.code : null,
          discountValue,
          giftCardCode: giftTaken && quoted?.ok ? quoted.code : null,
          giftCardValue,
          commissionTotal: draft.totals.commissionTotal,
          /* Frozen beside the total, so an order from last year still says who
             charged what — the reason the commission rate is copied too. */
          deliveryBreakdown: freezeDelivery(delivery),
          /* A member's order (4.1): first on the board, and the delivery NetLet carried. */
          member,
          deliveryWaived,
          paymentMethod: details.paymentMethod ?? null,
          affiliateId: affiliate?.id ?? null,
          affiliateRate: affiliate?.ratePercent ?? null,
          contactName: details.contactName ?? null,
          contactPhone: details.contactPhone ?? null,
          deliveryZoneId: details.deliveryZoneId ?? null,
          addressLine: details.addressLine ?? null,
          addressNotes: details.addressNotes ?? null,
          deliveryPin: storedPin(details.pin),
          deliveryAddressParts: parts,
          subscriptionId: details.subscription?.id ?? null,
        })
        .returning();

      const writtenLines = await w.insert(orderItems).values(
        draft.lines.map(line => ({
          orderId: order.id,
          vendorId: line.vendorId,
          productId: line.productId,
          variantId: line.variantId,
          vendorName: line.vendorName,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          sku: line.sku,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          commissionPercent: line.commissionPercent,
          commissionFixed: line.commissionFixed,
          commissionAmount: line.commissionAmount,
          vendorNet: line.vendorNet,
          /* What was actually taken, not what was offered a moment earlier. */
          bundleId: line.bundleId ?? null,
          bundleName: line.bundleName ?? null,
          destination: line.destination,
          sizeClass: line.sizeClass,
          weightGrams: line.weightGrams,
          preordered: pools.get(line.variantId) === "preorder",
          preorderReleaseAt: pools.get(line.variantId) === "preorder" ? line.preorderReleaseAt : null,
          centreId: shelves.get(line.variantId) ?? null,
        })),
      ).returning({ id: orderItems.id, variantId: orderItems.variantId });

      /*
       * The extras, copied beside the price. Everything is frozen and the
       * reference is `set null`, for the reason every other fact on a line is: a
       * seller may withdraw an extra or change what it costs, and an order from
       * last year still has to say what was bought and be refundable at that
       * figure.
       */
      const frozenAddons = draft.lines.flatMap(line => {
        const written = writtenLines.find(row => row.variantId === line.variantId);
        if (!written) return [];
        return line.addons.map(addon => ({
          orderItemId: written.id,
          addonId: addon.id,
          kind: addon.kind,
          label: addon.label,
          price: addon.price,
        }));
      });
      if (frozenAddons.length) await w.insert(orderItemAddons).values(frozenAddons);

      /* A special price is spent once. Marking it here rather than when the
         shopper adds to the bag is deliberate: a grant is not consumed by
         interest, only by a purchase. The write is guarded by `used_on_order_id
         is null`, so two tabs checking out cannot both claim it. */
      await markOffersUsed(w, offerIds, order.id);

      /* The entry exists already — it had to, to close the race — so this is
         only it learning what it bought. */
      if (pointsEntryId !== null) {
        await w.update(pointEntries).set({ orderId: order.id }).where(eq(pointEntries.id, pointsEntryId));
      }

      /* The redemption row was already taken above — it *is* the count of how
         often a code has been used, so it had to exist before anybody else could
         be told the code was still good. This only attaches the order to it. */
      if (claimId !== null) await stampRedemption(w, claimId, order.id);
      if (giftTaken && quoted?.ok) await recordGiftCardUse(w, quoted.code, order.id, giftCardValue);

      // The basket has become the order; leaving it would let the same items be
      // bought twice from a stale tab.
      await w.delete(cartItems).where(eq(cartItems.cartId, cartId));
      return order;
    });

    /* A present claimed off somebody's list and now bought stays bought. After
       the order, and never undoing it: a list that fails to update is a smaller
       thing than an order that fails to exist. */
    if (details.userId) {
      const productIds = [...new Set(draft.lines.map(line => String(line.productId)))];
      await markClaimsBought(db, details.userId, productIds)
        .catch(error => console.error(`[orders] marking order ${order.id}'s wishlist claims bought failed`, error));
    }

    return {
      order,
      lines: draft.lines,
      totals: {
        ...draft.totals,
        grandTotal: order.grandTotal,
        pointsSpent,
        pointsValue,
        discountValue,
        giftCardValue,
      },
    };
  } catch (error) {
    // Back to the pool each line came from. Handing a pre-ordered line back as
    // real stock would invent inventory out of a failed write.
    for (const done of taken) await returnUnits(db, done.variantId, done.quantity, done.pool);
    if (pointsEntryId !== null) await returnPoints(db, pointsEntryId);
    /* A card charged for an order that does not exist has to go back, the same
       as the stock and the points. */
    if (giftTaken && quoted?.ok) await refundGiftCard(db, quoted.code, giftCardValue);
    if (claimId !== null) await returnRedemption(db, claimId);
    throw error;
  }
}

/**
 * What a typed code would be worth on a basket, before anything is placed.
 *
 * Here rather than in the router because it has to price the basket exactly as
 * `placeOrder` will — live prices, agreed prices, the extras and the delivery —
 * and a second implementation of that in a router is how a checkout summary
 * comes to disagree with the bill.
 */
export async function quoteVoucherForCart(cartId: string, code: string, userId: number | null) {
  const db = await getDb();
  if (!db) return { ok: false, reason: "voucher.unknown" } as const;

  const { lines, delivery } = await priceableLines(db, cartId, userId);
  const draft = draftOrder(lines, delivery.total);
  return quoteVoucher(db, code, {
    goods: draft.totals.itemsTotal,
    owed: draft.totals.grandTotal,
    userId,
  });
}

/* ----------------------------------------------------------------- reading --- */

const emptyPage = <T>(pageSize?: number): Page<T> => ({
  rows: [],
  total: 0,
  page: 1,
  pageSize: clampPageSize(pageSize),
});

export type OrderRow = typeof orders.$inferSelect & {
  /** What it owes now, once cancelled lines are taken off. Null without a database read. */
  owed?: StillOwed | null;
  /** What it holds and how far it has got, for the list a shopper scans. */
  summary?: OrderSummary;
};

/**
 * An order as a row in its shopper's list: what is in it and where it is.
 *
 * The list showed a reference, a date, a total and whether the order was paid
 * — and nobody recognises their own order by its reference. They know it as
 * "the watch and two other things", and what they want to know is whether it
 * is on its way.
 */
export type OrderSummary = {
  lineCount: number;
  /** The first line as it read on the day of sale. */
  first: { title: string; variant: string | null } | null;
  /** Today's first photograph of the first few products, in line order. */
  photos: string[];
  progress: OrderProgress;
};

/**
 * Each product's first photograph today.
 *
 * Read live rather than frozen with the line: a picture is how somebody
 * recognises a thing, not a fact anybody is held to, and a product deleted
 * since simply has none — `Thumb` draws its fallback.
 */
export async function firstPhotos(db: Db, productIds: (number | null)[]): Promise<Map<number, string>> {
  const ids = [...new Set(productIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([productImages.productId], { productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(and(inArray(productImages.productId, ids), eq(productImages.kind, "image")))
    .orderBy(productImages.productId, productImages.position, productImages.id);
  return new Map(rows.map(row => [row.productId, row.url]));
}

const PREVIEW_PHOTOS = 3;

async function summariesFor(db: Db, rows: (typeof orders.$inferSelect)[]): Promise<Map<number, OrderSummary>> {
  if (rows.length === 0) return new Map();
  const lines = await db
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      fulfilment: orderItems.fulfilment,
      deliveredAt: orderItems.deliveredAt,
      preordered: orderItems.preordered,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map(row => row.id)))
    .orderBy(orderItems.orderId, orderItems.id);
  const photos = await firstPhotos(db, lines.map(line => line.productId));

  const byOrder = new Map<number, typeof lines>();
  for (const line of lines) byOrder.set(line.orderId, [...(byOrder.get(line.orderId) ?? []), line]);

  return new Map(rows.map(row => {
    const own = byOrder.get(row.id) ?? [];
    /* Lead with something still coming: a cancelled line first in the list
       would name the order after the one thing that is not in it. */
    const lead = own.find(line => line.fulfilment !== "cancelled") ?? own[0];
    const pictured = [...own].sort((a, b) => Number(a.fulfilment === "cancelled") - Number(b.fulfilment === "cancelled"));
    return [row.id, {
      lineCount: own.length,
      first: lead ? { title: lead.productTitle, variant: lead.variantTitle } : null,
      photos: [...new Set(pictured.map(line => (line.productId === null ? undefined : photos.get(line.productId))).filter((url): url is string => Boolean(url)))].slice(0, PREVIEW_PHOTOS),
      progress: orderProgress(row, own),
    }];
  }));
}

/**
 * How many of this shopper's orders have a parcel on the road, and the most
 * recent one's reference — the header's "on its way" (3.4.3).
 *
 * On the road is a line marked shipped and not yet delivered; an order that
 * was cancelled or refunded is not on its way whatever a line says. Scoped by
 * the account in the query, like every order read here, and capped: a count
 * past fifty is still "on its way", and an unbounded scan for a header is the
 * admin lists' ceiling problem.
 */
export async function ordersOnTheWay(userId: number): Promise<{ count: number; latest: string | null }> {
  const db = await getDb();
  if (!db) return { count: 0, latest: null };
  const rows = await db
    .selectDistinct({ id: orders.id, reference: orders.reference, placedAt: orders.placedAt })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(
      eq(orders.userId, userId),
      eq(orderItems.fulfilment, "shipped"),
      inArray(orders.status, ["pending_payment", "paid"]),
    ))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(50);
  return { count: rows.length, latest: rows[0]?.reference ?? null };
}

/**
 * A shopper's own orders.
 *
 * Scoped by `userId` and nothing else: an order id is a serial, and "show me
 * order 4" must not be a way to read somebody else's purchase.
 */
export async function listOrdersForUser(
  userId: number,
  request: { page?: number; pageSize?: number } = {},
): Promise<Page<OrderRow>> {
  const db = await getDb();
  if (!db) return emptyPage<OrderRow>(request.pageSize);

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, userId));
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    // `placedAt` is not unique — a bulk import or two orders in the same
    // millisecond tie — and offset paging over an unstable sort repeats rows.
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  /* What each one owes now — the figure the driver will ask for — rather than
     only what it was placed for. See `Shared/commerce/collection.ts`. */
  const owed = await stillOwedFor(db, rows);
  const summaries = await summariesFor(db, rows);
  return { rows: rows.map(row => ({ ...row, owed: owed.get(row.id) ?? null, summary: summaries.get(row.id) })), total, page, pageSize };
}

/**
 * An order as its shopper may read it.
 *
 * The rows are NetLet's record of a sale, and some of what they carry is
 * between NetLet and the seller or the affiliate: the commission taken on each
 * line, what the seller nets, the order's commission total, an affiliate's
 * rate, and which driver's account carried it. The shopper's own orders page
 * returned the whole row, so any shopper could read a seller's commercial
 * terms off their receipt. These two are what the shopper's API sends; the
 * data layer keeps the whole row for the code that needs it.
 */
export function orderForShopper<T extends typeof orders.$inferSelect>(order: T) {
  const { commissionTotal: _commission, affiliateId: _affiliate, affiliateRate: _rate, ...rest } = order;
  return rest;
}

export function lineForShopper<T extends typeof orderItems.$inferSelect>(line: T) {
  const {
    commissionPercent: _percent, commissionFixed: _fixed, commissionAmount: _amount, vendorNet: _net,
    carriedBy: _driver, courierId: _courier, ...rest
  } = line;
  return rest;
}

/** One order with its lines, for the shopper who placed it. */
export async function getOrderForUser(userId: number, reference: string) {
  const db = await getDb();
  if (!db) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  if (!order) return null;

  const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(orderItems.id);
  const photos = await firstPhotos(db, rows.map(line => line.productId));
  const lines = rows.map(line => ({ ...line, photo: line.productId === null ? null : photos.get(line.productId) ?? null }));
  const owed = (await stillOwedFor(db, [order])).get(order.id) ?? null;
  return { order, lines, owed };
}

/**
 * The orders an actor administers, scoped the way everything else is.
 *
 * An admin sees every order; a vendor sees only orders containing their own
 * lines, and only those lines. The scope is applied in the query rather than
 * filtered afterwards — a vendor must not receive another vendor's rows and
 * have the client hide them.
 */
/** One row of the seller's order desk. Deliberately not the whole order row. */
export type SellerOrderRow = {
  id: number;
  reference: string;
  status: OrderRow["status"];
  paymentMethod: string | null;
  placedAt: Date;
  vendorCount: number;
  /**
   * What this row is worth *to whoever is asking*.
   *
   * An admin sees the order's grand total; a vendor sees their own lines and
   * nothing else. Returning the whole order row handed a vendor the basket
   * total on a shared order — a rival's sales figure, which `getOrderFor` is
   * careful to withhold three functions further down. The leak was latent
   * only because nothing had ever called this.
   */
  orderTotal: string;
};

export async function listOrdersFor(
  actor: Actor,
  request: { page?: number; pageSize?: number } = {},
): Promise<Page<SellerOrderRow>> {
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) return emptyPage<SellerOrderRow>(request.pageSize);

  const mine =
    actor.kind === "vendor"
      ? sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.vendorId} = ${actor.vendorId})`
      : undefined;

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(mine);
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      placedAt: orders.placedAt,
      grandTotal: orders.grandTotal,
      deliveryBreakdown: orders.deliveryBreakdown,
    })
    .from(orders)
    .where(mine)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  if (rows.length === 0) return { rows: [], total, page, pageSize };

  const lines = await db
    .select({ orderId: orderItems.orderId, vendorId: orderItems.vendorId, lineTotal: orderItems.lineTotal, fulfilment: orderItems.fulfilment })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map(row => row.id)));
  /* What is still coming, not what was first ordered — the same figure the
     shopper and the driver are shown, so the desk does not quote a cancelled
     sofa back at whoever is reading it. */
  const owed = actor.kind === "vendor" ? null : await stillOwedFor(db, rows);

  return {
    rows: rows.map(row => {
      const own = lines.filter(line => line.orderId === row.id);
      return {
        id: row.id,
        reference: row.reference,
        status: row.status,
        paymentMethod: row.paymentMethod,
        placedAt: row.placedAt,
        vendorCount: new Set(own.map(line => line.vendorId)).size,
        orderTotal:
          actor.kind === "vendor"
            ? addMoney(...own.filter(line => line.vendorId === actor.vendorId && isKept(line.fulfilment)).map(line => line.lineTotal))
            : owed?.get(row.id)?.owed ?? row.grandTotal,
      };
    }),
    total,
    page,
    pageSize,
  };
}

/**
 * One order, as the asking party is entitled to see it.
 *
 * A vendor gets their own slice and nothing else — not the other sellers'
 * lines, and not the shopper's grand total, which covers goods that are none
 * of theirs. An admin gets all of it.
 */
export async function getOrderFor(actor: Actor, orderId: number) {
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) return null;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const allLines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  /*
   * The extras that were bought with each line (3.1.2). The seller is who
   * turns up to fit the thing, so an order desk that does not say a fitting
   * was paid for is an order desk that gets somebody a sofa and no fitter.
   */
  const addonRows = allLines.length
    ? await db
        .select()
        .from(orderItemAddons)
        .where(inArray(orderItemAddons.orderItemId, allLines.map(line => line.id)))
    : [];
  const withAddons = allLines.map(line => ({
    ...line,
    addons: addonRows.filter(addon => addon.orderItemId === line.id),
  }));

  if (actor.kind === "vendor") {
    const mine = withAddons.filter(line => line.vendorId === actor.vendorId);
    // Not their order at all: a refusal, rather than an order with no lines,
    // which would confirm that the order exists.
    if (mine.length === 0) return null;
    const [slice] = sliceByVendor(
      mine.map(line => ({
        variantId: line.variantId ?? 0,
        productId: line.productId ?? 0,
        vendorId: line.vendorId ?? 0,
        vendorName: line.vendorName,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        /* The slice is arithmetic over `lineTotal`, which already covers the
           extras, so re-summing them here would count them twice. */
        addons: [],
        addonsTotal: "0.000",
        bundleId: line.bundleId,
        bundleName: line.bundleName,
        /* The slice is arithmetic over money; where the parcel went and what
           it takes to carry it do not enter into it, and both desks read the
           line's own copy. */
        destination: null,
        sizeClass: null,
        weightGrams: null,
        lineTotal: line.lineTotal,
        commissionPercent: line.commissionPercent,
        commissionFixed: line.commissionFixed,
        commissionAmount: line.commissionAmount,
        vendorNet: line.vendorNet,
        preordered: line.preordered,
        preorderReleaseAt: line.preorderReleaseAt,
      })),
    );
    return {
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        placedAt: order.placedAt,
        contactName: order.contactName,
        /* The seller is who hands the driver a parcel and takes the cash, so
           they need to know it is a cash order. It says how the shopper pays
           for their own goods and nothing about anybody else's. */
        paymentMethod: order.paymentMethod,
        deliveryZoneId: order.deliveryZoneId,
        addressLine: order.addressLine,
        addressNotes: order.addressNotes,
        deliveryPin: order.deliveryPin,
        /* A repeat order (3.1.19): the seller can tell a regular from a first order. */
        subscriptionId: order.subscriptionId,
      },
      lines: mine,
      slice,
      scope: "vendor" as const,
    };
  }

  return { order, lines: withAddons, slices: null, scope: "admin" as const };
}

/** Why a line could not be moved, as a message key the page translates. */
export class FulfilmentRefused extends Error {
  constructor(public readonly reason: "orders.badMove" | "orders.alreadySettled" | "orders.orderClosed" | "orders.lineMoved" | "orders.noStockToRestore" | "fulfilment.netletShips") {
    super(reason);
    this.name = "FulfilmentRefused";
  }
}

/**
 * Move one line through the warehouse.
 *
 * Per line rather than per order because partial shipment is ordinary, and
 * scoped so a vendor can only move their own: the check is against the line's
 * own vendor, so naming somebody else's line id is a refusal rather than a
 * write.
 *
 * ## Three things it did not do, all found by cancelling one line of a real order
 *
 * **It did not enforce `nextStates`.** The rule existed and only the page that
 * draws the buttons asked it, so the API moved a returned line back to
 * "delivered", or a cancelled one straight to "shipped" past re-taking its
 * stock. A hidden button is a courtesy, never a control.
 *
 * **Cancelling did not put the stock back.** The unit was taken at checkout and
 * kept, so every cancelled line was a unit the shelf lost for good. It goes back
 * to the pool it came from now — the pre-order allowance for a pre-ordered line —
 * and restoring a cancelled line takes it again under the same `>=` predicate the
 * checkout uses, so a line cannot be restored on stock that has since sold.
 *
 * **It could cancel a line whose money had already been collected**, which is a
 * refund wearing the wrong name. With the cash in, a cancelled line now owes the
 * shopper money that nothing records, so both cancelling and restoring are
 * refused once payment is collected; refunding the order is the act for that.
 *
 * And the write carries its predicate, the way the stock take does: two people
 * moving one line cannot both be told they were the one who moved it.
 */
export async function setLineFulfilment(
  actor: Actor,
  lineId: number,
  fulfilment: (typeof orderItems.$inferSelect)["fulfilment"],
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [line] = await db.select().from(orderItems).where(eq(orderItems.id, lineId)).limit(1);
  if (!line) throw new Error("NOT_FOUND");

  assertCan(actor, "stock.adjust", line.vendorId ?? undefined);
  /* A line off NetLet's shelf is NetLet's to pack (4.2): the seller is not
     holding the box, so their "packed" would be a claim about NetLet's floor. */
  if (actor.kind !== "customer" && !mayMoveLine(line.centreId, actor.kind)) throw new FulfilmentRefused("fulfilment.netletShips");

  if (line.fulfilment === fulfilment) return line;
  if (!nextStates(line.fulfilment).includes(fulfilment)) throw new FulfilmentRefused("orders.badMove");

  const cancelling = fulfilment === "cancelled";
  const restoring = line.fulfilment === "cancelled";
  const pool: Pool = line.preordered ? "preorder" : "stock";

  if (cancelling || restoring) {
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, line.orderId)).limit(1);
    /* An order closed by its last line going is not reopened by a restore: the
       shopper's card balance and points went back when it closed. */
    if (order?.status === "cancelled") throw new FulfilmentRefused("orders.orderClosed");
    if (order && order.status !== "pending_payment") throw new FulfilmentRefused("orders.alreadySettled");
  }

  /* Restoring takes the units back first, under the checkout's own predicate,
     and from the pool the line was sold from — a pre-ordered line restored onto
     ordinary stock would invent a promise nobody made. */
  if (restoring && line.variantId !== null) {
    const taken = pool === "stock"
      ? await takeStock(db, line.variantId, line.quantity)
      : await takePreorder(db, line.variantId, line.quantity);
    /* A shelf that has since changed hands is not this line's: it was sold
       from one place and is restored from that same place, or not at all. */
    if (taken && taken.centreId !== line.centreId) {
      await returnUnits(db, line.variantId, line.quantity, pool);
      throw new FulfilmentRefused("orders.noStockToRestore");
    }
    if (!taken) throw new FulfilmentRefused("orders.noStockToRestore");
  }

  /*
   * `delivered_at` is stamped here and nowhere else, because it is what the
   * return window and review eligibility are both measured from — a line that
   * says "delivered" with no date is a parcel nobody can review or send back.
   *
   * Moved *away* from delivered it is cleared, which is the uncomfortable half
   * and still right: a seller correcting a mis-click has said the parcel has
   * not arrived, and leaving the date would hold a return window open on it.
   */
  const deliveredAt = fulfilment === "delivered" ? (line.deliveredAt ?? new Date()) : null;

  const moved = await db
    .update(orderItems)
    .set({ fulfilment, deliveredAt })
    .where(and(eq(orderItems.id, lineId), eq(orderItems.fulfilment, line.fulfilment)))
    .returning({ id: orderItems.id });
  if (moved.length === 0) {
    /* Somebody moved it first. Hand back what restoring took. */
    if (restoring && line.variantId !== null) await returnUnits(db, line.variantId, line.quantity, pool);
    throw new FulfilmentRefused("orders.lineMoved");
  }

  if (cancelling && line.variantId !== null) await returnUnits(db, line.variantId, line.quantity, pool, line.centreId);
  if (cancelling) await closeIfNothingLeft(db, line.orderId);
  return { ...line, fulfilment, deliveredAt };
}

/**
 * Close an unpaid order whose every line has been cancelled, and give back
 * what the shopper paid toward it in anything but cash.
 *
 * A line going takes its own total off what the driver collects, and the
 * order-level reductions stay whole (`collection.ts`). That is right while
 * something is still coming; once nothing is, the gift card's balance, the
 * points and the discount code's use were all spent on an order that delivers
 * nothing, and nothing gave them back — the shopper paid KWD 10 of a card for
 * a sofa the seller never had. Placing an order hands all three back when a
 * later step refuses; this is the same promise kept after the order exists.
 *
 * **Exactly once, by the order's own status.** Two sellers cancelling the last
 * two lines of one basket at once both read the lines after their own write,
 * so at least one sees them all gone and possibly both do; the `UPDATE` from
 * `pending_payment` lets one of them through. Everything it returns is in the
 * same transaction as that move, so a card is never closed without its
 * balance going back.
 *
 * Points come back as an entry of their own rather than by deleting the
 * spend: the order existed, and the shopper's history should say what happened
 * to it. A gift card's use row goes, so its uses and its balance still add up
 * to what it was issued for. An agreed price the order used is free again.
 */
export async function closeIfNothingLeft(db: Db, orderId: number): Promise<boolean> {
  const lines = await db.select({ fulfilment: orderItems.fulfilment }).from(orderItems).where(eq(orderItems.orderId, orderId));
  if (lines.length === 0 || lines.some(one => one.fulfilment !== "cancelled")) return false;

  return db.transaction(async tx => {
    const [closed] = await tx
      .update(orders)
      .set({ status: "cancelled" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")))
      .returning({
        userId: orders.userId,
        pointsSpent: orders.pointsSpent,
        giftCardCode: orders.giftCardCode,
        giftCardValue: orders.giftCardValue,
      });
    if (!closed) return false;

    if (closed.giftCardCode && toFils(closed.giftCardValue) > 0n) {
      await refundGiftCard(tx as unknown as Db, closed.giftCardCode, closed.giftCardValue);
      await tx.delete(giftCardUses).where(eq(giftCardUses.orderId, orderId));
    }
    if (closed.userId !== null && closed.pointsSpent > 0) {
      await tx.insert(pointEntries).values({ userId: closed.userId, points: closed.pointsSpent, reason: "order_cancelled", orderId });
    }
    await tx.delete(discountRedemptions).where(eq(discountRedemptions.orderId, orderId));
    await tx.update(priceOffers).set({ usedOnOrderId: null }).where(eq(priceOffers.usedOnOrderId, orderId));
    return true;
  });
}

/**
 * Record that a driver collected the cash (3.2.2).
 *
 * This is the moment a cash order becomes paid, and it is deliberately a
 * separate act from placing it: at checkout nothing had changed hands, and
 * marking it `paid` there would have put revenue in the finance panel that
 * nobody had collected.
 *
 * The predicate lives inside the `UPDATE`, the way the stock take does, so two
 * people pressing it cannot both be told they were the one who recorded it.
 */
export async function recordCashCollected(actor: Actor, orderId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [order] = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return false;

  /* Scoped like every other order read: a vendor may only touch an order that
     holds one of their lines, and the guard is beside the query. */
  const scope = await getOrderFor(actor, orderId);
  if (!scope) return false;

  const updated = await db
    .update(orders)
    .set({ status: "paid", paymentCollectedAt: new Date() })
    .where(and(
      eq(orders.id, orderId),
      eq(orders.paymentMethod, "cod"),
      eq(orders.status, "pending_payment"),
    ))
    .returning({ id: orders.id });

  if (updated.length === 0) return false;

  /*
   * This is the moment a referral pays (3.1.14), and it is here rather than at
   * placement on purpose: a cash order nobody collects has earned nobody
   * anything. It rides on the update having landed, so the exactly-once the
   * predicate above gives the payment gives the points too — and
   * `qualifyReferral` claims its row with a predicate of its own regardless.
   */
  if (order.userId) await qualifyReferral(db, order.userId, orderId);
  /* An affiliate's share is earned at the same moment and for the same
     reason (3.7) — and exactly once, by the ledger's own index. */
  await affiliateQuietly(() => creditAffiliate(db, orderId), `credit the affiliate for order ${orderId}`);

  /* The sale is complete, so it is invoiced (3.6.6) — after the payment has
     landed and without undoing it if issuing fails; the next read repairs. */
  await issueQuietly(() => issueInvoice(orderId), `the invoice for order ${orderId}`);

  return true;
}
