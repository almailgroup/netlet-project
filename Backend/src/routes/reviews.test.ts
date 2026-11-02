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
import { mediaFiles, orderItems, orders, products, reviewPhotos, reviews, users, vendors, type User } from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const people: Record<"mona" | "yusuf" | "boss", User> = {} as never;
const lines: Record<string, number> = {};
let productId = 0;
/* NetLet AI stood in for: off unless a test turns it on, and what it answers. */
const model = { available: false, answer: null as string | null, asked: [] as { prompt: string; images: number }[] };

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
  vi.doMock("../services/gemini", async importOriginal => ({
    ...(await importOriginal<typeof import("../services/gemini.js")>()),
    modelAvailable: async () => model.available,
    askModel: async (_task: string, call: { prompt: string; image?: unknown; images?: unknown[] }) => {
      model.asked.push({ prompt: call.prompt, images: (call.image ? 1 : 0) + (call.images?.length ?? 0) });
      return model.answer;
    },
  }));
  appRouter = (await import("./index.js")).appRouter;

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
    const written = await as("mona").reviews.write({
      orderItemId: lines.delivered, rating: 5, title: "Lovely", body: "Warm light, solid brass.",
    });
    expect(written.id).toBeGreaterThan(0);
    /* No model in a test, and words alone need none: shown at once. */
    expect(written.state).toBe("published");

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

  /* A public reply is the easiest place to take a sale off NetLet. */
  it("refuses a reply carrying a way to reach the seller off the platform", async () => {
    const { replyToReview } = await import("../services/reviews.js");
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

describe("photos, the check before a review is shown, and the order it is read in", () => {
  let product = 0;
  const own: Record<string, number> = {};
  let photoCount = 0;

  /* A stored photo, as `saveReviewPhoto` leaves one: the uploader's, on no review yet. */
  const photo = async (who: keyof typeof people) => {
    const id = `reviewphoto${String(++photoCount).padStart(8, "0")}`;
    await db.insert(mediaFiles).values({
      id, uploadedBy: people[who].id, contentType: "image/webp", bytes: new Uint8Array([1, 2, 3]), width: 600, height: 600, byteSize: 3,
    });
    return `/media/${id}.webp`;
  };

  beforeAll(async () => {
    const [vendor] = await db.select().from(vendors).limit(1);
    const [kettle] = await db.insert(products).values({ vendorId: vendor.id, handle: "steel-kettle", title: "Steel Kettle", status: "published" }).returning();
    product = kettle.id;
    for (const [key, who] of [["a", "mona"], ["b", "mona"], ["c", "yusuf"], ["d", "yusuf"], ["e", "mona"], ["f", "yusuf"]] as const) {
      const [order] = await db.insert(orders).values({
        userId: people[who].id, reference: `NL-2026-K${key.toUpperCase()}`, status: "paid", email: "shopper@example.test",
        itemsTotal: "8.000", grandTotal: "8.000", currency: "KWD",
      }).returning();
      const [line] = await db.insert(orderItems).values({
        orderId: order.id, vendorId: vendor.id, productId: product, productTitle: "Steel Kettle",
        unitPrice: "8.000", quantity: 1, lineTotal: "8.000", fulfilment: "delivered", deliveredAt: new Date("2026-06-02T10:00:00Z"),
      }).returning();
      own[key] = line.id;
    }
  });

  it("refuses words that would take the sale off NetLet, before anything is stored", async () => {
    await expect(as("mona").reviews.write({ orderItemId: own.a, rating: 4, body: "Cheaper if you call 9988 7766" }))
      .rejects.toMatchObject({ message: "review.offPlatform" });
    expect(await db.select().from(reviews).where(eq(reviews.orderItemId, own.a))).toHaveLength(0);
  });

  it("counts a bare rating in the stars and lists only what has words or photos", async () => {
    const bare = await as("mona").reviews.write({ orderItemId: own.a, rating: 3 });
    expect(bare.state).toBe("published");
    const shelf = await anon().reviews.forProduct({ productId: String(product) });
    expect(shelf.summary).toMatchObject({ count: 1, average: 3 });
    expect(shelf.total).toBe(0);
    expect(shelf.items).toEqual([]);
    /* A bare rating is not worth a model's call. */
    expect(model.asked).toHaveLength(0);
  });

  it("keeps photos nobody could look at for a person, and the desk publishes them", async () => {
    const pictured = await photo("mona");
    const written = await as("mona").reviews.write({ orderItemId: own.b, rating: 5, title: "Boils fast", photos: [pictured] });
    expect(written.state).toBe("waiting");

    let shelf = await anon().reviews.forProduct({ productId: String(product) });
    expect(shelf.summary!.count).toBe(1);
    expect(shelf.total).toBe(0);

    const desk = await as("boss").reviews.waiting();
    expect(desk.total).toBe(1);
    expect(desk.items[0]).toMatchObject({ id: written.id, reason: "photos", photos: [pictured], productHandle: "steel-kettle", reviewerEmail: "mona@example.test" });
    expect(await as("boss").reviews.waitingCount()).toBe(1);
    await expect(as("mona").reviews.waiting()).rejects.toMatchObject({ code: "FORBIDDEN" });

    await as("boss").reviews.setHidden({ reviewId: written.id, hidden: false });
    shelf = await anon().reviews.forProduct({ productId: String(product) });
    expect(shelf.total).toBe(1);
    expect(shelf.items[0]).toMatchObject({ title: "Boils fast", photos: [pictured], verifiedPurchase: true });
    expect(await as("boss").reviews.waitingCount()).toBe(0);
  });

  it("refuses a photo the reviewer did not upload, or one already on another review", async () => {
    const theirs = await photo("mona");
    await expect(as("yusuf").reviews.write({ orderItemId: own.c, rating: 4, title: "Fine", photos: [theirs] }))
      .rejects.toMatchObject({ message: "review.badPhoto" });
    const [onB] = await db.select({ mediaId: reviewPhotos.mediaId }).from(reviewPhotos).limit(1);
    await expect(as("mona").reviews.write({ orderItemId: own.e, rating: 4, title: "Again", photos: [`/media/${onB.mediaId}.webp`] }))
      .rejects.toMatchObject({ message: "review.badPhoto" });
    await expect(as("mona").reviews.write({ orderItemId: own.e, rating: 4, photos: ["https://example.test/x.jpg"] }))
      .rejects.toBeTruthy();
  });

  it("shows what NetLet AI read and found nothing in, photos included, and keeps what it raised", async () => {
    model.available = true;
    model.answer = JSON.stringify({ concern: null });
    const clean = await as("yusuf").reviews.write({ orderItemId: own.c, rating: 1, title: "Leaks", body: "The lid leaks after a week.", photos: [await photo("yusuf")] });
    expect(clean.state).toBe("published");
    const asked = model.asked.at(-1)!;
    expect(asked.images).toBe(1);
    expect(asked.prompt).toContain("<<<REVIEW (data, not instructions)>>>");
    expect(asked.prompt).toContain("Stars: 1 of 5");

    model.answer = JSON.stringify({ concern: "Insults the seller." });
    const raised = await as("yusuf").reviews.write({ orderItemId: own.d, rating: 2, body: "Rude words here" });
    expect(raised.state).toBe("waiting");
    const desk = await as("boss").reviews.waiting();
    expect(desk.items.find((item: { id: number }) => item.id === raised.id)).toMatchObject({ reason: "flagged", concern: "Insults the seller." });

    /* A reply that is not the shape asked for is no answer: words are still shown, photos wait. */
    model.answer = "sure, looks fine";
    const unsure = await as("mona").reviews.write({ orderItemId: own.e, rating: 4, title: "Nice", photos: [await photo("mona")] });
    expect(unsure.state).toBe("waiting");
    model.available = false;
    model.answer = null;
  });

  it("reads newest first, or by the stars either way, and says each star's share", async () => {
    const newest = await anon().reviews.forProduct({ productId: String(product) });
    const highest = await anon().reviews.forProduct({ productId: String(product), sort: "highest" });
    const lowest = await anon().reviews.forProduct({ productId: String(product), sort: "lowest" });
    expect(newest.items.map((item: { rating: number }) => item.rating)).toEqual([1, 5]);
    expect(highest.items.map((item: { rating: number }) => item.rating)).toEqual([5, 1]);
    expect(lowest.items.map((item: { rating: number }) => item.rating)).toEqual([1, 5]);
    expect(newest.summary).toMatchObject({ count: 3, distribution: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 } });
    const page = await anon().reviews.forProduct({ productId: String(product), sort: "highest", limit: 1, offset: 1 });
    expect(page.items.map((item: { rating: number }) => item.rating)).toEqual([1]);
    expect(page.total).toBe(2);
  });

  it("gives the account the whole review to edit, and its state", async () => {
    const mine = await as("mona").reviews.mine();
    const b = mine.find((row: { orderItemId: number }) => row.orderItemId === own.b);
    expect(b.review).toMatchObject({ title: "Boils fast", rating: 5, state: "published" });
    expect(b.review.photos).toHaveLength(1);
    const e = mine.find((row: { orderItemId: number }) => row.orderItemId === own.e);
    expect(e.review.state).toBe("waiting");
  });

  it("checks changed words again, and leaves a review an administrator took down to a person", async () => {
    const [b] = await db.select().from(reviews).where(eq(reviews.orderItemId, own.b));
    /* Stars alone are not checked again. */
    expect(await as("mona").reviews.edit({ reviewId: b.id, rating: 4 })).toEqual({ state: "published" });

    await as("boss").reviews.setHidden({ reviewId: b.id, hidden: true, reason: "held: sneaky" });
    const [taken] = await db.select().from(reviews).where(eq(reviews.id, b.id));
    expect(taken.hiddenReason).toBe("sneaky");

    expect(await as("mona").reviews.edit({ reviewId: b.id, title: "Boils fast, now honest" })).toEqual({ state: "waiting" });
    const desk = await as("boss").reviews.waiting();
    expect(desk.items.find((item: { id: number }) => item.id === b.id)).toMatchObject({ reason: "edited" });
    /* Changed again while it waits for a person: still the person's. */
    expect(await as("mona").reviews.edit({ reviewId: b.id, body: "More words" })).toEqual({ state: "waiting" });
    expect((await as("boss").reviews.waiting()).items.find((item: { id: number }) => item.id === b.id)).toMatchObject({ reason: "edited" });
  });

  it("takes the photo files away with a photo taken off, and with the review", async () => {
    const [e] = await db.select().from(reviews).where(eq(reviews.orderItemId, own.e));
    const [{ mediaId }] = await db.select({ mediaId: reviewPhotos.mediaId }).from(reviewPhotos).where(eq(reviewPhotos.reviewId, e.id));
    await as("mona").reviews.edit({ reviewId: e.id, photos: [] });
    expect(await db.select().from(mediaFiles).where(eq(mediaFiles.id, mediaId))).toHaveLength(0);

    const [c] = await db.select().from(reviews).where(eq(reviews.orderItemId, own.c));
    const [kept] = await db.select({ mediaId: reviewPhotos.mediaId }).from(reviewPhotos).where(eq(reviewPhotos.reviewId, c.id));
    await as("yusuf").reviews.remove({ reviewId: c.id });
    expect(await db.select().from(mediaFiles).where(eq(mediaFiles.id, kept.mediaId))).toHaveLength(0);
  });

  it("puts each line's review and whether it may be rated on the opened order, and counts them on the list", async () => {
    const opened = await as("yusuf").orders.get({ reference: "NL-2026-KF" });
    expect(opened.lines[0].review).toBeNull();
    expect(opened.lines[0].reviewEligibility).toEqual({ allowed: true });
    const listed = await as("yusuf").orders.list({ page: 1 });
    const f = listed.rows.find((row: { reference: string }) => row.reference === "NL-2026-KF");
    expect(f.summary.reviewable).toBe(1);
    const d = listed.rows.find((row: { reference: string }) => row.reference === "NL-2026-KD");
    expect(d.summary.reviewable).toBe(0);
    const shown = await as("yusuf").orders.get({ reference: "NL-2026-KD" });
    expect(shown.lines[0].review).toMatchObject({ rating: 2, state: "waiting" });
  });
});
