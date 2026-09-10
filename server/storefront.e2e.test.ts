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
import { categories, users, vendorMembers, vendors } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

let db: ReturnType<typeof drizzle>;
let caller: any;
let shopper: any;
const ids = { vendorOwner: 0, vendor: 0, category: 0 };

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

  const { appRouter } = await import("./routers");

  const [owner] = await db.insert(users).values({ email: "owner@vendor.test" }).returning();
  ids.vendorOwner = owner.id;
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
    await setVendorStatus({ kind: "admin", userId: 999 }, ids.vendor, "suspended");

    expect(await shopper.commerce.products.byHandle({ handle })).toBeNull();
    const shelf = await shopper.commerce.products.list();
    expect(shelf).toHaveLength(0);

    await setVendorStatus({ kind: "admin", userId: 999 }, ids.vendor, "approved");
  });

  it("shows the departments the seed creates as collections", async () => {
    const collections = await shopper.commerce.collections.list();
    expect(collections.map((c: any) => c.handle)).toContain("electronics");
  });
});
