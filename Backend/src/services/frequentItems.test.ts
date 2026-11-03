/**
 * Frequently bought (migration 0073) against a real Postgres: only a product
 * the shop shows goes on, at a variant it has, once per variant; the amount is
 * the shopper's and changes in place; another shopper's item is not found;
 * suggestions are the shopper's own past purchases less what is on the list;
 * and before the migration is pasted a read is empty and a write says why.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { frequentItems, orderItems, orders, productVariants, products, users, vendors } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let frequent: typeof import("./frequentItems.js");

const ids = { shopper: 0, stranger: 0, lamp: 0, black: 0, white: 0, tea: 0, teaPack: 0, draft: 0, draftVariant: 0 };

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
  frequent = await import("./frequentItems.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test", name: "Noura" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [black] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "20.000", stock: 5 }).returning();
  const [white] = await db.insert(productVariants).values({ productId: lamp.id, title: "White", price: "20.000", stock: 5 }).returning();
  const [tea] = await db.insert(products).values({ vendorId: acme.id, handle: "tea", title: "Green tea", status: "published" }).returning();
  const [teaPack] = await db.insert(productVariants).values({ productId: tea.id, title: "Default", price: "1.500", stock: 40 }).returning();
  const [draft] = await db.insert(products).values({ vendorId: acme.id, handle: "draft", title: "Not yet", status: "draft" }).returning();
  const [draftVariant] = await db.insert(productVariants).values({ productId: draft.id, title: "Default", price: "3.000", stock: 5 }).returning();
  Object.assign(ids, {
    shopper: shopper.id,
    stranger: stranger.id,
    lamp: lamp.id,
    black: black.id,
    white: white.id,
    tea: tea.id,
    teaPack: teaPack.id,
    draft: draft.id,
    draftVariant: draftVariant.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(frequentItems);
  await db.delete(orderItems);
  await db.delete(orders);
});

describe("the list", () => {
  it("takes a product the shop shows, at its variant and the usual amount, once per variant", async () => {
    const first = await frequent.addFrequent(ids.shopper, { productId: ids.tea, variantId: ids.teaPack, quantity: 3 });
    expect(first.quantity).toBe(3);
    /* Adding again changes the amount in place rather than adding a second row. */
    const again = await frequent.addFrequent(ids.shopper, { productId: ids.tea, variantId: ids.teaPack, quantity: 5 });
    expect(again.id).toBe(first.id);
    expect(again.quantity).toBe(5);
    /* Two variants of one product are two items. */
    await frequent.addFrequent(ids.shopper, { productId: ids.lamp, variantId: ids.white, quantity: 1 });
    const list = await frequent.listFrequent(ids.shopper);
    expect(list.ready).toBe(true);
    expect(list.items.map(item => [item.productId, item.variantId, item.quantity])).toEqual([
      [String(ids.lamp), String(ids.white), 1],
      [String(ids.tea), String(ids.teaPack), 5],
    ]);
    expect(list.items[0].product?.title).toBe("Desk Lamp");
    const forLamp = await frequent.frequentForProduct(ids.shopper, ids.lamp);
    expect(forLamp.entries.map(entry => entry.variantId)).toEqual([String(ids.white)]);
  });

  it("refuses a product the shop does not show, or a variant of another product", async () => {
    await expect(frequent.addFrequent(ids.shopper, { productId: ids.draft, variantId: ids.draftVariant, quantity: 1 })).rejects.toThrow("frequent.notFound");
    await expect(frequent.addFrequent(ids.shopper, { productId: ids.lamp, variantId: ids.teaPack, quantity: 1 })).rejects.toThrow("frequent.notFound");
    expect((await frequent.listFrequent(ids.shopper)).items).toEqual([]);
  });

  it("changes and removes only the shopper's own items", async () => {
    const item = await frequent.addFrequent(ids.shopper, { productId: ids.tea, variantId: ids.teaPack, quantity: 2 });
    await expect(frequent.setFrequentQuantity(ids.stranger, item.id, 9)).rejects.toThrow("frequent.notFound");
    await expect(frequent.removeFrequent(ids.stranger, item.id)).rejects.toThrow("frequent.notFound");
    expect((await frequent.setFrequentQuantity(ids.shopper, item.id, 4)).quantity).toBe(4);
    await frequent.removeFrequent(ids.shopper, item.id);
    expect((await frequent.listFrequent(ids.shopper)).items).toEqual([]);
  });

  it("keeps an item whose product left the shop, marked as gone rather than vanishing", async () => {
    await frequent.addFrequent(ids.shopper, { productId: ids.lamp, variantId: ids.black, quantity: 1 });
    await db.update(products).set({ status: "archived" }).where(eq(products.id, ids.lamp));
    try {
      const [item] = (await frequent.listFrequent(ids.shopper)).items;
      expect(item.product).toBeNull();
    } finally {
      await db.update(products).set({ status: "published" }).where(eq(products.id, ids.lamp));
    }
  });
});

describe("suggestions", () => {
  it("are the shopper's own past purchases, most often bought first, less what is on the list", async () => {
    const order = async (n: number, lines: [number, number, number][], userId = ids.shopper) => {
      const [row] = await db.insert(orders).values({
        reference: `NL-20261103-FRQ${n}`, userId, email: "x@example.test", status: "paid",
        itemsTotal: "10.000", grandTotal: "10.000", placedAt: new Date(Date.UTC(2026, 9, n)),
      }).returning();
      await db.insert(orderItems).values(lines.map(([productId, variantId, quantity]) => ({
        orderId: row.id, vendorId: null, productId, variantId, vendorName: "Acme", productTitle: "x",
        unitPrice: "1.000", quantity, lineTotal: "1.000", fulfilment: "delivered" as const,
      })));
    };
    await order(1, [[ids.tea, ids.teaPack, 2]]);
    await order(2, [[ids.tea, ids.teaPack, 4], [ids.lamp, ids.black, 1]]);
    await order(3, [[ids.lamp, ids.white, 1]], ids.stranger);
    const suggestions = await frequent.frequentSuggestions(ids.shopper);
    expect(suggestions.map(s => [s.productId, s.variantId, s.timesBought, s.lastQuantity])).toEqual([
      [String(ids.tea), String(ids.teaPack), 2, 4],
      [String(ids.lamp), String(ids.black), 1, 1],
    ]);
    await frequent.addFrequent(ids.shopper, { productId: ids.tea, variantId: ids.teaPack, quantity: 4 });
    expect((await frequent.frequentSuggestions(ids.shopper)).map(s => s.productId)).toEqual([String(ids.lamp)]);
  });
});

describe("before migration 0073 is pasted", () => {
  it("reads as not ready with nothing on it, and a write says why", async () => {
    await db.execute("alter table frequent_items rename to frequent_items_away");
    try {
      expect(await frequent.listFrequent(ids.shopper)).toEqual({ ready: false, items: [] });
      expect(await frequent.frequentForProduct(ids.shopper, ids.tea)).toEqual({ ready: false, entries: [] });
      await expect(frequent.addFrequent(ids.shopper, { productId: ids.tea, variantId: ids.teaPack, quantity: 1 })).rejects.toThrow("frequent.unavailable");
      expect(await frequent.frequentSuggestions(ids.shopper)).toEqual([]);
    } finally {
      await db.execute("alter table frequent_items_away rename to frequent_items");
    }
  });
});

