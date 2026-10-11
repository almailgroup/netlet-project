/**
 * Deleting a product, for good.
 *
 * Archiving hides a product and keeps it; this removes it, and almost all of
 * the work is the database's. `product_variants`, `product_images` and
 * `product_addons` cascade from the product, and `stock_movements`,
 * `cart_items`, `price_offers` and `bundle_items` from the variant. Every
 * reference out of an order — `order_items`, `order_item_addons`, reviews,
 * chat messages, subscriptions, placements, inbound lines — is `set null`, with
 * the facts that matter already copied beside it, because an order from last
 * year still has to say what was bought and at what price.
 *
 * What is left is what no foreign key can see, and that is this file:
 *
 * - **Three tables name a product by the storefront's string id** — saved,
 *   wishlists, follows — so nothing cascades into them and they are cleared by
 *   hand, or a shopper's Saved list carries a heart for nothing.
 * - **A bundle naming a variant is taken off the shelf**, before the cascade
 *   removes the item. Left on, it would sell what remains at the price agreed
 *   for the whole set — a price nobody set for that.
 * - **A standing order is paused now, with its reason**, rather than at its
 *   next run, so the shopper reads why on their account page today.
 * - **An uploaded photo nothing else shows is deleted.** `media_files` holds
 *   the bytes; a row no product or store logo points at is storage spent on
 *   nothing.
 *
 * And two refusals, both about obligations that outlive the product: **a paid
 * placement still running or booked** (its fee accrues a day at a time for a
 * shelf that would now show nothing — cancel it first, which is its own
 * decision about money), and **stock NetLet holds or is expecting** (physical
 * units in a warehouse would become units of nothing). Orders do not refuse:
 * they were frozen at the sale so that this could happen.
 *
 * The same capability decides both the check and the act, and the act asks
 * every question again inside its transaction — the dialog's answer is a
 * preview, not a promise.
 */
import { and, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  adBookings,
  bundleItems,
  bundles,
  cartItems,
  followedProducts,
  inboundLines,
  inboundShipments,
  mediaFiles,
  orderItems,
  orders,
  productImages,
  products,
  productVariants,
  savedProducts,
  subscriptions,
  vendors,
  wishlistItems,
} from "../drizzle/schema.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { kuwaitToday } from "../shared/commerce/adBookings.js";
import { isMediaPath } from "../shared/commerce/media.js";
import type { MessageKey } from "../shared/i18n/dictionary.js";
import { auditActor } from "./inventory.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/* A transaction has every query method the pool has, which is all this uses. */
type Runner = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Why a product cannot be deleted yet. Message keys, so the dialog says it. */
export type DeletionBlocker = Extract<MessageKey, "admin.deleteBlockedAd" | "admin.deleteBlockedNetlet">;

/** What deleting would touch, for the dialog to show before anybody confirms. */
export type DeletionCheck = {
  id: number;
  title: string;
  variants: number;
  images: number;
  unitsOnHand: number;
  inCarts: number;
  savedBy: number;
  openOrderLines: number;
  bundles: number;
  subscriptions: number;
  blockers: DeletionBlocker[];
};

/** The order lines a seller still owes somebody: not delivered, not undone. */
const OPEN_LINE_STATES = ["pending", "preparing", "shipped"] as const;

