/**
 * The home page's "Stores on NetLet" row, against a real Postgres: a store is
 * on it only while it is approved and has something published, the busiest
 * first with ties settled by id, its name in the page's language, and a rating
 * only from five visible reviews up.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, products, productVariants, reviews, users, vendors } from "../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let catalog: typeof import("./catalog");

let sequence = 0;
async function store(slug: string, options: { nameAr?: string; status?: "approved" | "suspended" | "pending" } = {}) {
  const [row] = await db.insert(vendors).values({ slug, name: slug.toUpperCase(), nameAr: options.nameAr, status: options.status ?? "approved" }).returning();
  return row.id;
}
async function shelve(vendorId: number, count: number, status: "published" | "draft" = "published") {
  for (let index = 0; index < count; index++) {
    const [row] = await db.insert(products).values({ vendorId, handle: `p-${++sequence}`, title: `Product ${sequence}`, status }).returning();
    await db.insert(productVariants).values({ productId: row.id, title: "Default", price: "5.000", stock: 10 });
  }
}
async function review(vendorId: number, userId: number, rating: number, hidden = false) {
  const [order] = await db.insert(orders).values({
    reference: `NL-STORE-${++sequence}`, email: "s@example.test", status: "paid",
    itemsTotal: "5.000", deliveryTotal: "0.000", grandTotal: "5.000", commissionTotal: "0.000",
  }).returning();
  const [line] = await db.insert(orderItems).values({
    orderId: order.id, vendorId, vendorName: "Store", productTitle: "Thing",
    unitPrice: "5.000", quantity: 1, lineTotal: "5.000", commissionAmount: "0.000", vendorNet: "5.000", fulfilment: "delivered",
  }).returning();
  await db.insert(reviews).values({ orderItemId: line.id, userId, vendorId, productTitle: "Thing", rating, ...(hidden ? { hiddenAt: new Date() } : {}) });
}

const ids: Record<string, number> = {};

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
  catalog = await import("./catalog");

  const [shopper] = await db.insert(users).values({ email: "shopper@netlet.test", name: "Shopper" }).returning();

  ids.busy = await store("busy", { nameAr: "المزدحم" });
  await shelve(ids.busy, 4);
  await shelve(ids.busy, 3, "draft");
  /* Two stores with the same count: the one made first comes first, every time. */
  ids.tieA = await store("tie-a");
  await shelve(ids.tieA, 2);
  ids.tieB = await store("tie-b");
  await shelve(ids.tieB, 2);
  /* Not on the row: a suspended store, and one with nothing published. */
  ids.suspended = await store("suspended", { status: "suspended" });
  await shelve(ids.suspended, 9);
  ids.draftsOnly = await store("drafts-only");
  await shelve(ids.draftsOnly, 5, "draft");

  /* Five visible reviews on tie-a; four visible and one hidden on tie-b. */
  for (const rating of [5, 5, 4, 4, 5]) await review(ids.tieA, shopper.id, rating);
  for (const rating of [5, 5, 5, 5]) await review(ids.tieB, shopper.id, rating);
  await review(ids.tieB, shopper.id, 5, true);
}, 60_000);

describe("listStoreCards", () => {
  it("lists approved stores with something published, the busiest first and ties by id", async () => {
    const cards = await catalog.listStoreCards("en");
    expect(cards.map(card => card.slug)).toEqual(["busy", "tie-a", "tie-b"]);
    expect(cards.map(card => card.products)).toEqual([4, 2, 2]);
  });

  it("names a store in the page's language, falling back to its own name", async () => {
    const cards = await catalog.listStoreCards("ar");
    expect(cards.find(card => card.slug === "busy")?.name).toBe("المزدحم");
    expect(cards.find(card => card.slug === "tie-a")?.name).toBe("TIE-A");
  });

  it("rates a store only from five visible reviews", async () => {
    const cards = await catalog.listStoreCards("en");
    expect(cards.find(card => card.slug === "tie-a")?.rating).toEqual({ average: 4.6, count: 5 });
    /* Four visible and one hidden is four, under the floor. */
    expect(cards.find(card => card.slug === "tie-b")?.rating).toBeNull();
    expect(cards.find(card => card.slug === "busy")?.rating).toBeNull();
  });

  it("stops at the limit", async () => {
    expect(await catalog.listStoreCards("en", 2)).toHaveLength(2);
  });
});
