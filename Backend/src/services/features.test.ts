/**
 * The feature switchboard (2.3), through the API against a real Postgres.
 *
 * Three things matter and each is a property of the whole API rather than of
 * one router: every switch guards a procedure that exists, an entry refuses
 * while its feature is off for every caller, and only an administrator moves a
 * switch — with the act on the trail.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, featureSwitches, productVariants, products, users, vendorMembers, vendors, type User } from "../../database/schema.js";
import { FEATURE_KEYS, FEATURES } from "../../../Shared/features.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;

type Who = "shopper" | "admin" | "owner";
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

  for (const who of ["shopper", "admin", "owner"] as Who[]) {
    const [row] = await db.insert(users).values({
      email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}),
    }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: people.owner.id, role: "owner" });
  const [product] = await db.insert(products).values({ vendorId: acme.id, handle: "sofa", title: "Sofa", status: "published" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku: "SOFA", price: "240.000", stock: 5 }).returning();
  ids.product = product.id;
  ids.variant = variant.id;
}, 60_000);

beforeEach(async () => {
  await db.delete(featureSwitches);
});

describe("the switchboard's list", () => {
  it("names only procedures the API actually has", () => {
    const procedures = new Set(Object.keys(appRouter._def.procedures));
    for (const key of FEATURE_KEYS) {
      for (const entry of FEATURES[key].entries) expect(procedures, `${key} → ${entry}`).toContain(entry);
    }
  });

  /* Most features start on; the ones with nothing behind them yet start off. */
  it("starts each feature at its default, on a database nobody has touched", async () => {
    const states = await as(null).features.states();
    expect(states).toEqual(Object.fromEntries(FEATURE_KEYS.map(key => [key, FEATURES[key].defaultOn])));
  });
});

describe("turning a feature off", () => {
  it("refuses the entry for every caller, and lets it through again once back on", async () => {
    await as("admin").features.set({ key: "wishlists", enabled: false });
    await expect(as("shopper").wishlists.create({ title: "Birthday" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "features.off" });
    /* An administrator is refused too: the switch is about the shop, not about rank. */
    await expect(as("admin").wishlists.create({ title: "Birthday" }))
      .rejects.toMatchObject({ message: "features.off" });

    await as("admin").features.set({ key: "wishlists", enabled: true });
    const made = await as("shopper").wishlists.create({ title: "Birthday" });
    expect(made).toBeTruthy();
  });

  it("closes only the door it names: reading what is already there still works", async () => {
    await as("shopper").wishlists.create({ title: "Eid" });
    await as("admin").features.set({ key: "wishlists", enabled: false });
    const mine = await as("shopper").wishlists.mine();
    expect(mine.length).toBeGreaterThan(0);
  });

  it("refuses a price request while price offers are off", async () => {
    await as("admin").features.set({ key: "priceOffers", enabled: false });
    await expect(as("shopper").offers.request({ variantId: ids.variant, askedPrice: "200.000" }))
      .rejects.toMatchObject({ message: "features.off" });
  });

  it("empties a rail rather than breaking it", async () => {
    await as("admin").features.set({ key: "recommendations", enabled: false });
    await as("admin").features.set({ key: "boughtTogether", enabled: false });
    const rail = await as(null).recommendations.forMe({});
    expect(rail.items).toEqual([]);
    expect(await as(null).together.forProduct({ productId: String(ids.product) })).toEqual([]);
  });

  it("closes a gift list's public surfaces", async () => {
    await as("admin").features.set({ key: "wishlists", enabled: false });
    await expect(as(null).wishlists.findByPhone({ phone: "99887766" })).rejects.toMatchObject({ message: "features.off" });
  });
});

describe("who moves a switch", () => {
  it("is an administrator alone", async () => {
    await expect(as("owner").features.set({ key: "returns", enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").features.set({ key: "returns", enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("owner").features.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(null).features.set({ key: "returns", enabled: false })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await db.select().from(featureSwitches)).toEqual([]);
  });

  it("refuses a key this build does not know", async () => {
    await expect(as("admin").features.set({ key: "teleport", enabled: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("records who did it, before and after, and the page shows who", async () => {
    await as("admin").features.set({ key: "returns", enabled: false });
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.action, "platform.setFeature"), eq(auditLog.subjectLabel, "returns")));
    expect(row).toMatchObject({ subjectType: "feature", subjectLabel: "returns", actorId: people.admin.id, before: { enabled: true }, after: { enabled: false } });

    const list = await as("admin").features.list();
    expect(list.map((entry: { key: string }) => entry.key)).toEqual([...FEATURE_KEYS]);
    expect(list.find((entry: { key: string }) => entry.key === "returns")).toMatchObject({ enabled: false, updatedByEmail: "admin@netlet.test" });
    expect(list.find((entry: { key: string }) => entry.key === "wishlists")).toMatchObject({ enabled: true, updatedByEmail: null });
  });

  it("is idempotent: pressing it twice leaves one row", async () => {
    await as("admin").features.set({ key: "giftCards", enabled: false });
    await as("admin").features.set({ key: "giftCards", enabled: false });
    expect(await db.select().from(featureSwitches)).toHaveLength(1);
    expect((await as(null).features.states()).giftCards).toBe(false);
  });
});
