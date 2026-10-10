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
import { categories, orderItems, orders, reviews, users, vendorMembers, vendors } from "../drizzle/schema.js";
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

  /* The preferences writes used to be stubbed here because they lived in
     `db.ts`; they are in `profile.ts` now and run against this database. */
  vi.doMock("./db", () => ({
    getDb: async () => db,
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
      id: (await caller.inventory.products.list({})).rows[0].id,
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

    await adminCaller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: ["verified"] });

    const shown = await shopper.commerce.products.byHandle({ handle });
    expect(shown.vendorBadges).toEqual(["verified"]);

    // And removing it removes it, rather than only ever adding.
    await adminCaller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: [] });
    expect((await shopper.commerce.products.byHandle({ handle })).vendorBadges).toEqual([]);

    /* The other two cannot be awarded at all: the schema refuses them. */
    await expect(adminCaller.inventory.vendors.setBadges({ vendorId: ids.vendor, badges: ["fastShipping" as "verified"] })).rejects.toThrow();
  });

  /*
   * "High Rating" and "Fast Shipping" are measured from the store's own
   * reviews and delivery times on every read, so a store shows them only once
   * its numbers say so — and four glowing reviews or four quick parcels are
   * not enough to say anything.
   */
  it("shows an earned badge only once the store's own numbers support it", async () => {
    const [{ id: shopperId }] = await db.insert(users).values({ openId: "badge-shopper", email: "badges@shop.test", name: "B" }).returning({ id: users.id });
    const deliver = async (n: number, hoursLater: number) => {
      const lineIds: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const placed = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const [order] = await db.insert(orders).values({ reference: `NL-BADGE-${Math.random().toString(36).slice(2, 10)}`, email: "badges@shop.test", userId: shopperId, itemsTotal: "5.000", grandTotal: "5.000", status: "paid", placedAt: placed }).returning({ id: orders.id });
        const [line] = await db.insert(orderItems).values({ orderId: order.id, vendorId: ids.vendor, productTitle: "Lamp", unitPrice: "5.000", quantity: 1, lineTotal: "5.000", fulfilment: "delivered", deliveredAt: new Date(placed.getTime() + hoursLater * 60 * 60 * 1000) }).returning({ id: orderItems.id });
        lineIds.push(line.id);
      }
      return lineIds;
    };
    const badges = async () => (await shopper.commerce.products.byHandle({ handle })).vendorBadges;

    const quick = await deliver(4, 30);
    for (const orderItemId of quick) await db.insert(reviews).values({ orderItemId, userId: shopperId, vendorId: ids.vendor, productTitle: "Lamp", rating: 5 });
    expect(await badges()).toEqual([]);

    /* A fifth of each, and both arrive. */
    const [fifth] = await deliver(1, 30);
    await db.insert(reviews).values({ orderItemId: fifth, userId: shopperId, vendorId: ids.vendor, productTitle: "Lamp", rating: 4 });
    expect(await badges()).toEqual(["highRating", "fastShipping"]);

    /* Two slow parcels take the share below four in five. */
    await deliver(2, 120);
    expect(await badges()).toEqual(["highRating"]);

    /* A review an administrator hid stops counting, which leaves four. */
    await db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.orderItemId, fifth));
    expect(await badges()).toEqual([]);
  });

  /*
   * Through the router rather than the data layer, because the interesting
   * part here is the schema: an empty optional field and a wrong one have to
   * be told apart, and `blankOr` is where that is decided.
   */
  it("opens a store, accepting blank details but refusing wrong ones", async () => {
    const [admin] = await db.select().from(users).where(eq(users.id, ids.admin));
    const adminCaller = appRouter.createCaller(contextFor(admin as User));

    const { vendor } = await adminCaller.inventory.vendors.create({
      name: "Router Store",
      slug: "router-store",
      contactPhone: "",
      payoutIban: "",
      governorate: "",
    });
    expect(vendor.slug).toBe("router-store");
    expect(vendor.payoutIban).toBeNull();

    await expect(adminCaller.inventory.vendors.create({
      name: "Bad IBAN Store",
      slug: "bad-iban-store",
      payoutIban: "KW81CBKU0000000000001234565001",
    })).rejects.toThrow();

    await expect(adminCaller.inventory.vendors.create({
      name: "Bad Slug Store",
      slug: "Bad Slug Store",
    })).rejects.toThrow();
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
    const listed = (await adminCaller.inventory.products.list({})).rows;
    expect(listed.some((row: any) => row.id === created.id)).toBe(true);
  });
});
