/**
 * Search over the whole catalogue, against a real Postgres.
 *
 * The ranking is proved pure in `Shared/commerce/search.test.ts`. What needs a
 * database: that the SQL prefilter folds Arabic exactly as `foldText` does, so
 * it never drops what the ranking would find; that the hundred-and-first
 * product can be found, which is the bug this replaced; and that nothing the
 * shelf would not show comes back.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categories, products, productVariants, vendors } from "../../database/schema.js";
import { FOLD_FROM, FOLD_MARKS, FOLD_TO, foldText } from "../../../Shared/commerce/search.js";

let db: ReturnType<typeof drizzle>;
let search: typeof import("./productSearch.js");

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

  const [shop] = await db.insert(vendors).values({ slug: "shop", name: "Phone store Hawally", status: "approved" }).returning();
  const [closed] = await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended" }).returning();
  const [electronics] = await db.insert(categories).values({ slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" }).returning();
  const [grocery] = await db.insert(categories).values({ slug: "grocery", name: "Grocery", nameAr: "البقالة" }).returning();

  const add = async (values: Partial<typeof products.$inferInsert> & { handle: string; title: string }, variant = "Default") => {
    const [row] = await db.insert(products).values({ vendorId: shop.id, status: "published", ...values }).returning();
    await db.insert(productVariants).values({ productId: row.id, title: variant, sku: values.handle, price: "10.000", stock: 5 });
    return row;
  };
  /* The watch first, so 120 newer products bury it past where the old search could see. */
  await add({ handle: "watch", title: "Smart watch", titleAr: "ساعة ذكية", categoryId: electronics.id, attributes: [{ namespace: "specs", key: "brand", label: "Brand", value: "Samsung" }] });
  await add({ handle: "rice", title: "Basmati rice 5kg", titleAr: "أرز بسمتي", categoryId: grocery.id });
  await add({ handle: "discount", title: "Gift card 50% bonus", categoryId: grocery.id });
  await add({ handle: "fifty", title: "Fifty pack 50 bags", categoryId: grocery.id });
  await add({ handle: "shirt", title: "Linen shirt", categoryId: null }, "Black");
  await add({ handle: "hidden", title: "Smart watch draft", status: "draft", categoryId: electronics.id });
  await db.insert(products).values({ vendorId: closed.id, handle: "closed-watch", title: "Smart watch from a closed shop", status: "published" });
  for (let index = 0; index < 120; index++) await add({ handle: `filler-${index}`, title: `Kitchen towel ${index}`, categoryId: grocery.id });
}, 120_000);

describe("the SQL fold", () => {
  it("folds exactly as foldText does", async () => {
    const sample = "أإآٱ ساعة مستشفى مُكيّف مـــكيف ؤئ S٢٦ ۱۲ WATCH";
    const [row] = await db.execute<{ folded: string }>(sql`select regexp_replace(translate(lower(${sample}), ${FOLD_FROM}, ${FOLD_TO}), ${FOLD_MARKS}, '', 'g') as folded`).then(result => (result as unknown as { rows: { folded: string }[] }).rows);
    expect(row.folded).toBe(foldText(sample));
  });
});

describe("the whole catalogue", () => {
  it("finds a product a hundred and twenty newer ones have buried", async () => {
    const answer = await search.searchCatalogue({ q: "watch" });
    expect(answer.products.map(p => p.handle)).toEqual(["watch"]);
    expect(answer.total).toBe(1);
  });

  it("never returns a draft or a suspended store's product", async () => {
    const answer = await search.searchCatalogue({ q: "smart watch" });
    expect(answer.products.map(p => p.handle)).toEqual(["watch"]);
  });

  it("answers Arabic however it is spelt, and through the other language's title", async () => {
    for (const q of ["ساعه", "الساعة", "ساعات", "ذكية"]) {
      expect((await search.searchCatalogue({ q })).products.map(p => p.handle), q).toEqual(["watch"]);
    }
    expect((await search.searchCatalogue({ q: "ارز" })).products.map(p => p.handle)).toEqual(["rice"]);
    /* Kuwait's own word for rice, through the synonyms. */
    expect((await search.searchCatalogue({ q: "عيش" })).products.map(p => p.handle)).toEqual(["rice"]);
  });

  it("draws what it found in the page's language", async () => {
    const answer = await search.searchCatalogue({ q: "watch", locale: "ar" });
    expect(answer.products[0].title).toBe("ساعة ذكية");
  });

  it("reads a variant's name, and the department in Arabic", async () => {
    expect((await search.searchCatalogue({ q: "black shirt" })).products.map(p => p.handle)).toEqual(["shirt"]);
    expect((await search.searchCatalogue({ q: "إلكترونيات" })).products.map(p => p.handle)).toEqual(["watch"]);
  });

  /* A search is words: "%" and "_" are LIKE's wildcards, and must never reach it as one. */
  it("answers symbols alone with nothing, never with everything", async () => {
    for (const q of ["%", "_", "%%_"]) expect((await search.searchCatalogue({ q })).total, q).toBe(0);
    expect((await search.searchCatalogue({ q: "50%" })).products.map(p => p.handle).sort()).toEqual(["discount", "fifty", "filler-50"]);
  });

  it("corrects a misspelling to the catalogue's own word, and says so", async () => {
    const answer = await search.searchCatalogue({ q: "samsng" });
    expect(answer).toMatchObject({ correctedTo: "Samsung", total: 1 });
    expect(answer.products.map(p => p.handle)).toEqual(["watch"]);
  });

  it("narrows to a department, and counts the whole shop when the department has none", async () => {
    expect((await search.searchCatalogue({ q: "towel", department: "Grocery", limit: 5 })).total).toBe(120);
    const elsewhere = await search.searchCatalogue({ q: "watch", department: "Grocery" });
    expect(elsewhere).toMatchObject({ total: 0, elsewhere: 1 });
  });

  it("hands back a page and says how many there were", async () => {
    const answer = await search.searchCatalogue({ q: "kitchen towel", limit: 10 });
    expect(answer.products).toHaveLength(10);
    expect(answer.total).toBe(120);
    expect(answer.capped).toBe(false);
  });

  it("answers nothing for nothing", async () => {
    expect(await search.searchCatalogue({ q: "   " })).toMatchObject({ products: [], total: 0 });
    expect(await search.searchCatalogue({ q: "zzqxv" })).toMatchObject({ products: [], total: 0, correctedTo: null });
  });
});

describe("a product leaving the shop", () => {
  it("leaves the search with it", async () => {
    await db.update(products).set({ status: "archived" }).where(eq(products.handle, "rice"));
    expect((await search.searchCatalogue({ q: "rice" })).total).toBe(0);
    await db.update(products).set({ status: "published" }).where(eq(products.handle, "rice"));
  });
});
