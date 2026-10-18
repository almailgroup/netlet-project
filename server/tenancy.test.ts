/**
 * What one seller can reach of another's, against a real Postgres.
 *
 * The permission *rules* are proved pure in `Shared/inventory/permissions.test.ts`.
 * This is the half that cannot be: that the queries actually scope, for the
 * four modules that had no test file of their own and all four of which handle
 * money — payouts, vouchers, fraud and bundles.
 *
 * It exists because a guard that is present in the code and absent from the
 * WHERE clause reads identically at review, and the failure is silent: a page
 * that shows a competitor's revenue looks exactly like a page that works.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  bundleItems,
  bundles as bundlesTable,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
} from "../drizzle/schema.js";
import type { Actor } from "../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let payouts: typeof import("./payouts.js");
let vouchers: typeof import("./vouchers.js");
let fraud: typeof import("./fraud.js");
let bundles: typeof import("./bundles.js");

const ids = {
  admin: 0, shopper: 0, aOwner: 0, bOwner: 0,
  acme: 0, bolt: 0,
  acmeVariant: 0, boltVariant: 0,
  acmeBundle: 0, boltBundle: 0,
  acmeOrder: 0, boltOrder: 0,
};

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
  payouts = await import("./payouts.js");
  vouchers = await import("./vouchers.js");
  fraud = await import("./fraud.js");
  bundles = await import("./bundles.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [aOwner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [bOwner] = await db.insert(users).values({ email: "owner@bolt.test" }).returning();
  ids.admin = admin.id; ids.shopper = shopper.id; ids.aOwner = aOwner.id; ids.bOwner = bOwner.id;

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [bolt] = await db.insert(vendors).values({ slug: "bolt", name: "Bolt", status: "approved" }).returning();
  ids.acme = acme.id; ids.bolt = bolt.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: aOwner.id, role: "owner" },
    { vendorId: bolt.id, userId: bOwner.id, role: "owner" },
  ]);

  for (const [vendor, handle, sku, key] of [
    [acme.id, "acme-thing", "ACME-1", "acmeVariant"],
    [bolt.id, "bolt-thing", "BOLT-1", "boltVariant"],
  ] as const) {
    const [product] = await db.insert(products).values({ vendorId: vendor, handle, title: handle, status: "published" }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku, price: "10.000", stock: 50 }).returning();
    ids[key] = variant.id;
  }

  /* One paid order per seller, so each has money the other must not see. */
  for (const [vendor, name, reference, key] of [
    [acme.id, "Acme", "NL-20260101-AAAAA", "acmeOrder"],
    [bolt.id, "Bolt", "NL-20260101-BBBBB", "boltOrder"],
  ] as const) {
    const [order] = await db.insert(orders).values({
      reference, email: "shopper@example.test", userId: shopper.id, status: "paid",
      itemsTotal: "100.000", deliveryTotal: "0.000", grandTotal: "100.000", commissionTotal: "10.000",
      placedAt: new Date("2026-01-05T10:00:00Z"),
    }).returning();
    ids[key] = order.id;
    await db.insert(orderItems).values({
      orderId: order.id, vendorId: vendor, vendorName: name, productTitle: `${name} thing`,
      unitPrice: "100.000", quantity: 1, lineTotal: "100.000",
      commissionPercent: "10.00", commissionAmount: "10.000", vendorNet: "90.000",
    });
  }

  for (const [vendor, key] of [[acme.id, "acmeBundle"], [bolt.id, "boltBundle"]] as const) {
    const [bundle] = await db.insert(bundlesTable).values({ name: `${vendor} set`, vendorId: vendor, bundlePrice: "15.000" }).returning();
    ids[key] = bundle.id;
    await db.insert(bundleItems).values([
      { bundleId: bundle.id, variantId: ids.acmeVariant, quantity: 1, position: 0 },
      { bundleId: bundle.id, variantId: ids.boltVariant, quantity: 1, position: 1 },
    ]);
  }
}, 60_000);

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const acmeActor = (): Actor => ({ kind: "vendor", userId: ids.aOwner, vendorId: ids.acme, role: "owner" });
const boltActor = (): Actor => ({ kind: "vendor", userId: ids.bOwner, vendorId: ids.bolt, role: "owner" });
const shopperActor = (): Actor => ({ kind: "customer", userId: ids.shopper });
const courierActor = (): Actor => ({ kind: "courier", userId: ids.shopper, courierId: 1 });

