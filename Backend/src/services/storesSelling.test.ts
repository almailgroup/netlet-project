/**
 * The stores that sell what a search, a department or a subcategory holds,
 * against a real Postgres: the store selling the most first, how many of the
 * matches each sells, and never a store the shop would not show — a suspended
 * one, or one whose only match is a draft.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categories, products, productVariants, vendors } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let search: typeof import("./productSearch.js");
let selling: typeof import("./storesSelling.js");

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
  search = await import("./productSearch.js");
  selling = await import("./storesSelling.js");

  const [phones] = await db.insert(vendors).values({ slug: "phones", name: "Phone store", nameAr: "متجر الهواتف", status: "approved" }).returning();
  const [gadgets] = await db.insert(vendors).values({ slug: "gadgets", name: "Gadgets", status: "approved" }).returning();
  const [closed] = await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended" }).returning();
  const [drafts] = await db.insert(vendors).values({ slug: "drafts", name: "Drafts only", status: "approved" }).returning();
  const [electronics] = await db.insert(categories).values({ slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" }).returning();
  const [grocery] = await db.insert(categories).values({ slug: "grocery", name: "Grocery", nameAr: "البقالة" }).returning();

  const electronicsId = electronics.id;
  const groceryId = grocery.id;
  let made = 0;
  const add = async (vendorId: number, title: string, categoryId: number, status: "published" | "draft" = "published") => {
    made += 1;
    const [row] = await db.insert(products).values({ vendorId, handle: `p-${made}`, title, categoryId, status }).returning();
    await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: `s-${made}`, price: "10.000", stock: 5 });
  };
  await add(gadgets.id, "Wireless earbuds", electronicsId);
  await add(phones.id, "Galaxy phone", electronicsId);
  await add(phones.id, "Pixel phone", electronicsId);
  await add(phones.id, "USB-C charger", electronicsId);
  await add(gadgets.id, "Phone stand", electronicsId);
  await add(gadgets.id, "Silicone cover", electronicsId);
  await add(phones.id, "Basmati rice", groceryId);
  await add(closed.id, "Old phone", electronicsId);
  await add(drafts.id, "Draft phone", electronicsId, "draft");
}, 120_000);

describe("a search's stores", () => {
  it("names the stores that sell what matched, the one selling the most first, only when asked", async () => {
    const answer = await search.searchCatalogue({ q: "phone", stores: true });
    expect(answer.stores.map(store => [store.slug, store.matching])).toEqual([["phones", 2], ["gadgets", 1]]);
    /* The card is the store's whole shelf, the same card `/stores` draws. */
    expect(answer.stores[0]).toMatchObject({ name: "Phone store", products: 4 });
    expect((await search.searchCatalogue({ q: "phone" })).stores).toEqual([]);
  });

  it("names a store in the page's language", async () => {
    const answer = await search.searchCatalogue({ q: "phone", stores: true, locale: "ar" });
    expect(answer.stores[0].name).toBe("متجر الهواتف");
    /* And by its other name, so a page's own search finds it however it is typed. */
    expect(answer.stores[0].otherName).toBe("Phone store");
    expect((await search.searchCatalogue({ q: "phone", stores: true })).stores[0].otherName).toBe("متجر الهواتف");
    /* A store that wrote one name has no other. */
    expect(answer.stores[1].otherName).toBeNull();
  });

  it("names nobody for a search that found nothing", async () => {
    expect((await search.searchCatalogue({ q: "zzqxv", stores: true })).stores).toEqual([]);
  });
});

describe("a department's and a subcategory's stores", () => {
  it("names every store selling in the department, never a suspended store or one with drafts alone", async () => {
    const stores = await selling.storesSelling({ department: "Electronics" });
    /* Three each: a tie goes the same way on every read. */
    expect(stores.map(store => [store.slug, store.matching])).toEqual([["phones", 3], ["gadgets", 3]]);
    expect((await selling.storesSelling({ department: "Grocery" })).map(store => store.slug)).toEqual(["phones"]);
  });

  it("narrows to the subcategory the page shows", async () => {
    /* The two phones and the stand are phones; the charger and the cover are accessories. */
    expect((await selling.storesSelling({ department: "Electronics", sub: "phones" })).map(store => [store.slug, store.matching])).toEqual([["phones", 2], ["gadgets", 1]]);
    expect((await selling.storesSelling({ department: "Electronics", sub: "accessories" })).map(store => [store.slug, store.matching])).toEqual([["phones", 1], ["gadgets", 1]]);
    expect(await selling.storesSelling({ department: "Electronics", sub: "cameras" })).toEqual([]);
  });

  it("names nobody for a department nobody sells in", async () => {
    expect(await selling.storesSelling({ department: "Beauty" })).toEqual([]);
  });
});
