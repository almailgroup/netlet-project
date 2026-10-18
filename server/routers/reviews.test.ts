/**
 * Reviews against a real Postgres.
 *
 * The rules — who may review, what a pile of ratings averages to — are proved
 * in `Shared/commerce/reviews.test.ts`. What only a database can prove is the
 * part that matters here: that a review cannot be written against somebody
 * else's purchase, that the unique index actually holds one review per line,
 * and that the join refusing an unowned line looks identical to the line not
 * existing.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { orderItems, orders, products, reviews, users, vendors, type User } from "../../drizzle/schema.js";
import type { TrpcContext } from "../_core/context.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const people: Record<"mona" | "yusuf" | "boss", User> = {} as never;
const lines: Record<string, number> = {};
let productId = 0;

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const as = (who: keyof typeof people) => appRouter.createCaller(contextFor(people[who]));
const anon = () => appRouter.createCaller(contextFor(null));

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

  const [mona] = await db.insert(users).values({ email: "mona@example.test", name: "Mona Al Sabah" }).returning();
  const [yusuf] = await db.insert(users).values({ email: "yusuf@example.test", name: "Yusuf" }).returning();
  const [boss] = await db.insert(users).values({ email: "boss@example.test", name: "Boss", role: "admin" }).returning();
  Object.assign(people, { mona, yusuf, boss });

  const [vendor] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [lamp] = await db.insert(products).values({
    vendorId: vendor.id, handle: "brass-reading-lamp", title: "Brass Reading Lamp", status: "published",
  }).returning();
  productId = lamp.id;

  /*
   * Four lines covering every branch of the eligibility rule, so no test has
   * to mutate a row to reach the case it is about.
   */
  const make = async (
    key: string,
    userId: number,
    status: "paid" | "pending_payment" | "refunded",
    deliveredAt: Date | null,
  ) => {
    const [order] = await db.insert(orders).values({
      userId, reference: `NL-2026-${key.toUpperCase()}`, status,
      email: "shopper@example.test",
      itemsTotal: "10.000", grandTotal: "10.000", currency: "KWD",
    }).returning();
    const [line] = await db.insert(orderItems).values({
      orderId: order.id, vendorId: vendor.id, productId,
      productTitle: "Brass Reading Lamp", unitPrice: "10.000", quantity: 1, lineTotal: "10.000",
      fulfilment: deliveredAt ? "delivered" : "pending",
      deliveredAt,
    }).returning();
    lines[key] = line.id;
  };

  const arrived = new Date("2026-06-01T10:00:00Z");
  await make("delivered", people.mona.id, "paid", arrived);   // reviewable
  await make("inTransit", people.mona.id, "paid", null);       // not yet arrived
  await make("unpaid", people.mona.id, "pending_payment", arrived); // never paid
  await make("yusufs", people.yusuf.id, "paid", arrived);      // somebody else's
}, 60_000);

