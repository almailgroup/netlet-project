/**
 * The dashboard and the reorder point, against a real Postgres: what counts
 * as a sale, which department it is, the shelf's health, who sees what, and
 * that a reorder point is set by the store that owns the shelf and recorded.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auditLog, categories, orderItems, orders, products, productVariants, users, vendors } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let board: typeof import("./dashboard");
let inventory: typeof import("./inventory");
const ids = { acme: 0, other: 0, shopper: 0, lamp: 0, lampVariant: 0, soap: 0, soapVariant: 0, theirs: 0 };
/* A Monday, 10am in Kuwait. */
const NOW = new Date("2026-10-12T07:00:00Z");
let sequence = 0;

async function sell(vendorId: number, productId: number | null, variantId: number | null, total: string, options: {
  at?: string;
  buyer?: number | null;
  quantity?: number;
  status?: "paid" | "cancelled";
  fulfilment?: "delivered" | "cancelled";
} = {}) {
  const [order] = await db.insert(orders).values({
    reference: `NL-DASH-${++sequence}`, email: "d@example.test", status: options.status ?? "paid",
    userId: options.buyer === undefined ? ids.shopper : options.buyer,
    placedAt: new Date(options.at ?? "2026-10-12T06:00:00Z"),
    itemsTotal: total, deliveryTotal: "0.000", grandTotal: total, commissionTotal: "0.000",
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, vendorId, productId, variantId, vendorName: "Store", productTitle: `Thing ${sequence}`,
    unitPrice: total, quantity: options.quantity ?? 1, lineTotal: total, commissionAmount: "0.000", vendorNet: total,
    fulfilment: options.fulfilment ?? "delivered",
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", () => ({ getDb: async () => db }));
  board = await import("./dashboard");
  inventory = await import("./inventory");

  const [electronics] = await db.insert(categories).values({ slug: "electronics", name: "Electronics" }).returning();
  const [beauty] = await db.insert(categories).values({ slug: "beauty", name: "Beauty" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@netlet.test", createdAt: new Date("2026-10-12T05:00:00Z") }).returning();
  await db.insert(users).values({ email: "old@netlet.test", createdAt: new Date("2026-01-01T05:00:00Z") });
  ids.acme = acme.id; ids.other = other.id; ids.shopper = shopper.id;

  const [lamp] = await db.insert(products).values({ vendorId: acme.id, categoryId: electronics.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [soap] = await db.insert(products).values({ vendorId: acme.id, categoryId: beauty.id, handle: "soap", title: "Soap", status: "published" }).returning();
  const [theirs] = await db.insert(products).values({ vendorId: other.id, handle: "theirs", title: "Theirs", status: "published" }).returning();
  const [draft] = await db.insert(products).values({ vendorId: acme.id, handle: "draft", title: "Draft", status: "draft" }).returning();
  ids.lamp = lamp.id; ids.soap = soap.id; ids.theirs = theirs.id;
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, price: "10.000", stock: 3, lowStockAt: 5 }).returning();
  const [soapVariant] = await db.insert(productVariants).values({ productId: soap.id, price: "2.000", stock: 40 }).returning();
  await db.insert(productVariants).values({ productId: soap.id, title: "Big", price: "4.000", stock: 0, preorderStock: 10 });
  await db.insert(productVariants).values({ productId: theirs.id, price: "1.000", stock: 0 });
  /* A draft is no shelf a shopper sees. */
  await db.insert(productVariants).values({ productId: draft.id, price: "1.000", stock: 0 });
  ids.lampVariant = lampVariant.id; ids.soapVariant = soapVariant.id;

  await sell(acme.id, lamp.id, lampVariant.id, "30.000", { quantity: 3 });
  await sell(acme.id, soap.id, soapVariant.id, "10.000", { at: "2026-10-10T06:00:00Z" });
  await sell(other.id, theirs.id, null, "100.000", { buyer: null });
  /* The week before. */
  await sell(acme.id, lamp.id, lampVariant.id, "20.000", { at: "2026-10-03T06:00:00Z", quantity: 2 });
  /* None of these is a sale. */
  await sell(acme.id, lamp.id, lampVariant.id, "50.000", { fulfilment: "cancelled" });
  await sell(acme.id, lamp.id, lampVariant.id, "50.000", { status: "cancelled" });
  await sell(acme.id, lamp.id, lampVariant.id, "0.000");
}, 60_000);

describe("the dashboard", () => {
  it("gives an administrator the whole shop, by department, with the shelf and who joined", async () => {
    const view = await board.dashboard({ kind: "admin", userId: 1 }, 7, NOW);
    expect(view.totals.sales).toEqual({ current: "140.000", previous: "20.000", change: 600 });
    expect(view.totals.orders.current).toBe(3);
    /* The shopper twice and one order with no account. */
    expect(view.totals.customers.current).toBe(2);
    expect(view.departments).toEqual([
      { slug: null, sales: "100.000", percent: 72 },
      { slug: "electronics", sales: "30.000", percent: 21 },
      { slug: "beauty", sales: "10.000", percent: 7 },
    ]);
    expect(view.stock).toEqual({ healthy: 1, low: 1, out: 1, preorder: 1 });
    expect(view.newAccounts?.at(-1)).toEqual({ day: "2026-10-12", count: 1 });
  });

  it("gives a store's manager its own lines and shelf, and nobody's accounts", async () => {
    const view = await board.dashboard({ kind: "vendor", userId: 2, vendorId: ids.acme, role: "manager" }, 7, NOW);
    expect(view.totals.sales.current).toBe("40.000");
    expect(view.departments.map(entry => entry.slug)).toEqual(["electronics", "beauty"]);
    expect(view.stock).toEqual({ healthy: 1, low: 1, out: 0, preorder: 1 });
    expect(view.newAccounts).toBeNull();
  });

  it("is not a staff member's to read", async () => {
    await expect(board.dashboard({ kind: "vendor", userId: 3, vendorId: ids.acme, role: "staff" }, 7, NOW)).rejects.toThrow(/FORBIDDEN/);
  });

  it("counts what each variant sold lately, for the store's own lines", async () => {
    const sold = await board.unitsSoldLately({ kind: "vendor", userId: 2, vendorId: ids.acme, role: "staff" }, [ids.lampVariant, ids.soapVariant], NOW);
    expect(sold.get(ids.lampVariant)).toBe(5);
    expect(sold.get(ids.soapVariant)).toBe(1);
  });
});

describe("the reorder point", () => {
  it("is set by the store that owns the shelf, and is on the trail", async () => {
    const staff = { kind: "vendor" as const, userId: 2, vendorId: ids.acme, role: "staff" as const };
    await expect(inventory.setReorderPoint(staff, ids.soapVariant, 45)).resolves.toEqual({ variantId: ids.soapVariant, lowStockAt: 45 });
    const [row] = await db.select().from(productVariants).where(eq(productVariants.id, ids.soapVariant));
    expect(row.lowStockAt).toBe(45);
    const trail = await db.select().from(auditLog).where(eq(auditLog.action, "stock.setReorderPoint"));
    expect(trail).toHaveLength(1);
    expect(trail[0].before).toEqual({ lowStockAt: null });

    /* It is now low, and the stock page says what it sold lately. */
    const low = await inventory.lowStock(staff);
    const soap = low.rows.find(entry => entry.variantId === ids.soapVariant);
    expect(soap).toMatchObject({ stock: 40, lowStockAt: 45, preorderStock: 0 });
    expect(typeof soap?.soldLately).toBe("number");

    await inventory.setReorderPoint(staff, ids.soapVariant, null);
    const [cleared] = await db.select().from(productVariants).where(eq(productVariants.id, ids.soapVariant));
    expect(cleared.lowStockAt).toBeNull();
  });

  it("is refused for another store's shelf and for a level that is not one", async () => {
    const theirs = { kind: "vendor" as const, userId: 4, vendorId: ids.other, role: "owner" as const };
    await expect(inventory.setReorderPoint(theirs, ids.lampVariant, 3)).rejects.toThrow(/FORBIDDEN/);
    await expect(inventory.setReorderPoint({ kind: "admin", userId: 1 }, ids.lampVariant, -1)).rejects.toThrow("admin.badReorderPoint");
    await expect(inventory.setReorderPoint({ kind: "admin", userId: 1 }, ids.lampVariant, 2.5)).rejects.toThrow("admin.badReorderPoint");
  });
});
