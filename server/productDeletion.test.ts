/**
 * Deleting a product, against a real Postgres.
 *
 * The cascade is the schema's promise and the clean-up is this module's, so
 * both are checked by reading the tables afterwards rather than trusting the
 * function's own report: a delete that says it worked and left a Saved heart
 * pointing at nothing is the failure this exists to stop.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  adBookings,
  auditLog,
  bundleItems,
  bundles,
  cartItems,
  carts,
  followedProducts,
  fulfilmentCentres,
  mediaFiles,
  orderItems,
  orders,
  productImages,
  products,
  productVariants,
  savedProducts,
  stockMovements,
  subscriptions,
  users,
  vendorMembers,
  vendors,
  wishlistItems,
  wishlists,
} from "../drizzle/schema.js";
import type { Actor } from "../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let deletion: typeof import("./productDeletion");
let inv: typeof import("./inventory");

const ids = { admin: 0, owner: 0, staff: 0, shopper: 0, acme: 0, other: 0 };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async () => {
    const actual = await vi.importActual<typeof import("./db.js")>("./db.js");
    return { ...actual, getDb: async () => db };
  });
  deletion = await import("./productDeletion");
  inv = await import("./inventory");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [staff] = await db.insert(users).values({ email: "staff@acme.test" }).returning();
  const [shopper] = await db.insert(users).values({ email: "noura@shop.test" }).returning();
  ids.admin = admin.id; ids.owner = owner.id; ids.staff = staff.id; ids.shopper = shopper.id;
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  ids.acme = acme.id; ids.other = other.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: owner.id, role: "owner" },
    { vendorId: acme.id, userId: staff.id, role: "staff" },
  ]);
}, 60_000);

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const staff = (): Actor => ({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });

let serial = 0;
/** A product with two variants, a photo, history, and a shopper who wants it. */
async function stocked(vendorId = ids.acme) {
  serial += 1;
  const [product] = await db.insert(products).values({ vendorId, handle: `lamp-${serial}`, title: `Brass lamp ${serial}`, status: "published" }).returning();
  const [small] = await db.insert(productVariants).values({ productId: product.id, title: "Small", price: "12.500", stock: 4 }).returning();
  const [large] = await db.insert(productVariants).values({ productId: product.id, title: "Large", price: "18.000", stock: 2 }).returning();
  await db.insert(productImages).values({ productId: product.id, url: "https://example.test/lamp.jpg", position: 0 });
  await db.insert(stockMovements).values({ variantId: small.id, delta: 4, resulting: 4, reason: "received" });
  return { product, small, large };
}

describe("who may delete", () => {
  it("refuses staff, who move stock and do not run the catalogue", async () => {
    const { product } = await stocked();
    await expect(deletion.deleteProduct(staff(), product.id)).rejects.toThrow("FORBIDDEN:product.delete");
    await expect(deletion.deletionCheck(staff(), product.id)).rejects.toThrow("FORBIDDEN:product.delete");
  });

  it("refuses a store deleting another store's product, and leaves it standing", async () => {
    const { product } = await stocked(ids.other);
    await expect(deletion.deleteProduct(owner(), product.id)).rejects.toThrow("FORBIDDEN:product.delete");
    expect(await db.select().from(products).where(eq(products.id, product.id))).toHaveLength(1);
  });

  it("answers an unknown id as not found", async () => {
    await expect(deletion.deleteProduct(admin(), 999_999)).rejects.toThrow("NOT_FOUND");
  });
});

