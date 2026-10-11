/**
 * Moving a product to another store.
 *
 * An administrator puts a product in the wrong store, or a shop's line is
 * taken over by another; either way the product should change hands without
 * being deleted and re-made, which would lose its reviews, its address, its
 * photos and everybody's saved hearts. `products.vendor_id` is one column, and
 * almost everything else follows it on its own: stock, the catalogue, the
 * commission the new store is charged and the discount permit that governs its
 * savings are all read through the product's *current* store.
 *
 * What does not follow is what was frozen, and that is the point of freezing
 * it. An order line carries the store it was sold by (`order_items.vendor_id`,
 * `vendor_net`), so last month's sales stay the old store's to be paid for, and
 * a payout cannot move with a product.
 *
 * Three obligations belong to the old store and refuse the move, because each
 * would otherwise be charged to the wrong one:
 *
 * - **a paid placement still running or booked** — its fee accrues against the
 *   store that booked it, for a product that would no longer be theirs;
 * - **stock NetLet holds or is expecting** — those are the old store's units in
 *   NetLet's warehouse, sent on the old store's inbound shipment;
 * - **a price a shopper asked for or was agreed** — a figure the old store
 *   quoted would be honoured out of the new store's money.
 *
 * And one thing is taken off the shelf rather than refused: the old store's own
 * bundles naming the product. A seller's bundle is that seller's goods at that
 * seller's price, and leaving the product in it would sell somebody else's
 * stock under a price they never set. NetLet's cross-store bundles carry no
 * store and are left alone.
 *
 * A SKU is the seller's own code, unique across *their* shelf — so a code the
 * new store already uses refuses the move, exactly as typing it would.
 */
import { and, eq, gt, gte, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  adBookings,
  bundleItems,
  bundles,
  inboundLines,
  inboundShipments,
  priceOffers,
  products,
  productVariants,
  vendors,
} from "../drizzle/schema.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { kuwaitToday } from "../shared/commerce/adBookings.js";
import type { MessageKey } from "../shared/i18n/dictionary.js";
import { auditActor } from "./inventory.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";

/** Why a product cannot change stores yet. Message keys, so the editor says it. */
export type MoveRefusal = Extract<
  MessageKey,
  "admin.moveBlockedAd" | "admin.moveBlockedNetlet" | "admin.moveBlockedOffer" | "admin.moveSameStore" | "admin.skuTaken"
>;

export class MoveRefused extends Error {
  constructor(public readonly reason: MoveRefusal) {
    super(reason);
  }
}

export type MoveResult = {
  id: number;
  title: string;
  from: { id: number; name: string };
  to: { id: number; name: string };
  bundlesWithdrawn: number;
};

export async function moveProductToVendor(actor: Actor, productId: number, vendorId: number, now = new Date()): Promise<MoveResult> {
  assertCan(actor, "product.reassign");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const result = await db.transaction(async tx => {
    /* The product's row lock is what an edit, a publish or a delete waits on,
       and everything below is asked again under it. */
    const [row] = await tx.select().from(products).where(eq(products.id, productId)).limit(1).for("update");
    if (!row) throw new Error("NOT_FOUND");
    if (row.vendorId === vendorId) throw new MoveRefused("admin.moveSameStore");

    const [from] = await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, row.vendorId)).limit(1);
    const [to] = await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    if (!to) throw new Error("NOT_FOUND");

    const variants = await tx
      .select({ id: productVariants.id, sku: productVariants.sku, stock: productVariants.stock, centreId: productVariants.centreId })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const variantIds = variants.map(variant => variant.id);
    const ofVariants = variantIds.length ? variantIds : [-1];

    const [placements] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(adBookings)
      .where(and(eq(adBookings.productId, productId), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, kuwaitToday(now))));
    if ((placements?.n ?? 0) > 0) throw new MoveRefused("admin.moveBlockedAd");

    const [inbound] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(inboundLines)
      .innerJoin(inboundShipments, eq(inboundLines.shipmentId, inboundShipments.id))
      .where(and(inArray(inboundLines.variantId, ofVariants), eq(inboundShipments.status, "announced")));
    if (variants.some(variant => variant.centreId !== null && variant.stock > 0) || (inbound?.n ?? 0) > 0) {
      throw new MoveRefused("admin.moveBlockedNetlet");
    }

    const [offers] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(priceOffers)
      .where(and(
        inArray(priceOffers.variantId, ofVariants),
        inArray(priceOffers.status, ["pending", "offered"]),
        isNull(priceOffers.usedOnOrderId),
        or(isNull(priceOffers.expiresAt), gt(priceOffers.expiresAt, now)),
      ));
    if ((offers?.n ?? 0) > 0) throw new MoveRefused("admin.moveBlockedOffer");

    /* The seller's own code, on the new seller's shelf. */
    const codes = variants.map(variant => variant.sku?.trim()).filter((code): code is string => !!code);
    if (codes.length) {
      const [clash] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(eq(products.vendorId, vendorId), ne(products.id, productId), inArray(productVariants.sku, codes)))
        .limit(1);
      if (clash) throw new MoveRefused("admin.skuTaken");
    }

    const withdrawn = variantIds.length
      ? await tx
        .update(bundles)
        .set({ active: false })
        .where(and(
          eq(bundles.active, true),
          isNotNull(bundles.vendorId),
          eq(bundles.vendorId, row.vendorId),
          inArray(bundles.id, tx.select({ id: bundleItems.bundleId }).from(bundleItems).where(inArray(bundleItems.variantId, variantIds))),
        ))
        .returning({ id: bundles.id })
      : [];

    await tx.update(products).set({ vendorId }).where(eq(products.id, productId));

    return {
      id: productId,
      title: row.title,
      from: from ?? { id: row.vendorId, name: `#${row.vendorId}` },
      to,
      bundlesWithdrawn: withdrawn.length,
    };
  });

  await recordAudit(await auditActor(actor), {
    action: "product.move",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: result.title,
    vendorId: result.to.id,
    before: { vendorId: result.from.id, vendor: result.from.name },
    after: { vendorId: result.to.id, vendor: result.to.name, bundlesWithdrawn: result.bundlesWithdrawn },
  });

  return result;
}
