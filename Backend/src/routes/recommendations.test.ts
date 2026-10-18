/**
 * Recommendations, against a real Postgres.
 *
 * The ranking is proved pure in `Shared/commerce/taste.test.ts`. What only a
 * database can prove is the half around it: that the signals are gathered from
 * the right rows, that an unpaid order is not treated as a purchase, that a
 * draft product cannot be recommended however well it scores, and that a
 * shopper with nothing to go on is told so rather than sold a claim.
 *
 * No AI gateway is configured here, so every one of these exercises the
 * deterministic path — which is the point: the model is an improvement on a
 * ranking that has to stand up without it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  categories,
  followedProducts,
  orderItems,
  orders,
  productVariants,
  products,
  savedProducts,
  users,
  vendors,
  type User,
} from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
let shopper: User;
const id: Record<string, number> = {};

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../services/db", async importOriginal => ({
    ...(await importOriginal<typeof import("../services/db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("./index.js")).appRouter;

  [shopper] = await db.insert(users).values({ email: "taste@example.test" }).returning();

  const [warm] = await db.insert(vendors).values({ slug: "warm", name: "Warm Room", status: "approved" }).returning();

  /*
   * `productType` on the storefront's `Product` is the product's *category
   * name*, not a column — `fromInventory` reads it off the category. So a
   * fixture that wants a type has to make a real category, which is also what
   * keeps this test honest about the join the ranking depends on.
   */
  const category: Record<string, number> = {};
  for (const [slug, name] of [["lighting", "Lighting"], ["soft", "Soft furnishing"], ["peripherals", "Peripherals"]]) {
    const [row] = await db.insert(categories).values({ slug, name }).returning();
    category[name] = row.id;
  }

  const make = async (handle: string, title: string, type: string, tags: string[], price: string, status: "published" | "draft" = "published") => {
    const [row] = await db.insert(products).values({
      vendorId: warm.id, categoryId: category[type], handle, title, tags, status,
    }).returning();
    await db.insert(productVariants).values({
      productId: row.id, title: "Default", price, stock: 10,
    });
    id[handle] = row.id;
    return row.id;
  };

  await make("lamp", "Brass reading lamp", "Lighting", ["brass", "home"], "12.000");
  await make("shade", "Paper lamp shade", "Lighting", ["home"], "9.000");
  await make("cushion", "Linen cushion cover", "Soft furnishing", ["linen", "home"], "6.000");
  await make("mouse", "Gaming mouse", "Peripherals", ["gaming"], "22.000");
  // Same type as the shopper's taste, and deliberately not on the shelf.
  await make("secret", "Unpublished lamp", "Lighting", ["home"], "10.000", "draft");
}, 60_000);

const asShopper = () => appRouter.createCaller(contextFor(shopper));
const asGuest = () => appRouter.createCaller(contextFor(null));
const ids = (result: { items: Array<{ product: { id: string } }> }) => result.items.map(i => i.product.id);

describe("a shopper we know nothing about", () => {
  it("is told so rather than sold a claim", async () => {
    const result = await asGuest().recommendations.forMe({});
    expect(result.personalised).toBe(false);
    expect(result.terms).toEqual([]);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("still never sees a draft product in the fallback", async () => {
    const result = await asGuest().recommendations.forMe({});
    expect(ids(result)).not.toContain(String(id.secret));
  });
});

describe("signals", () => {
  it("builds a taste from saved products and ranks the closest fit first", async () => {
    await db.insert(savedProducts).values([
      { userId: shopper.id, productId: String(id.lamp) },
      { userId: shopper.id, productId: String(id.cushion) },
    ]);

    const result = await asShopper().recommendations.forMe({});
    expect(result.personalised).toBe(true);
    expect(result.items[0].product.id).toBe(String(id.shade));
    expect(result.items[0].reasons.length).toBeGreaterThan(0);
  });

  it("never recommends back what the shopper already has", async () => {
    const result = await asShopper().recommendations.forMe({});
    expect(ids(result)).not.toContain(String(id.lamp));
    expect(ids(result)).not.toContain(String(id.cushion));
  });

  it("refuses a draft product however well it fits the taste", async () => {
    // Same type and tag as the two saved items — it would rank first if the
    // candidate set came from anywhere but `publishedCatalog`.
    const result = await asShopper().recommendations.forMe({});
    expect(ids(result)).not.toContain(String(id.secret));
  });

  it("takes an anonymous bag as a signal, with no account at all", async () => {
    const [bag] = await db.insert(carts).values({ id: "bag-token-aaaaaaaaaaaaaaaaaaaa" }).returning();
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, id.lamp));
    await db.insert(cartItems).values({ cartId: bag.id, variantId: variant.id, quantity: 1 });

    const guest = await asGuest().recommendations.forMe({ cartId: bag.id });
    expect(guest.personalised).toBe(true);
    expect(guest.terms).toContain("lighting");
    expect(ids(guest)).not.toContain(String(id.lamp));
  });

  /*
   * The distinction that costs money if it is wrong: an abandoned checkout is
   * not a purchase, and treating it as the strongest signal there is would let
   * a payment that never happened outrank everything a shopper actually did.
   */
  it("counts a paid order as bought and an unpaid one as nothing", async () => {
    const [unpaid] = await db.insert(orders).values({
      reference: "NL-20260917-AAAAA", userId: shopper.id, email: shopper.email,
      status: "pending_payment", itemsTotal: "22.000", grandTotal: "22.000",
    }).returning();
    await db.insert(orderItems).values({
      orderId: unpaid.id, productId: id.mouse, productTitle: "Gaming mouse",
      unitPrice: "22.000", quantity: 1, lineTotal: "22.000",
    });

    const before = await asShopper().recommendations.forMe({});
    // Never paid for, so it teaches nothing — and is still recommendable.
    expect(before.terms).not.toContain("peripherals");

    await db.update(orders).set({ status: "paid" }).where(eq(orders.id, unpaid.id));
    const after = await asShopper().recommendations.forMe({});
    expect(after.terms).toContain("peripherals");
    // Now that it is bought, it must not come back as a recommendation.
    expect(ids(after)).not.toContain(String(id.mouse));
  });
});

describe("what the caller may ask for", () => {
  it("reads the account from the session, never from the input", async () => {
    // There is no way to phrase "somebody else's recommendations": the only
    // account this procedure will read is the one on the context.
    const shape = appRouter._def.procedures["recommendations.forMe"];
    expect(shape).toBeDefined();
    const guest = await asGuest().recommendations.forMe({});
    const mine = await asShopper().recommendations.forMe({});
    expect(guest.personalised).toBe(false);
    expect(mine.personalised).toBe(true);
  });

  it("honours a limit and refuses an absurd one", async () => {
    const two = await asShopper().recommendations.forMe({ limit: 2 });
    expect(two.items.length).toBeLessThanOrEqual(2);
    await expect(asShopper().recommendations.forMe({ limit: 500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
