/**
 * The co-pilot's server half against a real Postgres: what each person is
 * told (a store its own shelf and money, staff no money, NetLet's inbox only to
 * an administrator), and when a question reaches the model at all.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderItems, orders, products, productVariants, supportConversations, supportMessages, users, vendors } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let copilot: typeof import("./copilot");
const ask = vi.fn<(task: string, request: { system: string; prompt: string }) => Promise<string | null>>();
let gateway = true;
const ids = { acme: 0, other: 0, lampVariant: 0, theirVariant: 0, shopper: 0 };
const NOW = new Date("2026-10-12T07:00:00Z");

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", () => ({ getDb: async () => db }));
  vi.doMock("./gemini", () => ({ askModel: (task: string, request: { system: string; prompt: string }) => ask(task, request) }));
  vi.doMock("./aiGateway", () => ({ gatewayAvailable: async () => gateway }));
  copilot = await import("./copilot");

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@netlet.test" }).returning();
  ids.acme = acme.id; ids.other = other.id; ids.shopper = shopper.id;
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Brass lamp", status: "published" }).returning();
  const [theirs] = await db.insert(products).values({ vendorId: other.id, handle: "theirs", title: "Their kettle", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, price: "10.000", stock: 2, lowStockAt: 5 }).returning();
  const [theirVariant] = await db.insert(productVariants).values({ productId: theirs.id, price: "5.000", stock: 0 }).returning();
  ids.lampVariant = lampVariant.id; ids.theirVariant = theirVariant.id;
  for (let day = 1; day <= 4; day++) {
    const [order] = await db.insert(orders).values({
      reference: `NL-COPILOT-${day}`, email: "c@example.test", status: "paid", userId: shopper.id,
      placedAt: new Date(NOW.getTime() - day * 86_400_000),
      itemsTotal: "30.000", deliveryTotal: "0.000", grandTotal: "30.000", commissionTotal: "0.000",
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, vendorId: acme.id, productId: lamp.id, variantId: lampVariant.id, vendorName: "Acme", productTitle: "Brass lamp",
      unitPrice: "10.000", quantity: 3, lineTotal: "30.000", commissionAmount: "0.000", vendorNet: "30.000", fulfilment: "delivered",
    });
  }
  const [conversation] = await db.insert(supportConversations).values({ userId: shopper.id, topic: "delivery", lastMessageAt: new Date(NOW.getTime() - 5 * 3_600_000) }).returning();
  await db.insert(supportMessages).values([
    { conversationId: conversation.id, author: "shopper", body: "Where is my parcel? Call me on 99887766" },
  ]);
}, 60_000);

beforeEach(() => {
  ask.mockReset();
  gateway = true;
});

const manager = () => ({ kind: "vendor" as const, userId: 2, vendorId: ids.acme, role: "manager" as const });
const staff = () => ({ kind: "vendor" as const, userId: 3, vendorId: ids.acme, role: "staff" as const });
const admin = { kind: "admin" as const, userId: 1 };

describe("what the co-pilot is told", () => {
  it("tells a store's manager its own shelf and money, and nothing of NetLet's inbox", async () => {
    const facts = await copilot.copilotFacts(manager(), NOW);
    expect(facts.sales?.total).toBe("120.000");
    expect(facts.stock.lowest.map(shelf => shelf.product)).toEqual(["Brass lamp"]);
    expect(facts.stock.lowest[0]).toMatchObject({ soldLast28: 12, daysOfCover: 4, suggestedReorderAt: 6 });
    expect(facts.inquiries).toBeUndefined();
    expect(facts.pages).not.toContain("/admin/support");
    expect(JSON.stringify(facts)).not.toContain("Their kettle");
  });

  it("tells staff the shelf and not the money", async () => {
    const facts = await copilot.copilotFacts(staff(), NOW);
    expect(facts.sales).toBeUndefined();
    expect(facts.stock.lowest).toHaveLength(1);
  });

  it("tells an administrator what waits, with a customer's words withheld when they carry contact details", async () => {
    const facts = await copilot.copilotFacts(admin, NOW);
    expect(facts.inquiries).toEqual([{ topic: "delivery", waitingHours: 5, lastMessage: "[withheld: it carries contact details]" }]);
    expect(facts.waiting).toContainEqual(expect.objectContaining({ page: "/admin/support", count: 1 }));
    expect(facts.stock.out).toBe(1);
  });

  it("gives a brief with no model at all", async () => {
    gateway = false;
    const brief = await copilot.copilotBrief(manager(), NOW);
    expect(brief.ask).toBe(false);
    expect(brief.insights.find(insight => insight.key === "copilot.insight.runningOut")).toMatchObject({
      params: { product: "Brass lamp", days: 4 },
      action: { kind: "reorder", variantId: ids.lampVariant, level: 6 },
    });
  });
});

describe("a question", () => {
  it("is answered from the facts, keeping only acts this person may take", async () => {
    ask.mockResolvedValueOnce("Restock the brass lamp.\n[[do: reorder variant=" + ids.lampVariant + " level=6]]\n[[do: reorder variant=" + ids.theirVariant + " level=6]]\n[[do: open page=/admin/finance]]");
    const answer = await copilot.askCopilot(manager(), { turns: [{ role: "admin", text: "What should I restock?" }], locale: "en" }, NOW);
    expect(answer).toEqual({ kind: "answer", text: "Restock the brass lamp.", actions: [{ kind: "reorder", variantId: ids.lampVariant, level: 6, product: "Brass lamp" }] });
    const [task, request] = ask.mock.calls[0];
    expect(task).toBe("adminCopilot");
    expect(request.prompt).toContain("Brass lamp");
    expect(request.prompt).not.toContain("Their kettle");
  });

  it("never reaches the model with contact details, or with NetLet AI off", async () => {
    expect(await copilot.askCopilot(manager(), { turns: [{ role: "admin", text: "email noura@example.com" }], locale: "en" }, NOW)).toEqual({ kind: "refused", reason: "copilot.contact" });
    gateway = false;
    expect(await copilot.askCopilot(manager(), { turns: [{ role: "admin", text: "How is it going?" }], locale: "en" }, NOW)).toEqual({ kind: "unavailable" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("is not a courier's to ask", async () => {
    await expect(copilot.askCopilot({ kind: "courier", userId: 9, courierId: 1 } as never, { turns: [{ role: "admin", text: "Hi" }], locale: "en" }, NOW)).rejects.toThrow(/FORBIDDEN/);
  });
});