describe("writing a review", () => {
  it("accepts a paid, delivered line and marks it a verified purchase", async () => {
    const id = await as("mona").reviews.write({
      orderItemId: lines.delivered, rating: 5, title: "Lovely", body: "Warm light, solid brass.",
    });
    expect(id).toBeGreaterThan(0);

    const shelf = await anon().reviews.forProduct({ productId: String(productId) });
    expect(shelf.total).toBe(1);
    expect(shelf.items[0].verifiedPurchase).toBe(true);
    expect(shelf.summary).toEqual({ count: 1, average: 5, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } });
  });

  it("refuses a product that has not arrived", async () => {
    await expect(as("mona").reviews.write({ orderItemId: lines.inTransit, rating: 4 }))
      .rejects.toMatchObject({ message: "review.notDelivered" });
  });

  it("refuses an order nobody paid for", async () => {
    await expect(as("mona").reviews.write({ orderItemId: lines.unpaid, rating: 4 }))
      .rejects.toMatchObject({ message: "review.notPaid" });
  });

  /*
   * The one that matters. An order-item id is a serial; somebody else's line
   * must be refused by the join, and must look exactly like a line that does
   * not exist rather than like one they are not allowed to touch.
   */
  it("refuses somebody else's purchase, indistinguishably from a missing one", async () => {
    const stolen = await as("mona").reviews.write({ orderItemId: lines.yusufs, rating: 1 }).catch((e: Error) => e);
    const missing = await as("mona").reviews.write({ orderItemId: 999_999, rating: 1 }).catch((e: Error) => e);
    expect((stolen as { code?: string }).code).toBe("NOT_FOUND");
    expect((stolen as Error).message).toBe((missing as Error).message);
  });

  it("refuses a second review of the same line", async () => {
    await expect(as("mona").reviews.write({ orderItemId: lines.delivered, rating: 3 }))
      .rejects.toMatchObject({ message: "review.alreadyReviewed" });
  });

  it("refuses a rating off the scale before it reaches the database", async () => {
    await expect(as("mona").reviews.write({ orderItemId: lines.delivered, rating: 0 })).rejects.toBeTruthy();
    await expect(as("mona").reviews.write({ orderItemId: lines.delivered, rating: 6 })).rejects.toBeTruthy();
  });

  it("refuses a signed-out caller entirely", async () => {
    await expect(anon().reviews.write({ orderItemId: lines.delivered, rating: 5 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("what a shopper is told they can review", () => {
  it("lists every line with its refusal, rather than hiding the ones they cannot", async () => {
    const mine = await as("mona").reviews.mine();
    const byLine = new Map(mine.map((row: { orderItemId: number }) => [row.orderItemId, row]));

    expect(byLine.get(lines.delivered).eligibility).toEqual({ allowed: false, reason: "alreadyReviewed" });
    expect(byLine.get(lines.inTransit).eligibility).toEqual({ allowed: false, reason: "notDelivered" });
    expect(byLine.get(lines.unpaid).eligibility).toEqual({ allowed: false, reason: "notPaid" });
    // And never another shopper's line.
    expect(byLine.has(lines.yusufs)).toBe(false);
  });

  it("carries the rating they already gave, so the form can open on it", async () => {
    const mine = await as("mona").reviews.mine();
    expect(mine.find((r: { orderItemId: number }) => r.orderItemId === lines.delivered).myRating).toBe(5);
  });
});

describe("what the shelf shows", () => {
  /*
   * Written against a real Kuwaiti name on purpose. "Mona Al Sabah" has the
   * family name "Al Sabah", so her initial is A — a naive last-word rule gives
   * "Mona S.", which is nobody's initial. This test is what caught that.
   */
  it("names a reviewer by first name and an initial, never in full and never by email", async () => {
    const shelf = await anon().reviews.forProduct({ productId: String(productId) });
    expect(shelf.items[0].author).toBe("Mona A.");
    expect(JSON.stringify(shelf)).not.toContain("mona@example.test");
    expect(JSON.stringify(shelf)).not.toContain("Al Sabah");
  });

  it("has nothing to say about a product nobody reviewed", async () => {
    const none = await anon().reviews.forProduct({ productId: String(productId + 999) });
    expect(none.items).toEqual([]);
    // Null, not a zero-star summary: no stars beats "0.0 from 0 reviews".
    expect(none.summary).toBeNull();
  });

  /* The storefront's product id is a string and need not be numeric. */
  it("treats a non-numeric id as no reviews rather than an error", async () => {
    await expect(anon().reviews.forProduct({ productId: "brass-reading-lamp" }))
      .resolves.toEqual({ items: [], summary: null, total: 0 });
  });

  /* `parseInt` reads it and Postgres refuses it: that used to be a 500. */
  it("treats an id no integer column can hold as no reviews too", async () => {
    await expect(anon().reviews.forProduct({ productId: "99999999999" }))
      .resolves.toEqual({ items: [], summary: null, total: 0 });
    await expect(anon().reviews.forProduct({ productId: "0" }))
      .resolves.toEqual({ items: [], summary: null, total: 0 });
  });
});

describe("moderation", () => {
  it("lets an admin hide a review, keeping the row and the reason", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await as("boss").reviews.setHidden({ reviewId: row.id, hidden: true, reason: "abusive" });

    const shelf = await anon().reviews.forProduct({ productId: String(productId) });
    expect(shelf.total).toBe(0);
    expect(shelf.summary).toBeNull();

    // Hidden, not deleted — the evidence of the decision survives.
    const [after] = await db.select().from(reviews).where(eq(reviews.id, row.id));
    expect(after.hiddenAt).not.toBeNull();
    expect(after.hiddenReason).toBe("abusive");

    await as("boss").reviews.setHidden({ reviewId: row.id, hidden: false });
    expect((await anon().reviews.forProduct({ productId: String(productId) })).total).toBe(1);
  });

  it("refuses a shopper trying to moderate", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await expect(as("mona").reviews.setHidden({ reviewId: row.id, hidden: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a reply from somebody who is not the vendor", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await expect(as("mona").reviews.reply({ reviewId: row.id, reply: "thanks!" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    // An admin is not a vendor either, and must not post in one's voice.
    await expect(as("boss").reviews.reply({ reviewId: row.id, reply: "thanks!" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /* A public reply is the chat's leak with a bigger audience. */
  it("refuses a reply carrying a way to reach the seller off the platform", async () => {
    const { replyToReview } = await import("../reviews.js");
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await expect(replyToReview(row.vendorId!, row.id, "Thanks! Cheaper on whatsapp ٩٩٨٨ ٧٧٦٦"))
      .rejects.toMatchObject({ reason: "offPlatform" });
    await replyToReview(row.vendorId!, row.id, "Thank you — glad it arrived safely.");
    const [after] = await db.select().from(reviews).where(eq(reviews.id, row.id));
    expect(after.vendorReply).toBe("Thank you — glad it arrived safely.");
  });
});

describe("editing your own review", () => {
  it("changes the rating and moves the average", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await as("mona").reviews.edit({ reviewId: row.id, rating: 2 });
    expect((await anon().reviews.forProduct({ productId: String(productId) })).summary!.average).toBe(2);
  });

  it("refuses to edit or delete a review that is not yours", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await expect(as("yusuf").reviews.edit({ reviewId: row.id, rating: 5 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("yusuf").reviews.remove({ reviewId: row.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /*
   * Deleting frees the line to be reviewed again — which is right: the
   * uniqueness key is the purchase, not a one-shot chance to speak.
   */
  it("frees the line when the review is deleted", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderItemId, lines.delivered));
    await as("mona").reviews.remove({ reviewId: row.id });
    expect((await anon().reviews.forProduct({ productId: String(productId) })).total).toBe(0);

    const mine = await as("mona").reviews.mine();
    expect(mine.find((r: { orderItemId: number }) => r.orderItemId === lines.delivered).eligibility)
      .toEqual({ allowed: true });
  });
});
