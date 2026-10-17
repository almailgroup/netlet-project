/**
 * Talking to NetLet against a real Postgres (3.5.1).
 *
 * The state machine and the automatic answer are proved pure in
 * `shared/commerce/support.test.ts`. What needs a database is that the answer
 * is built from the shopper's own order and nobody else's, that each side sees
 * what it should, and that answering is NetLet's alone.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cartItems, carts, orderItems, orders, productVariants, products, supportConversations, supportMessages, users, vendors } from "../drizzle/schema.js";
import { MAX_OPEN_CONVERSATIONS } from "../shared/commerce/support.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let support: typeof import("./support.js");
let ordersModule: typeof import("./orders.js");
let drafts: typeof import("./supportDraft.js");
const ids = { noura: 0, fahad: 0, admin: 0, acme: 0, variant: 0 };
let reference = "";

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const seller = (): Actor => ({ kind: "vendor", userId: ids.fahad, vendorId: ids.acme, role: "owner" });

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  vi.stubEnv("AI_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("AI_GATEWAY_SECRET", "k".repeat(48));
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  support = await import("./support.js");
  drafts = await import("./supportDraft.js");
  ordersModule = await import("./orders.js");
  for (const [key, email, role] of [["noura", "noura@shop.test", "user"], ["fahad", "fahad@shop.test", "user"], ["admin", "owner@netlet.test", "admin"]] as const) {
    const [row] = await db.insert(users).values({ email, role }).returning();
    ids[key] = row.id;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  ids.acme = acme.id;
  const [product] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku: "LAMP", price: "20.000", stock: 50 }).returning();
  ids.variant = variant.id;
  const [cart] = await db.insert(carts).values({ id: "cart-support", userId: ids.noura }).returning();
  await db.insert(cartItems).values({ cartId: cart.id, variantId: variant.id, quantity: 2 });
  const placed = await ordersModule.placeOrder(cart.id, { email: "noura@shop.test", userId: ids.noura, contactName: "Noura", contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod" });
  reference = placed.order.reference;
  await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.orderId, placed.order.id));
}, 60_000);

beforeEach(async () => {
  await db.delete(supportMessages);
  await db.delete(supportConversations);
});

describe("asking", () => {
  it("answers at once from the shopper's own order, and says a person will read it", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "delivery", orderReference: reference, body: "Where is my lamp?" });
    const thread = await support.conversationForShopper(ids.noura, id);
    expect(thread.messages.map(message => message.author)).toEqual(["shopper", "automatic"]);
    const answer = thread.messages[1].answer!;
    expect(answer[0]).toEqual({ key: "support.answerOrderStatus", params: { reference, preparing: "0", onTheWay: "1", delivered: "0" } });
    expect(answer.map(part => part.key)).toEqual(["support.answerOrderStatus", "support.answerTrack", "support.answerPerson"]);
  });

  it("will not look up somebody else's order", async () => {
    await expect(support.openConversation(ids.fahad, { topic: "order", orderReference: reference, body: "Hello" })).rejects.toMatchObject({ reason: "support.unknownOrder" });
  });

  it("keeps each shopper's conversations to themselves", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "other", body: "A question" });
    await expect(support.conversationForShopper(ids.fahad, id)).rejects.toMatchObject({ reason: "support.notFound" });
    await expect(support.replyAsShopper(ids.fahad, id, "hijack")).rejects.toMatchObject({ reason: "support.notFound" });
    expect(await support.myConversations(ids.fahad)).toEqual([]);
  });

  it("refuses a blank message and a sixth open conversation", async () => {
    await expect(support.openConversation(ids.noura, { topic: "other", body: "   " })).rejects.toMatchObject({ reason: "support.empty" });
    for (let i = 0; i < MAX_OPEN_CONVERSATIONS; i++) await support.openConversation(ids.noura, { topic: "other", body: `Question ${i}` });
    await expect(support.openConversation(ids.noura, { topic: "other", body: "One more" })).rejects.toMatchObject({ reason: "support.tooManyOpen" });
  });
});

describe("answering", () => {
  it("is NetLet's alone — a seller cannot read the inbox or reply", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "other", body: "Hi" });
    await expect(support.inbox(seller())).rejects.toThrow("FORBIDDEN:support.answer");
    await expect(support.replyAsStaff(seller(), id, "From a seller")).rejects.toThrow("FORBIDDEN:support.answer");
  });

  it("hands the turn back and forth, and the shopper sees the reply as new", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "payment", body: "How do I pay?" });
    expect(await support.waitingOnStaff(admin())).toBe(1);
    await support.conversationForStaff(admin(), id);
    expect(await support.waitingOnStaff(admin())).toBe(0);

    await support.replyAsStaff(admin(), id, "Cash on delivery.", new Date(Date.now() + 1000));
    expect((await support.myConversations(ids.noura))[0]).toMatchObject({ status: "waiting", unread: true });
    expect(await support.unreadForShopper(ids.noura)).toBe(1);
    await support.conversationForShopper(ids.noura, id, new Date(Date.now() + 2000));
    expect(await support.unreadForShopper(ids.noura)).toBe(0);

    await support.replyAsShopper(ids.noura, id, "Thanks, and the receipt?", new Date(Date.now() + 3000));
    expect((await support.inbox(admin())).rows[0]).toMatchObject({ status: "open", unread: true });

    await support.resolveAsShopper(ids.noura, id);
    expect((await support.inbox(admin(), { status: "resolved" })).total).toBe(1);
    /* Writing again reopens it: somebody still typing is not answered. */
    await support.replyAsShopper(ids.noura, id, "One more thing");
    expect((await support.myConversations(ids.noura))[0].status).toBe("open");
  });
});