describe("what goes with it", () => {
  it("takes the variants, photos, stock history and basket lines, and clears the string-keyed lists", async () => {
    const { product, small, large } = await stocked();
    const storefrontId = String(product.id);
    const [cart] = await db.insert(carts).values({ id: `cart-${serial}`, userId: ids.shopper }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: small.id, quantity: 1 });
    await db.insert(savedProducts).values({ userId: ids.shopper, productId: storefrontId });
    await db.insert(followedProducts).values({ userId: ids.shopper, productId: storefrontId });
    const [list] = await db.insert(wishlists).values({ userId: ids.shopper, title: "Birthday", shareToken: `token-${serial}` }).returning();
    await db.insert(wishlistItems).values({ wishlistId: list.id, productId: storefrontId });

    const check = await deletion.deletionCheck(owner(), product.id);
    expect(check).toMatchObject({ variants: 2, images: 1, unitsOnHand: 6, inCarts: 1, savedBy: 1, blockers: [] });

    await deletion.deleteProduct(owner(), product.id);

    expect(await db.select().from(products).where(eq(products.id, product.id))).toHaveLength(0);
    expect(await db.select().from(productVariants).where(eq(productVariants.productId, product.id))).toHaveLength(0);
    expect(await db.select().from(productImages).where(eq(productImages.productId, product.id))).toHaveLength(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.variantId, small.id))).toHaveLength(0);
    expect(await db.select().from(cartItems).where(eq(cartItems.variantId, small.id))).toHaveLength(0);
    expect(await db.select().from(savedProducts).where(eq(savedProducts.productId, storefrontId))).toHaveLength(0);
    expect(await db.select().from(followedProducts).where(eq(followedProducts.productId, storefrontId))).toHaveLength(0);
    expect(await db.select().from(wishlistItems).where(eq(wishlistItems.productId, storefrontId))).toHaveLength(0);
    /* The basket survives; only the line went. */
    expect(await db.select().from(carts).where(eq(carts.id, cart.id))).toHaveLength(1);
    expect(large.id).toBeGreaterThan(0);
  });

  it("keeps an order's frozen copy, with the references cleared", async () => {
    const { product, small } = await stocked();
    const [order] = await db.insert(orders).values({
      reference: `NL-DEL-${serial}`, userId: ids.shopper, email: "noura@shop.test", status: "pending_payment",
      itemsTotal: "12.500", grandTotal: "12.500", currency: "KWD",
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, vendorId: ids.acme, vendorName: "Acme", productId: product.id, variantId: small.id,
      productTitle: product.title, unitPrice: "12.500", quantity: 1, lineTotal: "12.500",
      commissionPercent: "10.00", commissionAmount: "1.250", vendorNet: "11.250",
    });

    expect((await deletion.deletionCheck(admin(), product.id)).openOrderLines).toBe(1);
    await deletion.deleteProduct(admin(), product.id);

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(line).toMatchObject({ productId: null, variantId: null, productTitle: product.title, lineTotal: "12.500" });
  });

  it("takes a bundle naming it off the shelf rather than selling what is left at the set's price", async () => {
    const { product, small } = await stocked();
    const other = await stocked();
    const [bundle] = await db.insert(bundles).values({ name: "Lamp pair", vendorId: ids.acme, bundlePrice: "25.000", active: true }).returning();
    await db.insert(bundleItems).values([{ bundleId: bundle.id, variantId: small.id }, { bundleId: bundle.id, variantId: other.small.id }]);

    const result = await deletion.deleteProduct(owner(), product.id);
    expect(result.bundlesWithdrawn).toBe(1);
    const [after] = await db.select().from(bundles).where(eq(bundles.id, bundle.id));
    expect(after.active).toBe(false);
  });

  it("pauses a standing order now, with its reason, rather than at its next run", async () => {
    const { product, small } = await stocked();
    const [sub] = await db.insert(subscriptions).values({
      userId: ids.shopper, variantId: small.id, productId: product.id, productTitle: product.title,
      quantity: 1, intervalWeeks: 4, priceCeiling: "12.500", nextRunOn: "2026-12-01",
    }).returning();

    const result = await deletion.deleteProduct(owner(), product.id);
    expect(result.subscriptionsPaused).toBe(1);
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(after).toMatchObject({ status: "paused", pausedReason: "unavailable", variantId: null });
  });

  it("removes an uploaded photo nothing else shows, and keeps one another product still uses", async () => {
    const { product } = await stocked();
    const keep = await stocked();
    const bytes = Buffer.from([1, 2, 3]);
    const only = "onlyhereonlyhere1234";
    const shared = "sharedsharedshared12";
    await db.insert(mediaFiles).values([
      { id: only, contentType: "image/webp", bytes, width: 1, height: 1, byteSize: 3 },
      { id: shared, contentType: "image/webp", bytes, width: 1, height: 1, byteSize: 3 },
    ]);
    await db.insert(productImages).values([
      { productId: product.id, url: `/media/${only}.webp`, position: 1 },
      { productId: product.id, url: `/media/${shared}.webp`, position: 2 },
      { productId: keep.product.id, url: `/media/${shared}.webp`, position: 1 },
    ]);

    const result = await deletion.deleteProduct(owner(), product.id);
    expect(result.photosRemoved).toBe(1);
    expect(await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, only))).toHaveLength(0);
    expect(await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, shared))).toHaveLength(1);
  });

  it("writes the variants as they were into the audit trail, since nothing else holds them now", async () => {
    const { product } = await stocked();
    await deletion.deleteProduct(owner(), product.id);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.subjectId, product.id));
    expect(row).toMatchObject({ action: "product.delete", subjectLabel: product.title, vendorId: ids.acme, actorRole: "owner" });
    expect((row.before as { variants: { title: string }[] }).variants.map(variant => variant.title)).toEqual(["Small", "Large"]);
  });
});