describe("payouts", () => {
  it("shows a seller their own weeks and nobody else's", async () => {
    const mine = await payouts.payoutReport(acmeActor());
    expect(mine.vendors.map(v => v.vendorName)).toEqual(["Acme"]);

    const theirs = await payouts.payoutReport(boltActor());
    expect(theirs.vendors.map(v => v.vendorName)).toEqual(["Bolt"]);

    /* The figures are real, so "empty" is not why the leak did not happen. */
    expect(Number(mine.owed)).toBeGreaterThan(0);
  });

  it("shows an admin every seller", async () => {
    const all = await payouts.payoutReport(adminActor());
    expect(all.vendors.map(v => v.vendorName).sort()).toEqual(["Acme", "Bolt"]);
  });

  it("refuses a shopper and a delivery company outright", async () => {
    await expect(payouts.payoutReport(shopperActor())).rejects.toThrow("FORBIDDEN");
    await expect(payouts.payoutReport(courierActor())).rejects.toThrow("FORBIDDEN");
  });

  it("keeps the platform-licence roll to administrators", async () => {
    await expect(payouts.sellersUnderPlatformLicence(acmeActor())).rejects.toThrow("FORBIDDEN");
    await expect(payouts.sellersUnderPlatformLicence(shopperActor())).rejects.toThrow("FORBIDDEN");
  });

  /* The due list is a seller's own schedule, so they may read it — scoped. */
  it("shows a seller only their own obligations in the due list", async () => {
    const mine = await payouts.payoutDueList(acmeActor());
    expect(mine.length).toBeGreaterThan(0);
    expect([...new Set(mine.map(row => row.vendorId))]).toEqual([ids.acme]);

    const theirs = await payouts.payoutDueList(boltActor());
    expect([...new Set(theirs.map(row => row.vendorId))]).toEqual([ids.bolt]);

    const all = await payouts.payoutDueList(adminActor());
    expect(new Set(all.map(row => row.vendorId))).toEqual(new Set([ids.acme, ids.bolt]));

    await expect(payouts.payoutDueList(shopperActor())).rejects.toThrow("FORBIDDEN");
    await expect(payouts.payoutDueList(courierActor())).rejects.toThrow("FORBIDDEN");
  });
});

describe("vouchers", () => {
  it("is NetLet's money, so no seller writes one", async () => {
    await expect(vouchers.listVouchers(acmeActor())).rejects.toThrow("FORBIDDEN");
    await expect(vouchers.createGiftCard(acmeActor(), { code: "GIFT-1", amount: "10.000" })).rejects.toThrow("FORBIDDEN");
    await expect(vouchers.saveDiscountCode(acmeActor(), { code: "SAVE-1", kind: "percent", value: "10.00" })).rejects.toThrow("FORBIDDEN");
    await expect(vouchers.listVouchers(shopperActor())).rejects.toThrow("FORBIDDEN");
  });
});

describe("fraud signals", () => {
  it("reads an order's history, so only an administrator may ask", async () => {
    await expect(fraud.riskForOrders(acmeActor(), [ids.boltOrder])).rejects.toThrow("FORBIDDEN");
    await expect(fraud.riskForOrders(shopperActor(), [ids.acmeOrder])).rejects.toThrow("FORBIDDEN");
    const seen = await fraud.riskForOrders(adminActor(), [ids.acmeOrder]);
    expect(seen).toHaveLength(1);
  });
});

describe("bundles", () => {
  it("lists a seller only their own sets", async () => {
    const mine = await bundles.listBundles(acmeActor());
    expect(mine.map(b => b.id)).toEqual([ids.acmeBundle]);
    const theirs = await bundles.listBundles(boltActor());
    expect(theirs.map(b => b.id)).toEqual([ids.boltBundle]);
  });

  it("refuses a seller switching another's set on or off", async () => {
    await expect(bundles.setBundleActive(acmeActor(), ids.boltBundle, false)).rejects.toThrow();
    await expect(bundles.setBundleActive(shopperActor(), ids.acmeBundle, false)).rejects.toThrow();
  });

  it("refuses a seller editing another's set, and one that spans two shops", async () => {
    const members = [{ variantId: ids.acmeVariant, quantity: 1 }, { variantId: ids.boltVariant, quantity: 1 }];
    /* Their own store, but somebody else's goods inside it. */
    await expect(bundles.saveBundle(acmeActor(), {
      name: "Sneaky", vendorId: ids.acme, bundlePrice: "15.000", members,
    })).rejects.toThrow();
    /* A set with no store behind it is NetLet's to make, not a seller's. */
    await expect(bundles.saveBundle(acmeActor(), {
      name: "Platform", vendorId: null, bundlePrice: "15.000", members,
    })).rejects.toThrow("FORBIDDEN");
    /* And plainly: editing into another seller's store. */
    await expect(bundles.saveBundle(acmeActor(), {
      name: "Theirs", vendorId: ids.bolt, bundlePrice: "15.000", members,
    })).rejects.toThrow("FORBIDDEN");
  });

  /* Checked against the request alone, a seller sending another store's
     bundle id with their own store on it rewrote that bundle into theirs. */
  it("refuses a seller rewriting another store's bundle under their own name", async () => {
    const [product] = await db.insert(products).values({ vendorId: ids.acme, handle: "acme-second", title: "acme-second", status: "published" }).returning();
    const [second] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku: "ACME-2", price: "10.000", stock: 5 }).returning();
    const own = [{ variantId: ids.acmeVariant, quantity: 1 }, { variantId: second.id, quantity: 1 }];

    await expect(bundles.saveBundle(acmeActor(), {
      id: ids.boltBundle, name: "Mine now", vendorId: ids.acme, bundlePrice: "15.000", members: own,
    })).rejects.toThrow("FORBIDDEN");
    const [still] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, ids.boltBundle));
    expect(still.vendorId).toBe(ids.bolt);
    expect(still.name).not.toBe("Mine now");

    /* Their own bundle they may edit. */
    await expect(bundles.saveBundle(acmeActor(), {
      id: ids.acmeBundle, name: "Acme pair", vendorId: ids.acme, bundlePrice: "15.000", members: own,
    })).resolves.toEqual({ id: ids.acmeBundle });
  });

  it("gives a shopper no list at all rather than an error", async () => {
    expect(await bundles.listBundles(shopperActor())).toEqual([]);
  });
});
