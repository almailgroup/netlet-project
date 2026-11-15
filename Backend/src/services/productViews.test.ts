/**
 * Product views (migration 0084) against a real Postgres: a guest's opening
 * counts a view and, once a day, a visitor; a draft, a suspended store's
 * product, the store's own team, NetLet's staff and an administrator are not
 * counted; a store reads its own products and not another's; the report holds
 * the orders and carts beside the views; and before the migration is pasted
 * nothing is counted and the report says it is not ready.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  orderItems,
  orders,
  productVariants,
  productViews,
  products,
  staffGrants,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import { kuwaitDay } from "../../../Shared/kuwaitDay.js";

let db: ReturnType<typeof drizzle>;
let views: typeof import("./productViews.js");

const ids = { shopper: 0, member: 0, granted: 0, admin: 0, acme: 0, other: 0, lamp: 0, lampBlack: 0, tea: 0, draft: 0, rival: 0, suspended: 0 };
const NOW = new Date("2026-11-15T09:00:00Z");
const guest = { userId: null, admin: false };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  views = await import("./productViews.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [member] = await db.insert(users).values({ email: "member@example.test" }).returning();
  const [granted] = await db.insert(users).values({ email: "granted@example.test" }).returning();
  const [admin] = await db.insert(users).values({ email: "admin@example.test", role: "admin" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  const [closed] = await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended" }).returning();
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: member.id, role: "staff" });
  await db.insert(staffGrants).values({ userId: granted.id, capability: "vendor.setCommission" });
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [lampBlack] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "20.000", stock: 5 }).returning();
  const [tea] = await db.insert(products).values({ vendorId: acme.id, handle: "tea", title: "Green tea", status: "published" }).returning();
  const [draft] = await db.insert(products).values({ vendorId: acme.id, handle: "draft", title: "Not yet", status: "draft" }).returning();
  const [rival] = await db.insert(products).values({ vendorId: other.id, handle: "rival", title: "Rival lamp", status: "published" }).returning();
  const [suspended] = await db.insert(products).values({ vendorId: closed.id, handle: "gone", title: "Gone", status: "published" }).returning();
  Object.assign(ids, {
    shopper: shopper.id, member: member.id, granted: granted.id, admin: admin.id, acme: acme.id, other: other.id,
    lamp: lamp.id, lampBlack: lampBlack.id, tea: tea.id, draft: draft.id, rival: rival.id, suspended: suspended.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(productViews);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(orderItems);
  await db.delete(orders);
});

const open = (productId: number, viewer: { userId: number | null; admin: boolean } = guest, extra: Partial<{ channel: "app" | "web_phone" | "web_computer"; source: "home" | "search" | "outside"; firstToday: boolean }> = {}) =>
  views.recordProductView({ productId, channel: extra.channel ?? "web_phone", source: extra.source ?? "home", firstToday: extra.firstToday ?? true }, viewer, NOW);

const store = (vendorId: number): Actor => ({ kind: "vendor", userId: ids.member, vendorId, role: "manager" } as Actor);

describe("counting a view", () => {
  it("counts a view and, once a day, a visitor", async () => {
    expect(await open(ids.lamp)).toEqual({ counted: true });
    expect(await open(ids.lamp, guest, { firstToday: false })).toEqual({ counted: true });
    const rows = await db.select().from(productViews);
    expect(rows).toEqual([{ productId: ids.lamp, day: kuwaitDay(NOW), channel: "web_phone", source: "home", views: 2, visitors: 1 }]);
  });

  it("keeps a row per channel and source", async () => {
    await open(ids.lamp, guest, { channel: "app" });
    await open(ids.lamp, guest, { channel: "app", source: "search" });
    await open(ids.lamp, { userId: ids.shopper, admin: false }, { channel: "web_computer" });
    expect(await db.select({ count: sql<number>`count(*)::int` }).from(productViews)).toEqual([{ count: 3 }]);
  });

  it("does not count what the shop does not show", async () => {
    expect(await open(ids.draft)).toEqual({ counted: false });
    expect(await open(ids.suspended)).toEqual({ counted: false });
    expect(await open(999_999)).toEqual({ counted: false });
  });

  it("does not count the store's own team, NetLet's staff or an administrator", async () => {
    expect(await open(ids.lamp, { userId: ids.member, admin: false })).toEqual({ counted: false });
    expect(await open(ids.lamp, { userId: ids.granted, admin: false })).toEqual({ counted: false });
    /* An administrator read as a shopper by the session (an unauthorised device) is still staff. */
    expect(await open(ids.lamp, { userId: ids.admin, admin: false })).toEqual({ counted: false });
    expect(await open(ids.lamp, { userId: ids.admin, admin: true })).toEqual({ counted: false });
    /* The store's member looking at another store's product is a shopper there. */
    expect(await open(ids.rival, { userId: ids.member, admin: false })).toEqual({ counted: true });
  });
});

