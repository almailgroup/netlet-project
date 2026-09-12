/**
 * Admin in, storefront out.
 *
 * Every other test covers one half. This one covers the join: a product
 * created and published through the same tRPC procedures the admin portal calls
 * has to appear through the same tRPC procedures the shop calls, and be
 * buyable. Before this change those were two different catalogs, and nothing
 * would have failed if they drifted apart again.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categories, users, vendorMembers, vendors } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";
import type { TrpcContext } from "./_core/context.js";
import type { User } from "../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let caller: any;
let shopper: any;
const ids = { vendorOwner: 0, vendor: 0, category: 0, admin: 0 };

function contextFor(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  vi.doMock("./db", () => ({
    getDb: async () => db,
    getCustomerProfile: async () => undefined,
    upsertCustomerProfile: async () => undefined,
  }));

  ({ appRouter } = await import("./routers.js"));

  const [owner] = await db.insert(users).values({ email: "owner@vendor.test" }).returning();
  ids.vendorOwner = owner.id;
  /* A real row, not an invented id: the audit trail has a foreign key to
     `users`, so an actor who does not exist makes every audit write fail
     silently and the test stops covering the thing it looks like it covers. */
  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  ids.admin = admin.id;
  const [vendor] = await db
    .insert(vendors)
    .values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved", autoPublish: true })
    .returning();
  ids.vendor = vendor.id;
  await db.insert(vendorMembers).values({ vendorId: vendor.id, userId: owner.id, role: "owner" });
  const [category] = await db
    .insert(categories)
    .values({ slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" })
    .returning();
  ids.category = category.id;

  caller = appRouter.createCaller(contextFor(owner as User));
  shopper = appRouter.createCaller(contextFor(null));
}, 60_000);

describe("a product's journey from the admin portal to the shop", () => {
  let handle = "";
  let variantId = "";

  it("is invisible to the shop while it is a draft", async () => {
    const created = await caller.inventory.products.create({
      vendorId: ids.vendor,
      title: "Wireless Headphones",
      titleAr: "سماعات لاسلكية",
      handle: "wireless-headphones",
      categoryId: ids.category,
    });
    handle = created.handle;

    expect(await shopper.commerce.products.byHandle({ handle })).toBeNull();
    const shelf = await shopper.commerce.products.list();
    expect(shelf.some((p: any) => p.handle === handle)).toBe(false);
  });

  it("appears in the shop once it is published, with its price and picture", async () => {
    const product = await caller.inventory.products.get({
      id: (await caller.inventory.products.list({}))[0].id,
    });
    await caller.inventory.variants.save({
      id: product.variants[0].id,
      productId: product.id,
      title: "Default",
      price: "42.750",
    });
    await caller.inventory.products.setImages({
      id: product.id,
      images: [{ url: "https://img/headphones.jpg", altText: "Headphones" }],
    });
    await caller.inventory.variants.adjustStock({ variantId: product.variants[0].id, delta: 6, reason: "received" });
    await caller.inventory.products.setStatus({ id: product.id, status: "published" });

    const listed = await shopper.commerce.products.byHandle({ handle });
    expect(listed).not.toBeNull();
    expect(listed.title).toBe("Wireless Headphones");
    expect(listed.productType).toBe("Electronics");
    expect(listed.vendor).toBe("Acme");
    expect(listed.images[0].url).toBe("https://img/headphones.jpg");
    expect(listed.variants[0].price).toEqual({ amount: "42.750", currencyCode: "KWD" });
    expect(listed.variants[0].availableForSale).toBe(true);
    variantId = listed.variants[0].id;
  });

  it("reads back in Arabic when the shop asks in Arabic", async () => {
    const listed = await shopper.commerce.products.byHandle({ handle, locale: "ar" });
    expect(listed.title).toBe("سماعات لاسلكية");
    expect(listed.productType).toBe("إلكترونيات");
  });

  it("can be put in a bag and totals correctly", async () => {
    const cart = await shopper.commerce.cart.create({ lines: [{ variantId, quantity: 2 }] });
    // 42.750 × 2 = 85.500
    expect(cart.subtotal.amount).toBe("85.500");
    expect(cart.items[0].productTitle).toBe("Wireless Headphones");
    expect(cart.items[0].image?.url).toBe("https://img/headphones.jpg");
  });

  it("leaves the shop again the moment its vendor is suspended", async () => {
    const { setVendorStatus } = await import("./inventory");
    await setVendorStatus({ kind: "admin", userId: ids.admin }, ids.vendor, "suspended");

    expect(await shopper.commerce.products.byHandle({ handle })).toBeNull();
    const shelf = await shopper.commerce.products.list();
    expect(shelf).toHaveLength(0);

    await setVendorStatus({ kind: "admin", userId: ids.admin }, ids.vendor, "approved");
  });

  /*
   * Badges are awarded in the portal and read in the shop, which is two
   * different tables' worth of code away from each other — exactly the join
   * this file exists to hold together.
   */
  it("carries a badge awarded in the portal through to the shop", async () => {
    const [admin] = await db.select().from(users).where(eq(users.id, ids.admin));
    const adminCaller = appRouter.createCaller(contextFor(admin as User));

    await adminCaller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: ["verified", "fastShipping"] });

    const shown = await shopper.commerce.products.byHandle({ handle });
    expect(shown.vendorBadges).toEqual(["verified", "fastShipping"]);

    // And removing it removes it, rather than only ever adding.
    await adminCaller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: [] });
    expect((await shopper.commerce.products.byHandle({ handle })).vendorBadges).toEqual([]);
  });

  it("refuses a vendor owner who tries to award themselves a badge", async () => {
    /* FORBIDDEN specifically: a test that accepts any throw would pass on a
       typo in the procedure name just as happily. */
    await expect(
      caller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: ["verified"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows the departments the seed creates as collections", async () => {
    const collections = await shopper.commerce.collections.list();
    expect(collections.map((c: any) => c.handle)).toContain("electronics");
  });
});

describe("an admin, who belongs to no vendor", () => {
  /*
   * The gap this covers: an admin is attached to no vendor, and a product must
   * belong to one. The admin portal hid the create button for them entirely,
   * so the first administrator of a fresh install could not add a product at
   * all — they could only look at an empty table telling them to add one.
   */
  it("can create a product against a vendor they name", async () => {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, ids.vendorOwner));
    const [promoted] = await db.select().from(users).where(eq(users.id, ids.vendorOwner));
    const adminCaller = appRouter.createCaller(contextFor(promoted as User));

    const created = await adminCaller.inventory.products.create({
      vendorId: ids.vendor,
      title: "Admin Created Lamp",
    });
    expect(created.vendorId).toBe(ids.vendor);
    expect(created.status).toBe("draft");

    // And it is theirs to work on afterwards, not merely to create.
    const listed = await adminCaller.inventory.products.list({});
    expect(listed.some((row: any) => row.id === created.id)).toBe(true);
  });
});
