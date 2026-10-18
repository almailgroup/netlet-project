/**
 * Size charts (3.1.20), through the API against a real Postgres.
 *
 * The fitting is proved pure in `Shared/commerce/sizeGuide.test.ts`. What needs
 * a database is who may set a chart, that a chart the rules refuse is refused
 * by the API too, and that what was saved is what the storefront serves.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { productVariants, products, users, vendorMembers, vendors, type User } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;

type Who = "shopper" | "admin" | "owner" | "rival";
const people = {} as Record<Who, User>;
const ids = { product: 0, variant: 0 };

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const as = (who: Who | null) => appRouter.createCaller(contextFor(who ? people[who] : null));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("../routes/index.js")).appRouter;

  for (const who of ["shopper", "admin", "owner", "rival"] as Who[]) {
    const [row] = await db.insert(users).values({
      email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}),
    }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: people.owner.id, role: "owner" });
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: beta.id, userId: people.rival.id, role: "owner" });
  const [product] = await db.insert(products).values({ vendorId: acme.id, handle: "sofa", title: "Sofa", status: "published" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku: "SOFA", price: "240.000", stock: 5 }).returning();
  ids.product = product.id;
  ids.variant = variant.id;
}, 60_000);


const chart = {
  axis: "Size",
  measures: ["chest"] as const,
  rows: [
    { size: "M", ranges: { chest: [92, 97] as [number, number] } },
    { size: "L", ranges: { chest: [98, 103] as [number, number] } },
  ],
};

describe("a size chart", () => {
  it("is set by the store that owns the product and served to the shop as saved", async () => {
    await as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { ...chart, measures: [...chart.measures], rows: [{ size: " M ", ranges: { chest: [92.04, 97] } }, chart.rows[1]] } });
    const product = await as(null).commerce.products.byHandle({ handle: "sofa" });
    expect(product.sizeChart).toEqual({ axis: "Size", measures: ["chest"], rows: [{ size: "M", ranges: { chest: [92, 97] } }, { size: "L", ranges: { chest: [98, 103] } }] });
  });

  it("is refused for the reason the editor names, and left as it was", async () => {
    await as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { ...chart, measures: [...chart.measures] } });
    await expect(as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { ...chart, measures: [...chart.measures], rows: [{ size: "M", ranges: { chest: [97, 92] } }] } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "sizeGuide.badRange" });
    await expect(as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { ...chart, measures: ["chest", "waist"], rows: chart.rows } }))
      .rejects.toMatchObject({ message: "sizeGuide.missingRange" });
    const [row] = await db.select({ sizeChart: products.sizeChart }).from(products).where(eq(products.id, ids.product));
    expect(row.sizeChart?.rows).toHaveLength(2);
  });

  it("is another store's to touch not at all, and a shopper's not either", async () => {
    await expect(as("rival").inventory.products.setSizeChart({ productId: ids.product, chart: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").inventory.products.setSizeChart({ productId: ids.product, chart: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is removed with null, and the shop then has none", async () => {
    await as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { ...chart, measures: [...chart.measures] } });
    await as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: null });
    expect((await as(null).commerce.products.byHandle({ handle: "sofa" })).sizeChart).toBeNull();
  });

  it("refuses a measurement it does not know", async () => {
    await expect(as("owner").inventory.products.setSizeChart({ productId: ids.product, chart: { axis: "Size", measures: ["shoulder"], rows: [{ size: "M", ranges: { shoulder: [40, 44] } }] } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
