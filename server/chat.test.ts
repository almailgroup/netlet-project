/**
 * Shoppers and sellers talking (3.8), through the API against a real Postgres.
 *
 * What a message may contain is proved pure in
 * `shared/commerce/contactFilter.test.ts`. What needs a database is who can read
 * and write which conversation — a rule about who is asking, so every call goes
 * through the router as that person.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authAttempts,
  conversationMessages,
  conversations,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../drizzle/schema.js";
import type { TrpcContext } from "./_core/context.js";
import { MAX_MESSAGES_PER_ACCOUNT } from "../shared/auth/rateLimit.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;

type Who = "mona" | "stranger" | "admin" | "staff" | "rival";
const people = {} as Record<Who, User>;
const ids = { acme: 0, beta: 0, closed: 0, lamp: 0, kettle: 0, draft: 0, closedLamp: 0, mug: 0, order: 0 };
const REFERENCE = "NL-20261001-QRTVW";

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const as = (who: Who) => appRouter.createCaller(contextFor(people[who]));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("./routers.js")).appRouter;

  const names: Record<Who, string> = { mona: "Mona Al Sabah", stranger: "Stranger", admin: "Boss", staff: "Shop Floor", rival: "Rival" };
  for (const who of Object.keys(names) as Who[]) {
    const [row] = await db.insert(users).values({
      email: `${who}@netlet.test`, name: names[who], ...(who === "admin" ? { role: "admin" } : {}),
    }).returning();
    people[who] = row;
  }

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  const [closed] = await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended" }).returning();
  ids.acme = acme.id; ids.beta = beta.id; ids.closed = closed.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.staff.id, role: "staff" },
    { vendorId: beta.id, userId: people.rival.id, role: "owner" },
  ]);

  const product = async (vendorId: number, handle: string, status: "published" | "draft" = "published") => {
    const [row] = await db.insert(products).values({ vendorId, handle, title: handle, status }).returning();
    await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price: "10.000", stock: 5 });
    return row.id;
  };
  ids.lamp = await product(acme.id, "lamp");
  ids.kettle = await product(acme.id, "kettle");
  ids.draft = await product(acme.id, "draft", "draft");
  ids.closedLamp = await product(closed.id, "closed-lamp");
  ids.mug = await product(beta.id, "mug");

  const [order] = await db.insert(orders).values({
    reference: REFERENCE, userId: people.mona.id, email: people.mona.email, status: "pending_payment",
    itemsTotal: "10.000", grandTotal: "10.000", currency: "KWD",
  }).returning();
  ids.order = order.id;
  await db.insert(orderItems).values({
    orderId: order.id, vendorId: acme.id, vendorName: "Acme", productTitle: "lamp", unitPrice: "10.000",
    quantity: 1, lineTotal: "10.000", commissionPercent: "10.00", commissionAmount: "1.000", vendorNet: "9.000",
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(conversationMessages);
  await db.delete(conversations);
  await db.delete(authAttempts);
});

const ask = (who: Who, input: Record<string, unknown>) => as(who).chat.send(input);

describe("starting a conversation", () => {
  it("opens one thread per shopper and store, whatever product the message is about", async () => {
    const first = await ask("mona", { productId: ids.lamp, body: "Is the lamp brass or plated?" });
    const second = await ask("mona", { productId: ids.kettle, body: "And does the kettle come in white?" });
    expect(second.conversationId).toBe(first.conversationId);

    const thread = await as("mona").chat.thread({ conversationId: first.conversationId });
    expect(thread.messages.map((m: { productTitle: string }) => m.productTitle)).toEqual(["lamp", "kettle"]);
    expect(thread.vendorName).toBe("Acme");
  });

  it("can be about one of the shopper's own orders, with a store whose lines it holds", async () => {
    const { conversationId } = await ask("mona", { orderReference: REFERENCE, vendorId: ids.acme, body: "Where is my order?" });
    const thread = await as("mona").chat.thread({ conversationId });
    expect(thread.messages[0].orderReference).toBe(REFERENCE);

    await expect(ask("mona", { orderReference: REFERENCE, vendorId: ids.beta, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ask("stranger", { orderReference: REFERENCE, vendorId: ids.acme, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not found for a draft, and refused for a suspended store", async () => {
    await expect(ask("mona", { productId: ids.draft, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ask("mona", { productId: ids.closedLamp, body: "hi" })).rejects.toMatchObject({ message: "chat.storeClosed" });
  });

  it("needs something to be about", async () => {
    await expect(ask("mona", { body: "hi" })).rejects.toMatchObject({ message: "chat.needsSubject" });
    await expect(ask("mona", { vendorId: ids.acme, body: "hi" })).rejects.toMatchObject({ message: "chat.needsSubject" });
  });
});

describe("the filter, on the server", () => {
  /* The composer runs the same function; the server cannot rely on that. */
  it("refuses a way off the platform from either side, and stores nothing", async () => {
    await expect(ask("mona", { productId: ids.lamp, body: "whatsapp me on ٩٩٨٨ ٧٧٦٦" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "chat.offPlatform" });
    expect(await db.select().from(conversationMessages)).toHaveLength(0);

    const { conversationId } = await ask("mona", { productId: ids.lamp, body: "Is it in stock?" });
    await expect(as("staff").chat.seller.reply({ conversationId, body: "cheaper if you email noura at gmail dot com" }))
      .rejects.toMatchObject({ message: "chat.offPlatform" });
    expect(await db.select().from(conversationMessages)).toHaveLength(1);
  });

  it("refuses an empty message and an over-long one", async () => {
    await expect(ask("mona", { productId: ids.lamp, body: "   " })).rejects.toMatchObject({ message: "chat.empty" });
    await expect(ask("mona", { productId: ids.lamp, body: "a".repeat(2001) })).rejects.toMatchObject({ message: "chat.tooLong" });
  });

  it("throttles a shopper per account", async () => {
    await db.insert(authAttempts).values(
      Array.from({ length: MAX_MESSAGES_PER_ACCOUNT }, () => ({ bucket: `account:${people.mona.email}`, kind: "chatMessage" })),
    );
    await expect(ask("mona", { productId: ids.lamp, body: "one more" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    /* Somebody else's ceiling is their own. */
    await ask("stranger", { productId: ids.lamp, body: "hello" });
  });
});

describe("who can read and answer", () => {
  it("names the shopper to the store by first name and initial, never by email", async () => {
    const { conversationId } = await ask("mona", { productId: ids.lamp, body: "Hello" });
    const [listed] = await as("staff").chat.seller.list();
    expect(listed.counterpart).toBe("Mona A.");
    const thread = await as("staff").chat.seller.thread({ conversationId });
    expect(thread.shopperName).toBe("Mona A.");
    expect(JSON.stringify({ listed, thread })).not.toContain(people.mona.email);
  });

  it("lets the store's own staff answer, and nobody from another store see it", async () => {
    const { conversationId } = await ask("mona", { productId: ids.lamp, body: "Hello" });
    await as("staff").chat.seller.reply({ conversationId, body: "Yes, in stock." });

    expect(await as("rival").chat.seller.list()).toEqual([]);
    await expect(as("rival").chat.seller.thread({ conversationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("rival").chat.seller.reply({ conversationId, body: "buy mine" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("stranger").chat.thread({ conversationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("stranger").chat.send({ conversationId, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("mona").chat.seller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /* A moderator looking is not the store having answered. */
  it("lets an administrator read every thread without answering or marking anything read", async () => {
    const { conversationId } = await ask("mona", { productId: ids.lamp, body: "Hello" });
    expect(await as("admin").chat.seller.list()).toHaveLength(1);
    await as("admin").chat.seller.thread({ conversationId });
    expect(await as("staff").chat.seller.unread()).toBe(1);
    await expect(as("admin").chat.seller.reply({ conversationId, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unread", () => {
  it("counts replies the shopper has not opened, and clears when they do", async () => {
    const { conversationId } = await ask("mona", { productId: ids.lamp, body: "Hello" });
    expect(await as("mona").chat.unread()).toBe(0);
    expect(await as("staff").chat.seller.unread()).toBe(1);

    await as("staff").chat.seller.thread({ conversationId });
    expect(await as("staff").chat.seller.unread()).toBe(0);

    await as("staff").chat.seller.reply({ conversationId, body: "Yes" });
    await as("staff").chat.seller.reply({ conversationId, body: "Anything else?" });
    expect(await as("mona").chat.unread()).toBe(2);
    const [mine] = await as("mona").chat.mine();
    expect(mine).toMatchObject({ counterpart: "Acme", unread: 2, preview: "Anything else?", previewSide: "seller" });

    await as("mona").chat.thread({ conversationId });
    expect(await as("mona").chat.unread()).toBe(0);
  });
});
