/**
 * New and refurbished, against a real Postgres: two shops over one catalogue.
 * Every read of the new shop leaves a refurbished product out — the list, a
 * department's count, search, the stores selling a department — the
 * refurbished section reads them alone, and what somebody already has (a
 * product page, a saved heart, a store's own page) is found whichever it is.
 * The condition is a specification row its own control writes; a spec save
 * that leaves it out does not take it away.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auditLog, categories, products, productVariants, users, vendorMembers, vendors } from "../../database/schema.js";
import { conditionOf, isRefurbished } from "../../../Shared/commerce/condition.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let catalog: typeof import("./catalog.js");
let inv: typeof import("./inventory.js");
let search: typeof import("./productSearch.js");
let selling: typeof import("./storesSelling.js");
const ids = { store: 0, refurbishedOnlyStore: 0, owner: 0, phone: 0, usedPhone: 0, usedLaptop: 0, unfiled: 0 };

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
  catalog = await import("./catalog.js");
  inv = await import("./inventory.js");
  search = await import("./productSearch.js");
  selling = await import("./storesSelling.js");

  const [owner] = await db.insert(users).values({ email: "owner@phones.test" }).returning();
  const [store] = await db.insert(vendors).values({ slug: "phones", name: "Phone store", status: "approved" }).returning();
  const [usedOnly] = await db.insert(vendors).values({ slug: "second-hand", name: "Second hand", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: store.id, userId: owner.id, role: "owner" });
  const [electronics] = await db.insert(categories).values({ slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" }).returning();
  const refurbished = [{ namespace: "spec", key: "condition", label: "Condition", value: "refurbished" }];
  let made = 0;
  const add = async (vendorId: number, title: string, attributes: typeof refurbished = [], categoryId: number | null = electronics.id) => {
    made += 1;
    const [row] = await db.insert(products).values({ vendorId, handle: `p-${made}`, title, categoryId, status: "published", attributes }).returning();
    await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: `s-${made}`, price: "10.000", stock: 5 });
    return row.id;
  };
  ids.store = store.id;
  ids.refurbishedOnlyStore = usedOnly.id;
  ids.owner = owner.id;
  ids.phone = await add(store.id, "Galaxy phone");
  ids.usedPhone = await add(store.id, "Pixel phone", refurbished);
  ids.usedLaptop = await add(usedOnly.id, "ThinkPad laptop phone dock", refurbished);
  ids.unfiled = await add(usedOnly.id, "Refurbished tablet", refurbished, null);
}, 120_000);

const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.store, role: "owner" });
const titles = (list: { title: string }[]) => list.map(product => product.title).sort();

describe("the new shop", () => {
  it("lists, counts and searches the new products alone", async () => {
    expect(titles(await catalog.listProducts())).toEqual(["Galaxy phone"]);
    expect(await inv.publishedDepartmentCounts()).toEqual({ electronics: 1 });
    expect(titles((await search.searchCatalogue({ q: "phone" })).products)).toEqual(["Galaxy phone"]);
  });

  it("names no store whose only match is refurbished", async () => {
    expect((await selling.storesSelling({ department: "Electronics" })).map(store => store.slug)).toEqual(["phones"]);
    expect((await search.searchCatalogue({ q: "phone", stores: true })).stores.map(store => store.slug)).toEqual(["phones"]);
  });
});

describe("the refurbished section", () => {
  it("lists, counts and searches the refurbished products alone", async () => {
    expect(titles(await catalog.listProducts({ condition: "refurbished" }))).toEqual(["Pixel phone", "Refurbished tablet", "ThinkPad laptop phone dock"]);
    /* A refurbished product filed in no department still counts toward the whole. */
    expect(await inv.publishedRefurbishedSummary()).toEqual({ total: 3, departments: { electronics: 2 } });
    const found = await search.searchCatalogue({ q: "phone", condition: "refurbished" });
    expect(titles(found.products)).toEqual(["Pixel phone", "ThinkPad laptop phone dock"]);
    expect(found.products.every(isRefurbished)).toBe(true);
  });
});

describe("what somebody already has", () => {
  it("is found whichever shop it is in", async () => {
    expect((await catalog.getProductByHandle("p-2"))?.title).toBe("Pixel phone");
    expect(titles(await catalog.listProductsByIds([ids.phone, ids.usedPhone]))).toEqual(["Galaxy phone", "Pixel phone"]);
    /* A shelf of the new shop drawn by id says so. */
    expect(titles(await catalog.listProductsByIds([ids.phone, ids.usedPhone], "en", "new"))).toEqual(["Galaxy phone"]);
  });

  it("is on its store's own page, both shops together", async () => {
    const page = await catalog.getStorePage("phones");
    expect(titles(page!.products)).toEqual(["Galaxy phone", "Pixel phone"]);
  });
});

describe("the condition", () => {
  it("is set by its own control, on the trail, by somebody who may edit the product", async () => {
    expect(await inv.setProductCondition(owner(), ids.phone, "refurbished")).toBe("refurbished");
    expect(titles(await catalog.listProducts())).toEqual([]);
    const [row] = await db.select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(eq(auditLog.subjectId, ids.phone));
    expect(row).toMatchObject({ action: "product.setCondition", after: { condition: "refurbished" } });
    await inv.setProductCondition(owner(), ids.phone, "new");
    expect(titles(await catalog.listProducts())).toEqual(["Galaxy phone"]);
    /* Another store's product is not this owner's to move. */
    await expect(inv.setProductCondition(owner(), ids.usedLaptop, "new")).rejects.toThrow(/FORBIDDEN/);
  });

  it("survives a specification save that leaves it out, and is not added by one that sends it", async () => {
    await inv.setProductAttributes(owner(), ids.usedPhone, [{ namespace: "spec", key: "brand", label: "Brand", value: "Google" }]);
    const [kept] = await db.select({ attributes: products.attributes }).from(products).where(eq(products.id, ids.usedPhone));
    expect(conditionOf(kept.attributes)).toBe("refurbished");
    expect(kept.attributes.filter(row => row.key === "brand")).toHaveLength(1);
    await inv.setProductAttributes(owner(), ids.phone, [{ namespace: "spec", key: "condition", label: "Condition", value: "refurbished" }]);
    const [unchanged] = await db.select({ attributes: products.attributes }).from(products).where(eq(products.id, ids.phone));
    expect(conditionOf(unchanged.attributes)).toBe("new");
  });

  it("goes on a product as it is created", async () => {
    const created = await inv.createProduct(owner(), {
      vendorId: ids.store,
      title: "Used earbuds",
      condition: "refurbished",
      variant: { price: "5.000", stock: 1 },
    });
    const [row] = await db.select({ attributes: products.attributes }).from(products).where(eq(products.id, created.id));
    expect(conditionOf(row.attributes)).toBe("refurbished");
  });
});
