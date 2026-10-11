/**
 * Moving a product between stores, and the store list's figures, against a
 * real Postgres.
 *
 * The move is checked by reading the tables afterwards: what follows the
 * product (its row, its stock), what stays with the store that sold it (order
 * lines), and what refuses it (an obligation the old store still carries).
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
  orderItems,
  orders,
  priceOffers,
  products,
  productVariants,
  users,
  vendorMembers,
  vendors,
} from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let mover: typeof import("./productMove");
let inv: typeof import("./inventory");

const ids = { admin: 0, owner: 0, shopper: 0, acme: 0, beta: 0, gamma: 0 };

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
  mover = await import("./productMove");
  inv = await import("./inventory");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [shopper] = await db.insert(users).values({ email: "noura@shop.test" }).returning();
  ids.admin = admin.id; ids.owner = owner.id; ids.shopper = shopper.id;
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", contactEmail: "hello@acme.test" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta Home", status: "approved" }).returning();
  const [gamma] = await db.insert(vendors).values({ slug: "gamma", name: "Gamma", status: "pending" }).returning();
  ids.acme = acme.id; ids.beta = beta.id; ids.gamma = gamma.id;
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: owner.id, role: "owner" });
}, 60_000);

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });

let serial = 0;
async function product(vendorId = ids.acme, sku: string | null = null, status: "draft" | "published" = "published") {
  serial += 1;
  const [row] = await db.insert(products).values({ vendorId, handle: `item-${serial}`, title: `Item ${serial}`, status }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", price: "10.000", stock: 4, sku }).returning();
  return { row, variant };
}

describe("who may move a product", () => {
  it("refuses a store owner, even for their own product", async () => {
    const { row } = await product();
    await expect(mover.moveProductToVendor(owner(), row.id, ids.beta)).rejects.toThrow("FORBIDDEN:product.reassign");
  });
});

describe("moving", () => {
  it("hands the product and its stock over, and leaves sold lines with the store that sold them", async () => {
    const { row, variant } = await product();
    const [order] = await db.insert(orders).values({
      reference: `NL-MOVE-${serial}`, userId: ids.shopper, email: "noura@shop.test", status: "paid",
      itemsTotal: "10.000", grandTotal: "10.000", currency: "KWD",
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, vendorId: ids.acme, vendorName: "Acme", productId: row.id, variantId: variant.id,
      productTitle: row.title, unitPrice: "10.000", quantity: 1, lineTotal: "10.000",
      commissionPercent: "10.00", commissionAmount: "1.000", vendorNet: "9.000",
    });

    const result = await mover.moveProductToVendor(admin(), row.id, ids.beta);
    expect(result).toMatchObject({ from: { id: ids.acme, name: "Acme" }, to: { id: ids.beta, name: "Beta Home" } });

    const [after] = await db.select().from(products).where(eq(products.id, row.id));
    expect(after.vendorId).toBe(ids.beta);
    const [stock] = await db.select().from(productVariants).where(eq(productVariants.id, variant.id));
    expect(stock.stock).toBe(4);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(line).toMatchObject({ vendorId: ids.acme, vendorNet: "9.000" });

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.subjectId, row.id));
    expect(audit).toMatchObject({ action: "product.move", vendorId: ids.beta });
  });

  it("takes the old store's own bundle off the shop, and leaves NetLet's alone", async () => {
    const { row, variant } = await product();
    const other = await product();
    const [own] = await db.insert(bundles).values({ name: "Acme pair", vendorId: ids.acme, bundlePrice: "18.000" }).returning();
    const [house] = await db.insert(bundles).values({ name: "NetLet set", vendorId: null, bundlePrice: "18.000" }).returning();
    await db.insert(bundleItems).values([
      { bundleId: own.id, variantId: variant.id }, { bundleId: own.id, variantId: other.variant.id },
      { bundleId: house.id, variantId: variant.id }, { bundleId: house.id, variantId: other.variant.id },
    ]);

    const result = await mover.moveProductToVendor(admin(), row.id, ids.beta);
    expect(result.bundlesWithdrawn).toBe(1);
    expect((await db.select().from(bundles).where(eq(bundles.id, own.id)))[0].active).toBe(false);
    expect((await db.select().from(bundles).where(eq(bundles.id, house.id)))[0].active).toBe(true);
  });
});

describe("what refuses a move", () => {
  it("refuses the store it is already in", async () => {
    const { row } = await product();
    await expect(mover.moveProductToVendor(admin(), row.id, ids.acme)).rejects.toThrow("admin.moveSameStore");
  });

  it("refuses a code the new store already uses, as typing it would", async () => {
    await product(ids.beta, "LAMP-1");
    const { row } = await product(ids.acme, "LAMP-1");
    await expect(mover.moveProductToVendor(admin(), row.id, ids.beta)).rejects.toThrow("admin.skuTaken");
    expect((await db.select().from(products).where(eq(products.id, row.id)))[0].vendorId).toBe(ids.acme);
  });

  it("refuses while a placement booked by the old store is running", async () => {
    const { row } = await product();
    await db.insert(adBookings).values({
      vendorId: ids.acme, productId: row.id, productTitle: row.title, slot: "home",
      startsOn: "2026-10-10", endsOn: "2026-10-20", dailyRate: "2.000", total: "22.000",
    });
    await expect(mover.moveProductToVendor(admin(), row.id, ids.beta, new Date("2026-10-11T09:00:00Z"))).rejects.toThrow("admin.moveBlockedAd");
  });

  it("refuses while a shopper holds a price the old store agreed, and not once it is used", async () => {
    const { row, variant } = await product();
    const [offer] = await db.insert(priceOffers).values({
      userId: ids.shopper, variantId: variant.id, productId: row.id, vendorId: ids.acme, productTitle: row.title,
      listPrice: "10.000", askedPrice: "8.000", status: "offered", offeredPrice: "8.500",
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    await expect(mover.moveProductToVendor(admin(), row.id, ids.beta)).rejects.toThrow("admin.moveBlockedOffer");

    await db.update(priceOffers).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(priceOffers.id, offer.id));
    await expect(mover.moveProductToVendor(admin(), row.id, ids.beta)).resolves.toMatchObject({ to: { id: ids.beta } });
  });
});

describe("the store list", () => {
  it("counts each store's shelf and team, and filters by status and by search on the server", async () => {
    await product(ids.gamma, null, "draft");
    const all = await inv.listVendors(admin(), {});
    const acme = all.rows.find(row => row.id === ids.acme)!;
    expect(acme.memberCount).toBe(1);
    expect(acme.productCount).toBeGreaterThan(0);
    expect(acme.liveCount).toBe(acme.productCount);
    expect(all.counts).toMatchObject({ all: 3, approved: 2, pending: 1, suspended: 0 });

    const pending = await inv.listVendors(admin(), { status: "pending" });
    expect(pending.rows.map(row => row.slug)).toEqual(["gamma"]);
    expect(pending.rows[0]).toMatchObject({ productCount: 1, liveCount: 0, memberCount: 0 });

    const byEmail = await inv.listVendors(admin(), { query: "HELLO@acme" });
    expect(byEmail.rows.map(row => row.slug)).toEqual(["acme"]);
  });

  it("gives a store's page its figures", async () => {
    const store = await inv.getVendor(admin(), ids.gamma);
    expect(store?.stats).toMatchObject({ products: 1, live: 0, drafts: 1, inReview: 0, members: 0 });
  });

  it("switches publishing without review, admin only, and records it", async () => {
    await expect(inv.setVendorAutoPublish(owner(), ids.acme, true)).rejects.toThrow("FORBIDDEN:product.review");
    const updated = await inv.setVendorAutoPublish(admin(), ids.acme, true);
    expect(updated.autoPublish).toBe(true);
    const rows = await db.select().from(auditLog).where(eq(auditLog.subjectId, ids.acme));
    expect(rows.some(row => row.action === "vendor.update" && (row.after as { autoPublish?: boolean }).autoPublish === true)).toBe(true);
  });
});

describe("a store's owners", () => {
  it("refuses demoting or removing the last one, and allows it once there is another", async () => {
    await expect(inv.removeMember(owner(), ids.acme, ids.owner)).rejects.toThrow("admin.lastOwner");
    await expect(inv.setMemberRole(owner(), ids.acme, ids.owner, "manager")).rejects.toThrow("admin.lastOwner");
    await expect(inv.setMemberRole(admin(), ids.acme, ids.owner, "manager")).rejects.toThrow("admin.lastOwner");
    const [still] = await db.select().from(vendorMembers).where(eq(vendorMembers.userId, ids.owner));
    expect(still.role).toBe("owner");

    await inv.setMemberRole(admin(), ids.acme, ids.shopper, "owner");
    await inv.setMemberRole(owner(), ids.acme, ids.owner, "manager");
    await expect(inv.removeMember(admin(), ids.acme, ids.shopper)).rejects.toThrow("admin.lastOwner");

    await inv.setMemberRole(admin(), ids.acme, ids.owner, "owner");
    await inv.removeMember(admin(), ids.acme, ids.shopper);
    const left = await db.select().from(vendorMembers).where(eq(vendorMembers.vendorId, ids.acme));
    expect(left.map(row => [row.userId, row.role])).toEqual([[ids.owner, "owner"]]);
  });
});

describe("the store's team, from either door", () => {
  it("refuses demoting the only owner through the administrator's add-by-address, and removing them", async () => {
    await expect(inv.addMemberByEmail(admin(), ids.acme, "owner@acme.test", "staff")).rejects.toThrow("admin.lastOwner");
    await expect(inv.removeMemberAsAdmin(admin(), ids.acme, ids.owner)).rejects.toThrow("admin.lastOwner");
  });

  it("records an owner's own changes to their team in the trail", async () => {
    await inv.setMemberRole(owner(), ids.acme, ids.shopper, "staff");
    await inv.setMemberRole(owner(), ids.acme, ids.shopper, "manager");
    await inv.removeMember(owner(), ids.acme, ids.shopper);
    /* The last three: the owners test above already moved this shopper in and out once. */
    const rows = (await db.select().from(auditLog).where(eq(auditLog.subjectId, ids.shopper)).orderBy(auditLog.id))
      .filter(row => row.vendorId === ids.acme && row.action.startsWith("vendor."))
      .slice(-3);
    expect(rows.map(row => [row.action, (row.before as { role?: string } | null)?.role ?? null, (row.after as { role?: string } | null)?.role ?? null])).toEqual([
      ["vendor.addMember", null, "staff"],
      ["vendor.addMember", "staff", "manager"],
      ["vendor.removeMember", "manager", null],
    ]);
    expect(rows[0].subjectLabel).toBe("noura@shop.test");
  });
});

