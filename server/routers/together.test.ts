/**
 * Frequently bought together, against a real Postgres.
 *
 * The ranking is proved in `shared/commerce/together.test.ts`. What only a
 * database can prove is the gathering: that carts alone are enough to produce
 * a rail **today**, that a paid order outweighs a cart, that an unpaid order
 * counts for nothing, and that a draft product cannot appear however many
 * people bought it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cartItems, carts, orderItems, orders, products, productVariants, vendors,
} from "../../drizzle/schema.js";
import type { TrpcContext } from "../_core/context.js";
import { MIN_SUPPORT } from "../../shared/commerce/together.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const id: Record<string, string> = {};
let make: (key: string, title: string, vendorId: number, status?: "published" | "draft") => Promise<void>;

const anon = () => appRouter.createCaller({
  user: null,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
} as TrpcContext);

/** One cart holding a set of products, which is what a basket is here. */
async function bag(name: string, productKeys: string[]) {
  const [cart] = await db.insert(carts).values({ id: name }).returning();
  for (const key of productKeys) {
    const [variant] = await db.select().from(productVariants)
      .where(eq(productVariants.productId, Number(id[key])));
    await db.insert(cartItems).values({ cartId: cart.id, variantId: variant.id, quantity: 1 });
  }
}

/** One order holding a set of products. */
async function buy(reference: string, status: "paid" | "pending_payment", productKeys: string[]) {
  const [order] = await db.insert(orders).values({
    reference, email: "shopper@example.test", status,
    currency: "KWD", itemsTotal: "10.000", grandTotal: "10.000",
  }).returning();
  for (const key of productKeys) {
    await db.insert(orderItems).values({
      orderId: order.id, productId: Number(id[key]), productTitle: key,
      unitPrice: "10.000", quantity: 1, lineTotal: "10.000",
    });
  }
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../db", async importOriginal => ({
    ...(await importOriginal<typeof import("../db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("../routers.js")).appRouter;

  const [byteCo] = await db.insert(vendors).values({ slug: "byte", name: "Byte Co", status: "approved" }).returning();
  const [accessoryCo] = await db.insert(vendors).values({ slug: "acc", name: "Accessory Co", status: "approved" }).returning();

  make = async (key: string, title: string, vendorId: number, status: "published" | "draft" = "published") => {
    const [row] = await db.insert(products).values({ vendorId, handle: key, title, status }).returning();
    await db.insert(productVariants).values({
      productId: row.id, title: "Default", price: "10.000", stock: 50,
    });
    id[key] = String(row.id);
  };

  await make("phone", "Phone", byteCo.id);
  await make("case", "Phone case", accessoryCo.id);     // different seller
  await make("batteries", "Batteries", byteCo.id);       // a bestseller
  await make("rug", "Hand-knotted rug", byteCo.id);      // unrelated
  await make("secret", "Draft accessory", byteCo.id, "draft");

  /*
   * Ten baskets. The case rides with the phone most times the phone appears
   * and rarely otherwise; the batteries are in nearly everything, which is
   * what makes them a bestseller rather than a complement.
   */
  await bag("c1", ["phone", "case", "batteries"]);
  await bag("c2", ["phone", "case", "batteries"]);
  await bag("c3", ["phone", "case", "batteries", "secret"]);
  await bag("c4", ["phone", "batteries"]);
  await bag("c5", ["rug", "batteries"]);
  await bag("c6", ["rug", "batteries"]);
  await bag("c7", ["rug", "batteries"]);
  await bag("c8", ["rug", "batteries"]);
  await bag("c9", ["rug", "batteries"]);
  await bag("c10", ["rug"]);
}, 60_000);

describe("with carts alone", () => {
  /*
   * The reason this feature is not blocked on payments. Nothing places a paid
   * order in NetLet yet, and the rail still has something true to say.
   */
  it("produces a rail today, from baskets nobody has paid for", async () => {
    const rail = await anon().together.forProduct({ productId: id.phone });
    expect(rail.length).toBeGreaterThan(0);
    expect(rail[0].product.title).toBe("Phone case");
  });

  it("ranks the complement above the bestseller it co-occurs with less often", async () => {
    const rail = await anon().together.forProduct({ productId: id.phone });
    const titles = rail.map((entry: { product: { title: string } }) => entry.product.title);
    // Batteries share more baskets with the phone in absolute terms and still
    // rank below, because they share baskets with everything.
    expect(titles.indexOf("Phone case")).toBeLessThan(
      titles.indexOf("Batteries") === -1 ? Number.MAX_SAFE_INTEGER : titles.indexOf("Batteries"),
    );
  });

  it("marks a complement from another seller, which is the point of the requirement", async () => {
    const rail = await anon().together.forProduct({ productId: id.phone });
    const found = rail.find((entry: { product: { title: string } }) => entry.product.title === "Phone case");
    expect(found.crossVendor).toBe(true);
  });

  /* A draft is absent from the shop, so it is absent from the rail. */
  it("never surfaces an unpublished product", async () => {
    const rail = await anon().together.forProduct({ productId: id.phone });
    expect(JSON.stringify(rail)).not.toContain("Draft accessory");
  });

  it("says nothing about a product nobody has ever put in a basket", async () => {
    const [lonely] = await db.insert(products).values({
      vendorId: 1, handle: "lonely", title: "Lonely", status: "published",
    }).returning();
    await db.insert(productVariants).values({ productId: lonely.id, title: "Default", price: "9.000", stock: 5 });
    expect(await anon().together.forProduct({ productId: String(lonely.id) })).toEqual([]);
  });

  it("never recommends the product back to itself", async () => {
    const rail = await anon().together.forProduct({ productId: id.phone });
    expect(rail.map((e: { product: { id: string } }) => e.product.id)).not.toContain(id.phone);
  });
});

describe("what counts as evidence", () => {
  /*
   * An order sitting in `pending_payment` is an intention that may still fail.
   * Counting it as a purchase would let an abandoned checkout carry three
   * times the weight of the cart it came from.
   */
  it("ignores an order nobody paid for", async () => {
    const before = await anon().together.forProduct({ productId: id.rug });
    await buy("NL-UNPAID-1", "pending_payment", ["rug", "case"]);
    await buy("NL-UNPAID-2", "pending_payment", ["rug", "case"]);
    await buy("NL-UNPAID-3", "pending_payment", ["rug", "case"]);
    const after = await anon().together.forProduct({ productId: id.rug });
    expect(after).toEqual(before);
  });

  /*
   * Its own pair of products, deliberately. The first version of this test
   * reused the rug and the case, and adding three rug+case orders pushed the
   * case into so many baskets that its lift against the rug fell *below*
   * chance — the algorithm being right and the test being wrong. Sharing
   * fixtures between tests of a ratio means every test moves the denominator
   * of every other.
   */
  it("lets paid orders build an association carts never did", async () => {
    await make("tripod", "Tripod", 1);
    await make("mic", "Clip microphone", 1);

    expect(await anon().together.forProduct({ productId: id.tripod })).toEqual([]);

    for (let n = 0; n < MIN_SUPPORT; n++) await buy(`NL-PAID-${n}`, "paid", ["tripod", "mic"]);

    const rail = await anon().together.forProduct({ productId: id.tripod });
    expect(rail.map((e: { product: { title: string } }) => e.product.title)).toContain("Clip microphone");
  });

  /*
   * Two variants of one product in one basket is one shopper saying one thing.
   * Without collapsing, that basket would count double towards every pairing
   * it contains — so the rail must not move at all.
   */
  it("counts a product once per basket however many lines it filled", async () => {
    await make("tent", "Tent", 1);
    await make("pegs", "Tent pegs", 1);
    for (let n = 0; n < 4; n++) await bag(`camp${n}`, ["tent", "pegs"]);

    const before = await anon().together.forProduct({ productId: id.tent });
    expect(before[0].product.title).toBe("Tent pegs");

    // A second variant of the pegs, in a basket that already holds them.
    const [extra] = await db.insert(productVariants).values({
      productId: Number(id.pegs), title: "Long", price: "10.000", stock: 5,
    }).returning();
    await db.insert(cartItems).values({ cartId: "camp0", variantId: extra.id, quantity: 1 });

    const after = await anon().together.forProduct({ productId: id.tent });
    expect(after[0].lift).toBeCloseTo(before[0].lift, 6);
    expect(after[0].confidence).toBeCloseTo(before[0].confidence, 6);
  });
});