describe("drafting a reply", () => {
  afterEach(() => vi.unstubAllGlobals());

  /* The AI gateway, as far as the draft can tell: one answer's text. */
  function replying(status: number, content: unknown) {
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      expect(url).toBe("https://gateway.test/api/ai/generate");
      sent.push(JSON.parse(init.body).prompt);
      const body = status === 200 ? { ok: true, data: { text: content } } : { ok: false, error: { code: "model_unavailable", message: "x" } };
      return new Response(JSON.stringify(body), { status });
    }));
    return sent;
  }

  it("sends the conversation and today's facts, and nothing that says who the shopper is", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "delivery", orderReference: reference, body: "Where is my lamp?" });
    await support.replyAsShopper(ids.noura, id, "Or ring me on 99887766", new Date(Date.now() + 1000));
    /* The parcel arrives after the automatic answer was given. */
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.fulfilment, "shipped"));
    try {
      const sent = replying(200, "  It was delivered today.  ");
      expect(await drafts.draftReply(admin(), id)).toEqual({ kind: "draft", text: "It was delivered today." });
      const prompt = sent[0];
      expect(prompt).toContain("delivered: 1");
      expect(prompt).toContain("Where is my lamp?");
      expect(prompt).toContain("message withheld");
      for (const identifying of ["noura", "Noura", "99887766", "+96550000000", "Block 4", reference]) expect(prompt).not.toContain(identifying);
    } finally {
      await db.update(orderItems).set({ fulfilment: "shipped", deliveredAt: null }).where(eq(orderItems.fulfilment, "delivered"));
    }
  });

  it("has nothing to draft once NetLet has answered, and asks nothing of the model", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "other", body: "Hi" });
    await support.replyAsStaff(admin(), id, "Hello!", new Date(Date.now() + 1000));
    const sent = replying(200, "unused");
    expect(await drafts.draftReply(admin(), id)).toEqual({ kind: "nothingToAnswer" });
    expect(sent).toHaveLength(0);
  });

  it("lands every failure on one answer, and is NetLet's alone", async () => {
    const { id } = await support.openConversation(ids.noura, { topic: "other", body: "Hi" });
    replying(500, "boom");
    expect(await drafts.draftReply(admin(), id)).toEqual({ kind: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await drafts.draftReply(admin(), id)).toEqual({ kind: "unavailable" });
    await expect(drafts.draftReply(seller(), id)).rejects.toThrow("FORBIDDEN:support.answer");
    await expect(drafts.draftAvailable(seller())).rejects.toThrow("FORBIDDEN:support.answer");
  });
});