describe("the store's report", () => {
  it("holds the views, the visitors, the orders and the carts", async () => {
    await open(ids.lamp, guest, { channel: "app" });
    await open(ids.lamp, guest, { channel: "app", firstToday: false });
    await open(ids.lamp, guest, { channel: "web_computer", source: "search" });
    await open(ids.rival);
    const [order] = await db.insert(orders).values({
      reference: "NL-20261115-VIEWA", userId: ids.shopper, email: "x@example.test", status: "paid",
      itemsTotal: "40.000", grandTotal: "40.000", placedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, vendorId: ids.acme, productId: ids.lamp, variantId: ids.lampBlack, vendorName: "Acme",
      productTitle: "Desk Lamp", unitPrice: "20.000", quantity: 2, lineTotal: "40.000", fulfilment: "pending",
    });
    await db.insert(carts).values({ id: "cart-view-test" });
    await db.insert(cartItems).values({ cartId: "cart-view-test", variantId: ids.lampBlack, quantity: 1 });

    const report = await views.productViewsReport(store(ids.acme), { range: 7 }, NOW);
    expect(report.ready).toBe(true);
    expect(report.totals.views.current).toBe(3);
    expect(report.totals.visitors.current).toBe(2);
    expect(report.totals.orders.current).toBe(1);
    expect(report.channels.map(row => [row.channel, row.views])).toEqual([["app", 2], ["web_phone", 0], ["web_computer", 1]]);
    expect(report.sources.map(row => [row.source, row.views])).toEqual([["home", 2], ["search", 1]]);
    /* The rival's view is not this store's; the tea nobody opened is listed. */
    expect(report.products.map(row => row.productId)).toEqual([ids.lamp, ids.tea]);
    expect(report.products[0]).toMatchObject({ views: 3, visitors: 2, units: 2, orders: 1, inCarts: 1, vendorName: null });
    expect(report.products[1]).toMatchObject({ views: 0, demand: "unseen" });
    expect(report.productCount).toBe(2);
  });

  it("reads one product for its editor, and never another store's", async () => {
    await open(ids.lamp);
    await open(ids.rival);
    const lamp = await views.productViewsReport(store(ids.acme), { range: 30, productId: ids.lamp }, NOW);
    expect(lamp.products.map(row => row.productId)).toEqual([ids.lamp]);
    expect(lamp.totals.views.current).toBe(1);
    await expect(views.productViewsReport(store(ids.acme), { range: 30, productId: ids.rival }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    /* Asking for another store's report reads the asker's own store. */
    const own = await views.productViewsReport(store(ids.acme), { range: 30, vendorId: ids.other }, NOW);
    expect(own.products.map(row => row.productId)).not.toContain(ids.rival);
  });

  it("lets an administrator read every store, naming each", async () => {
    await open(ids.lamp);
    await open(ids.rival);
    const all = await views.productViewsReport({ kind: "admin", userId: ids.admin }, { range: 7 }, NOW);
    expect(all.totals.views.current).toBe(2);
    expect(all.products.find(row => row.productId === ids.rival)?.vendorName).toBe("Other");
    const one = await views.productViewsReport({ kind: "admin", userId: ids.admin }, { range: 7, vendorId: ids.other }, NOW);
    expect(one.products.map(row => row.productId)).toEqual([ids.rival]);
  });

  it("refuses somebody who is not in a store", async () => {
    await expect(views.productViewsReport({ kind: "customer", userId: ids.shopper } as unknown as Actor, { range: 7 }, NOW)).rejects.toBeTruthy();
  });

  it("counts the period before apart from this one", async () => {
    const earlier = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    await views.recordProductView({ productId: ids.lamp, channel: "app", source: "home", firstToday: true }, guest, earlier);
    await open(ids.lamp);
    const report = await views.productViewsReport(store(ids.acme), { range: 7 }, NOW);
    expect(report.totals.views).toEqual({ current: 1, previous: 1, change: 0 });
    expect(report.products[0]).toMatchObject({ views: 1, previousViews: 1 });
  });
});

describe("before migration 0084 is pasted", () => {
  it("counts nothing and says the report is not ready", async () => {
    await db.execute(sql`alter table product_views rename to product_views_away`);
    try {
      expect(await open(ids.lamp)).toEqual({ counted: false });
      const report = await views.productViewsReport(store(ids.acme), { range: 7 }, NOW);
      expect(report.ready).toBe(false);
      expect(report.products).toEqual([]);
    } finally {
      await db.execute(sql`alter table product_views_away rename to product_views`);
    }
  });
});