async function assess(db: Runner, product: { id: number; title: string }, now: Date): Promise<DeletionCheck> {
  const variants = await db
    .select({ id: productVariants.id, stock: productVariants.stock, centreId: productVariants.centreId })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id));
  const variantIds = variants.map(variant => variant.id);
  /* `inArray` with an empty list is refused when the statement is built, and a
     product can have no variants — every query below is asked of this. */
  const ofVariants = (column: AnyPgColumn) => inArray(column, variantIds.length ? variantIds : [-1]);
  const storefrontId = String(product.id);

  const [images, inCarts, savedBy, openLines, inBundles, standing, placements, inbound] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(productImages).where(eq(productImages.productId, product.id)),
    db.select({ n: sql<number>`count(distinct ${cartItems.cartId})::int` }).from(cartItems).where(ofVariants(cartItems.variantId)),
    db.select({ n: sql<number>`count(distinct ${savedProducts.userId})::int` }).from(savedProducts).where(eq(savedProducts.productId, storefrontId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        ofVariants(orderItems.variantId),
        inArray(orderItems.fulfilment, [...OPEN_LINE_STATES]),
        notInArray(orders.status, ["cancelled", "refunded"]),
      )),
    db.select({ n: sql<number>`count(distinct ${bundleItems.bundleId})::int` }).from(bundleItems).where(ofVariants(bundleItems.variantId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(and(ofVariants(subscriptions.variantId), inArray(subscriptions.status, ["active", "paused"]))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(adBookings)
      .where(and(eq(adBookings.productId, product.id), isNull(adBookings.cancelledOn), gte(adBookings.endsOn, kuwaitToday(now)))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(inboundLines)
      .innerJoin(inboundShipments, eq(inboundLines.shipmentId, inboundShipments.id))
      .where(and(ofVariants(inboundLines.variantId), eq(inboundShipments.status, "announced"))),
  ]);

  const count = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  const held = variants.some(variant => variant.centreId !== null && variant.stock > 0);
  const blockers: DeletionBlocker[] = [];
  if (count(placements) > 0) blockers.push("admin.deleteBlockedAd");
  if (held || count(inbound) > 0) blockers.push("admin.deleteBlockedNetlet");

  return {
    id: product.id,
    title: product.title,
    variants: variants.length,
    images: count(images),
    unitsOnHand: variants.reduce((total, variant) => total + Math.max(0, variant.stock), 0),
    inCarts: count(inCarts),
    savedBy: count(savedBy),
    openOrderLines: count(openLines),
    bundles: count(inBundles),
    subscriptions: count(standing),
    blockers,
  };
}

async function productRow(db: Runner, productId: number, lock = false) {
  const query = db.select().from(products).where(eq(products.id, productId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** What deleting this product would do, and whether anything stops it. */
export async function deletionCheck(actor: Actor, productId: number, now = new Date()): Promise<DeletionCheck> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const row = await productRow(db, productId);
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.delete", row.vendorId);
  return assess(db, row, now);
}

export type DeletionResult = {
  id: number;
  title: string;
  bundlesWithdrawn: number;
  subscriptionsPaused: number;
  photosRemoved: number;
};

/**
 * Deletes the product and everything that is only about it, in one
 * transaction: a failure anywhere leaves the product exactly as it was.
 */
export async function deleteProduct(actor: Actor, productId: number, now = new Date()): Promise<DeletionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  /* Read and guarded before the transaction, so a refusal costs no lock. */
  const first = await productRow(db, productId);
  if (!first) throw new Error("NOT_FOUND");
  assertCan(actor, "product.delete", first.vendorId);

  const outcome = await db.transaction(async tx => {
    /* The row lock is what a concurrent edit or publish waits on; asked again
       under it, because somebody may have deleted it in the meantime. */
    const row = await productRow(tx, productId, true);
    if (!row) throw new Error("NOT_FOUND");
    const check = await assess(tx, row, now);
    if (check.blockers.length) throw new Error(check.blockers[0]);

    const variants = await tx
      .select({ id: productVariants.id, title: productVariants.title, sku: productVariants.sku, price: productVariants.price, stock: productVariants.stock })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    const variantIds = variants.map(variant => variant.id);
    const images = await tx
      .select({ url: productImages.url, posterUrl: productImages.posterUrl })
      .from(productImages)
      .where(eq(productImages.productId, productId));

    let bundlesWithdrawn = 0;
    let subscriptionsPaused = 0;
    if (variantIds.length) {
      const withdrawn = await tx
        .update(bundles)
        .set({ active: false })
        .where(and(
          eq(bundles.active, true),
          inArray(bundles.id, tx.select({ id: bundleItems.bundleId }).from(bundleItems).where(inArray(bundleItems.variantId, variantIds))),
        ))
        .returning({ id: bundles.id });
      bundlesWithdrawn = withdrawn.length;

      const paused = await tx
        .update(subscriptions)
        .set({ status: "paused", pausedReason: "unavailable" })
        .where(and(inArray(subscriptions.variantId, variantIds), eq(subscriptions.status, "active")))
        .returning({ id: subscriptions.id });
      subscriptionsPaused = paused.length;
    }

    const storefrontId = String(productId);
    await tx.delete(savedProducts).where(eq(savedProducts.productId, storefrontId));
    await tx.delete(wishlistItems).where(eq(wishlistItems.productId, storefrontId));
    await tx.delete(followedProducts).where(eq(followedProducts.productId, storefrontId));

    /* The cascade does the rest: variants, images, add-ons, stock history,
       basket lines, price asks and bundle items. */
    await tx.delete(products).where(eq(products.id, productId));

    /*
     * Uploaded photos are stored as `/media/<id>.<ext>`, and the same path can
     * sit on another product — a seller reusing one shot — or inside a store's
     * logo URL. Only a photo nothing points at any more is removed.
     */
    const paths = Array.from(new Set(images.flatMap(image => [image.url, image.posterUrl]).filter((path): path is string => !!path && isMediaPath(path))));
    let photosRemoved = 0;
    for (const path of paths) {
      const [stillUsed] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(productImages)
        .where(or(eq(productImages.url, path), eq(productImages.posterUrl, path)));
      const [onLogo] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(vendors)
        .where(and(isNotNull(vendors.logoUrl), sql`${vendors.logoUrl} like ${`%${path}`}`));
      if ((stillUsed?.n ?? 0) > 0 || (onLogo?.n ?? 0) > 0) continue;
      const id = path.slice("/media/".length).replace(/\.[a-z]+$/, "");
      const removed = await tx.delete(mediaFiles).where(eq(mediaFiles.id, id)).returning({ id: mediaFiles.id });
      photosRemoved += removed.length;
    }

    return { row, check, variants, bundlesWithdrawn, subscriptionsPaused, photosRemoved };
  });

  /*
   * After the commit, never inside it: an audit row is written by its own
   * connection and never fails the operation it records. The row carries the
   * variants as they were, because after this there is nothing else to read
   * them from.
   */
  await recordAudit(await auditActor(actor), {
    action: "product.delete",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: outcome.row.title,
    vendorId: outcome.row.vendorId,
    before: {
      title: outcome.row.title,
      handle: outcome.row.handle,
      status: outcome.row.status,
      variants: outcome.variants.map(variant => ({ title: variant.title, sku: variant.sku, price: variant.price, stock: variant.stock })),
      images: outcome.check.images,
    },
    after: {
      deleted: true,
      bundlesWithdrawn: outcome.bundlesWithdrawn,
      subscriptionsPaused: outcome.subscriptionsPaused,
      photosRemoved: outcome.photosRemoved,
      openOrderLines: outcome.check.openOrderLines,
    },
  });

  return {
    id: productId,
    title: outcome.row.title,
    bundlesWithdrawn: outcome.bundlesWithdrawn,
    subscriptionsPaused: outcome.subscriptionsPaused,
    photosRemoved: outcome.photosRemoved,
  };
}

