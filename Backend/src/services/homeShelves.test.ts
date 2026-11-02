/**
 * Bestsellers counts what sold, Trending what was reached for this week, and
 * Shop by brand what the Brand filter would find — against a real Postgres.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cartItems, carts, orderItems, orders, products, productVariants, savedProducts, users, vendors, wishlistItems, wishlists } from "../../database/schema.js";

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
  const dir = path.resolve(import.meta.dirname, "../../database");
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

  /* This week's interest, for Trending: the kettle sold nothing that counts,
     and is the thing everybody picked up, hearted and wished for. */
  const daysAgo = (count: number) => new Date(Date.now() - count * 24 * 60 * 60 * 1000);
  const variantOf = async (handle: string) => (await db.select().from(productVariants).where(eq(productVariants.productId, product[handle])))[0].id;
  const [noura] = await db.insert(users).values({ email: "noura@example.test" }).returning();
  const [sara] = await db.insert(users).values({ email: "sara@example.test" }).returning();
  for (const [token, handle, at] of [["bag-this-week-1", "kettle", daysAgo(1)], ["bag-this-week-2", "charger", daysAgo(2)], ["bag-last-month-3", "kettle", daysAgo(10)]] as const) {
    await db.insert(carts).values({ id: token });
    await db.insert(cartItems).values({ cartId: token, variantId: await variantOf(handle), quantity: 3, createdAt: at });
  }
  await db.insert(savedProducts).values([
    { userId: noura.id, productId: String(product.kettle), createdAt: daysAgo(3) },
    { userId: sara.id, productId: String(product.kettle), createdAt: daysAgo(1) },
    /* Older than the window, and a heart for something that is not a row. */
    { userId: noura.id, productId: String(product.charger), createdAt: daysAgo(20) },
    { userId: sara.id, productId: "demo-handle", createdAt: daysAgo(1) },
  ]);
  const [list] = await db.insert(wishlists).values({ userId: noura.id, title: "Mine", shareToken: "share-trend-1" }).returning();
  await db.insert(wishlistItems).values({ wishlistId: list.id, productId: String(product.kettle), createdAt: daysAgo(2) });
}, 60_000);

describe("Bestsellers", () => {
  it("ranks by units sold and counts nothing that did not sell", async () => {
    const list = await shelves.listBestsellers();
    expect(list.map(entry => entry.handle)).toEqual(["watch", "phone", "charger"]);
  });
});

describe("Trending", () => {
  /* Sales ×3 by unit, bags ×2 by line, hearts ×2, wishes ×1, this week only:
     watch 9 (three units), kettle 2 + 2 + 2 + 1 = 7, phone 6, charger 3 + 2 =
     5. The kettle's old bag and the charger's old heart count nothing, and a
     heart for a demo handle names no row. The draft sold fifty and is not on
     the shelf. */
  it("weighs this week's sales, bags, hearts and wishes, and forgets last month", async () => {
    const list = await shelves.listTrending();
    expect(list.map(entry => entry.handle)).toEqual(["watch", "kettle", "phone", "charger"]);
  });

  it("answers more than a strip holds, so a department's tab is a shelf", () => {
    expect(shelves.HOME_SHELF_LIMIT).toBeGreaterThanOrEqual(48);
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
