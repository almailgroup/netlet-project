/**
 * A department added in code has its row the first time the categories are
 * listed, against a real Postgres: every department is written once, a row an
 * administrator renamed keeps its name, and a merchant's own department stays.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { categories } from "../../database/schema.js";
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";

let db: ReturnType<typeof drizzle>;
let inventory: typeof import("./inventory.js");

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
  inventory = await import("./inventory.js");
  /* A database from before the eight: the first five, one renamed by hand, and a merchant's own. */
  await db.insert(categories).values([
    ...DEPARTMENTS.slice(0, 5).map(({ slug, name, nameAr, position }) => ({ slug, name, nameAr, position })),
    { slug: "musical-instruments", name: "Musical instruments", position: 40 },
  ]);
  await db.update(categories).set({ name: "Electronics & phones" }).where(eq(categories.slug, "electronics"));
});

describe("department rows", () => {
  it("writes every missing department once, and leaves the rest as they are", async () => {
    const first = await inventory.listCategories();
    const second = await inventory.listCategories();
    const slugs = first.map(row => row.slug);
    for (const department of DEPARTMENTS) expect(slugs, department.slug).toContain(department.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(second).toHaveLength(first.length);
    expect(first).toHaveLength(DEPARTMENTS.length + 1);
    expect(first.find(row => row.slug === "electronics")?.name).toBe("Electronics & phones");
    expect(first.find(row => row.slug === "musical-instruments")).toBeTruthy();
    expect(first.find(row => row.slug === "pet-supplies")?.nameAr).toBe("مستلزمات الحيوانات الأليفة");
  });
});