describe("what it outlives", () => {
  it("refuses while a paid placement is running or booked, and allows it once cancelled", async () => {
    const { product } = await stocked();
    const now = new Date("2026-10-11T09:00:00Z");
    const [booking] = await db.insert(adBookings).values({
      vendorId: ids.acme, productId: product.id, productTitle: product.title, slot: "home",
      startsOn: "2026-10-10", endsOn: "2026-10-20", dailyRate: "2.000", total: "22.000",
    }).returning();

    expect((await deletion.deletionCheck(owner(), product.id, now)).blockers).toEqual(["admin.deleteBlockedAd"]);
    await expect(deletion.deleteProduct(owner(), product.id, now)).rejects.toThrow("admin.deleteBlockedAd");
    expect(await db.select().from(products).where(eq(products.id, product.id))).toHaveLength(1);

    await db.update(adBookings).set({ cancelledOn: "2026-10-11" }).where(eq(adBookings.id, booking.id));
    await deletion.deleteProduct(owner(), product.id, now);
    expect(await db.select().from(products).where(eq(products.id, product.id))).toHaveLength(0);
  });

  it("does not count a placement that has already finished", async () => {
    const { product } = await stocked();
    await db.insert(adBookings).values({
      vendorId: ids.acme, productId: product.id, productTitle: product.title, slot: "home",
      startsOn: "2026-09-01", endsOn: "2026-09-05", dailyRate: "2.000", total: "10.000",
    });
    const check = await deletion.deletionCheck(owner(), product.id, new Date("2026-10-11T09:00:00Z"));
    expect(check.blockers).toEqual([]);
  });

  it("refuses while NetLet holds units of it", async () => {
    const { product, small } = await stocked();
    const [centre] = await db.insert(fulfilmentCentres).values({ name: "Shuwaikh", governorate: "Capital", addressLine: "Block 1" }).returning();
    await db.update(productVariants).set({ centreId: centre.id }).where(eq(productVariants.id, small.id));
    await expect(deletion.deleteProduct(admin(), product.id)).rejects.toThrow("admin.deleteBlockedNetlet");
  });
});

describe("creating through the guided form", () => {
  it("writes the price, the code, the count and the photos in one go, with the count in the history", async () => {
    const row = await inv.createProduct(owner(), {
      vendorId: ids.acme,
      title: "Walnut tray",
      variant: { price: "9.750", compareAtPrice: "12.000", sku: "TRAY-1", stock: 7 },
      images: [{ url: "https://example.test/tray.jpg" }, { url: "https://example.test/tray-2.jpg" }],
    });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, row.id));
    expect(variant).toMatchObject({ title: "Default", price: "9.750", compareAtPrice: "12.000", sku: "TRAY-1", stock: 7 });
    const photos = await db.select().from(productImages).where(eq(productImages.productId, row.id));
    expect(photos.map(photo => photo.position)).toEqual([0, 1]);
    const [movement] = await db.select().from(stockMovements).where(eq(stockMovements.variantId, variant.id));
    expect(movement).toMatchObject({ delta: 7, resulting: 7, reason: "received" });
    expect(row.status).toBe("draft");
  });

  it("refuses a code the store already uses, and leaves nothing half-made", async () => {
    await expect(inv.createProduct(owner(), {
      vendorId: ids.acme,
      title: "Second tray",
      variant: { price: "9.750", sku: "TRAY-1" },
    })).rejects.toThrow("SKU_TAKEN");
    expect(await db.select().from(products).where(eq(products.title, "Second tray"))).toHaveLength(0);
  });
});
