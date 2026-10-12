/**
 * Bestsellers counts what sold, and Shop by brand counts what the Brand
 * filter would find — against a real Postgres.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, products, productVariants, vendors } from "../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let shelves: typeof import("./homeShelves");
const product: Record<string, number> = {};
let vendorId = 0;

async function makeProduct(handle: string, options: { status?: "published" | "draft"; brand?: string } = {}) {
  const [row] = await db.insert(products).values({
    vendorId, handle, title: handle, status: options.status ?? "published",
    attributes: options.brand ? [{ namespace: "specs", key: "brand", label: "Brand", value: options.brand }] : [],
  }).returning();
  await db.insert(productVariants).values({ productId: row.id, title: "Default", price: "5.000", stock: 10 });
  product[handle] = row.id;
}

let sequence = 0;
async function sell(handle: string, quantity: number, options: {
  status?: "pending_payment" | "paid" | "cancelled" | "refunded";
  fulfilment?: "pending" | "delivered" | "cancelled" | "returned";
  lineTotal?: string;
  daysAgo?: number;
} = {}) {
  const placedAt = new Date(Date.now() - (options.daysAgo ?? 1) * 24 * 60 * 60 * 1000);
  const [order] = await db.insert(orders).values({
    reference: `NL-SHELF-${++sequence}`, email: "s@example.test", status: options.status ?? "paid", placedAt,
    itemsTotal: "0.000", deliveryTotal: "0.000", grandTotal: "0.000", commissionTotal: "0.000",
  }).returning();
  const lineTotal = options.lineTotal ?? "5.000";
  await db.insert(orderItems).values({
    orderId: order.id, productId: product[handle], vendorId, vendorName: "Acme", productTitle: handle,
    unitPrice: lineTotal, quantity, lineTotal, commissionAmount: "0.000", vendorNet: lineTotal,
    fulfilment: options.fulfilment ?? "delivered",
  });
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
  vi.doMock("./db", () => ({ getDb: async () => db }));
  shelves = await import("./homeShelves");

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  vendorId = acme.id;
  await makeProduct("watch", { brand: "Samsung" });
  await makeProduct("phone", { brand: "Samsung" });
  await makeProduct("charger", { brand: "Anker" });
  await makeProduct("kettle");
  await makeProduct("draft-thing", { status: "draft", brand: "Samsung" });

  await sell("watch", 2);
  await sell("watch", 1);
  await sell("phone", 2);
  await sell("charger", 1);
  /* None of these is a sale. */
  await sell("kettle", 9, { fulfilment: "cancelled" });
  await sell("kettle", 9, { fulfilment: "returned" });
  await sell("kettle", 9, { status: "cancelled" });
  await sell("kettle", 9, { lineTotal: "0.000" });
  await sell("kettle", 9, { daysAgo: 120 });
  /* Sold, but no longer on the shelf. */
  await sell("draft-thing", 50);
}, 60_000);

describe("Bestsellers", () => {
  it("ranks by units sold and counts nothing that did not sell", async () => {
    const list = await shelves.listBestsellers();
    expect(list.map(entry => entry.handle)).toEqual(["watch", "phone", "charger"]);
  });
});

describe("Shop by brand", () => {
  it("counts the Brand rows of what is on the shelf", async () => {
    expect(await shelves.listBrands()).toEqual([
      { name: "Samsung", count: 2 },
      { name: "Anker", count: 1 },
    ]);
  });
});
