/**
 * The overview's sales figures, against a real Postgres: what counts as a
 * sale, and that a store reads its own lines and nothing of anybody else's.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, returnRequests, users, vendors } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let sales: typeof import("./salesSummary");
const ids = { acme: 0, other: 0, user: 0 };
const NOW = new Date("2026-10-12T07:00:00Z");
let sequence = 0;

async function sell(vendorId: number, total: string, options: {
  status?: "paid" | "cancelled";
  fulfilment?: "delivered" | "cancelled";
  at?: string;
} = {}) {
  const [order] = await db.insert(orders).values({
    reference: `NL-SALES-${++sequence}`, email: "s@example.test", status: options.status ?? "paid",
    placedAt: new Date(options.at ?? "2026-10-12T06:00:00Z"),
    itemsTotal: total, deliveryTotal: "0.000", grandTotal: total, commissionTotal: "0.000",
  }).returning();
  const [line] = await db.insert(orderItems).values({
    orderId: order.id, vendorId, vendorName: "Store", productTitle: `Thing ${sequence}`,
    unitPrice: total, quantity: 1, lineTotal: total, commissionAmount: "0.000", vendorNet: total,
    fulfilment: options.fulfilment ?? "delivered",
  }).returning();
  return { lineId: line.id, orderId: order.id };
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
  sales = await import("./salesSummary");

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  const [user] = await db.insert(users).values({ email: "shopper@netlet.test" }).returning();
  ids.acme = acme.id; ids.other = other.id; ids.user = user.id;

  const returned = await sell(ids.acme, "10.000");
  await sell(ids.acme, "5.000");
  await sell(ids.other, "100.000");
  /* None of these is a sale. */
  await sell(ids.acme, "50.000", { fulfilment: "cancelled" });
  await sell(ids.acme, "50.000", { status: "cancelled" });
  await sell(ids.acme, "0.000");
  await sell(ids.acme, "50.000", { at: "2026-08-01T06:00:00Z" });

  await db.insert(returnRequests).values({
    orderId: returned.orderId, orderItemId: returned.lineId, vendorId: ids.acme, userId: ids.user,
    kind: "refund", reason: "damaged", createdAt: new Date("2026-10-12T06:30:00Z"),
  });
}, 60_000);

describe("the overview's sales figures", () => {
  it("give an administrator the whole shop, sales only", async () => {
    const summary = await sales.salesSummary({ kind: "admin", userId: 1 }, NOW);
    expect(summary.periods.today).toMatchObject({ sales: "115.000", orders: 3, returns: 1 });
  });

  it("give a store's manager its own lines and nothing of anybody else's", async () => {
    const summary = await sales.salesSummary({ kind: "vendor", userId: 2, vendorId: ids.acme, role: "manager" }, NOW);
    expect(summary.periods.today).toEqual({ sales: "15.000", orders: 2, averageOrder: "7.500", returns: 1 });
    const theirs = await sales.salesSummary({ kind: "vendor", userId: 3, vendorId: ids.other, role: "owner" }, NOW);
    expect(theirs.periods.today).toMatchObject({ sales: "100.000", returns: 0 });
  });

  it("are refused to staff, who move stock and do not read takings", async () => {
    await expect(sales.salesSummary({ kind: "vendor", userId: 4, vendorId: ids.acme, role: "staff" }, NOW)).rejects.toThrow("FORBIDDEN");
  });
});
