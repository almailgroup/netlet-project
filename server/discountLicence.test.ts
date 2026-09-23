/**
 * The discount permit, against a real Postgres.
 *
 * The rule is proved pure in `shared/inventory/discountLicence.test.ts`. What
 * these cover is the half that cannot be: that both doors onto the shelf are
 * shut against an unlicensed offer, and — the one that matters most — that the
 * storefront stops advertising a saving when a permit lapses *with nobody
 * saving anything*, which is the case a write-time check alone would miss.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { productVariants, products, users, vendors } from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let inventory: typeof import("./inventory.js");
let catalog: typeof import("./catalog.js");

const ids = { admin: 0, vendor: 0, product: 0, variant: 0 };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  inventory = await import("./inventory.js");
  catalog = await import("./catalog.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [vendor] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [product] = await db.insert(products).values({
    vendorId: vendor.id, handle: "sale-lamp", title: "Sale Lamp", status: "draft",
  }).returning();
  const [variant] = await db.insert(productVariants).values({
    productId: product.id, title: "Default", price: "20.000", compareAtPrice: "25.000", stock: 5,
  }).returning();
  ids.admin = admin.id; ids.vendor = vendor.id; ids.product = product.id; ids.variant = variant.id;
}, 60_000);

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const future = () => new Date(Date.now() + 30 * 86_400_000);
const past = () => new Date(Date.now() - 5 * 86_400_000);

const setLicence = (number: string | null, expiresAt: Date | null) =>
  db.update(vendors)
    .set({ discountLicenceNumber: number, discountLicenceExpiresAt: expiresAt })
    .where(eq(vendors.id, ids.vendor));

beforeEach(async () => {
  await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.product));
  await db.update(productVariants)
    .set({ price: "20.000", compareAtPrice: "25.000" })
    .where(eq(productVariants.id, ids.variant));
  await setLicence(null, null);
});

describe("publishing an offer", () => {
  it("is refused when the store has recorded no permit", async () => {
    await expect(inventory.setProductStatus(adminActor(), ids.product, "published"))
      .rejects.toThrow("DISCOUNT_LICENCE_MISSING");
  });

  it("is refused when the permit has expired", async () => {
    await setLicence("MOCI-2026-4471", past());
    await expect(inventory.setProductStatus(adminActor(), ids.product, "published"))
      .rejects.toThrow("DISCOUNT_LICENCE_EXPIRED");
  });

  it("goes through with a valid permit", async () => {
    await setLicence("MOCI-2026-4471", future());
    await expect(inventory.setProductStatus(adminActor(), ids.product, "published")).resolves.toBe("published");
  });

  /* No compare-at price is no offer, so it needs no paperwork. */
  it("does not ask for a permit from a product that is not on offer", async () => {
    await db.update(productVariants).set({ compareAtPrice: null }).where(eq(productVariants.id, ids.variant));
    await expect(inventory.setProductStatus(adminActor(), ids.product, "published")).resolves.toBe("published");
  });

  it("does not ask when the compare-at price is not above the price", async () => {
    await db.update(productVariants).set({ compareAtPrice: "20.000" }).where(eq(productVariants.id, ids.variant));
    await expect(inventory.setProductStatus(adminActor(), ids.product, "published")).resolves.toBe("published");
  });

  /* The review queue is the other door, and approving is publishing. */
  it("is refused at the review queue too", async () => {
    await db.update(products).set({ status: "pending_review" }).where(eq(products.id, ids.product));
    await expect(inventory.reviewProduct(adminActor(), ids.product, true))
      .rejects.toThrow("DISCOUNT_LICENCE_MISSING");
  });
});

describe("what the storefront shows", () => {
  /*
   * The case the whole design turns on. The product was published while the
   * permit was valid; the permit then lapsed and nobody touched anything. A
   * check only at write time leaves the shop advertising a saving it may no
   * longer advertise.
   */
  it("stops showing the saving once the permit lapses, with no write in between", async () => {
    await setLicence("MOCI-2026-4471", future());
    await inventory.setProductStatus(adminActor(), ids.product, "published");

    const live = await catalog.getProductByHandle("sale-lamp");
    expect(live?.variants[0].compareAtPrice?.amount).toBe("25.000");

    // Time passes. Nothing is saved.
    await setLicence("MOCI-2026-4471", past());

    const later = await catalog.getProductByHandle("sale-lamp");
    expect(later?.variants[0].compareAtPrice).toBeNull();
    // The price itself does not move and the product is still for sale — an
    // expired permit stops the claim, not the trade.
    expect(later?.variants[0].price.amount).toBe("20.000");
    expect(later?.variants[0].availableForSale).toBe(true);
  });

  it("shows nothing struck through for a store that never had a permit", async () => {
    await setLicence("MOCI-2026-4471", future());
    await inventory.setProductStatus(adminActor(), ids.product, "published");
    await setLicence(null, null);

    const live = await catalog.getProductByHandle("sale-lamp");
    expect(live?.variants[0].compareAtPrice).toBeNull();
  });
});
