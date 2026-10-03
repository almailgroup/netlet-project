/**
 * Returns and exchanges, through the API against a real Postgres (3.2.8).
 *
 * The decisions are proved pure in `shared/commerce/returnRequests.test.ts`.
 * What needs a database is who may do what to whose return, that a refund
 * moves the money every report reads, and that an exchange really sends
 * something — so every call goes through the router as the person it is about.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  categories,
  orderItems,
  orders,
  productVariants,
  products,
  returnRequests,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../drizzle/schema.js";
import type { TrpcContext } from "./_core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let ordersModule: typeof import("./orders.js");

type Who = "shopper" | "stranger" | "admin" | "manager" | "staff" | "rival";
const people = {} as Record<Who, User>;
const ids = { acme: 0, beta: 0, sofaVariant: 0, tomatoVariant: 0, mugVariant: 0 };

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
  ordersModule = await import("./orders.js");

  for (const who of ["shopper", "stranger", "admin", "manager", "staff", "rival"] as Who[]) {
    const [row] = await db.insert(users).values({
      email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}),
    }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  ids.acme = acme.id; ids.beta = beta.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.manager.id, role: "manager" },
    { vendorId: acme.id, userId: people.staff.id, role: "staff" },
    { vendorId: beta.id, userId: people.rival.id, role: "owner" },
  ]);
  const [grocery] = await db.insert(categories).values({ slug: "grocery", name: "Grocery" }).returning();

  const product = async (vendorId: number, handle: string, price: string, categoryId: number | null = null) => {
    const [row] = await db.insert(products).values({ vendorId, handle, title: handle, status: "published", categoryId }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 10 }).returning();
    return variant.id;
  };
  ids.sofaVariant = await product(acme.id, "sofa", "240.000");
  ids.tomatoVariant = await product(acme.id, "tomatoes", "0.600", grocery.id);
  ids.mugVariant = await product(beta.id, "mug", "4.000");
}, 60_000);

beforeEach(async () => {
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(productVariants).set({ stock: 10 });
});

/** A paid, delivered order of a sofa, tomatoes and a mug, as the shopper. */
async function delivered() {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people.shopper.id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofaVariant, quantity: 1 },
    { cartId: cart.id, variantId: ids.tomatoVariant, quantity: 2 },
    { cartId: cart.id, variantId: ids.mugVariant, quantity: 1 },
  ]);
  const placed = await ordersModule.placeOrder(cart.id, {
    email: people.shopper.email, userId: people.shopper.id, contactName: "A Shopper",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
  });
  await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, placed.order.id));
  await db.update(orders).set({ status: "paid" }).where(eq(orders.id, placed.order.id));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
  return {
    reference: placed.order.reference,
    orderId: placed.order.id,
    sofa: lines.find(line => line.productTitle === "sofa")!,
    tomatoes: lines.find(line => line.productTitle === "tomatoes")!,
    mug: lines.find(line => line.productTitle === "mug")!,
  };
}

const ask = (who: Who, input: Record<string, unknown>) => as(who).orders.requestReturn(input);

describe("asking", () => {
  it("approves a damaged item at once, and shows it on the order", async () => {
    const order = await delivered();
    const reply = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    expect(reply.status).toBe("approved");
    const detail = await as("shopper").orders.get({ reference: order.reference });
    expect(detail.returns).toEqual([expect.objectContaining({ orderItemId: order.sofa.id, status: "approved", decidedBy: "auto" })]);
  });

  it("declines a change of mind on perishable groceries, and leaves 'other' to the seller", async () => {
    const order = await delivered();
    expect((await ask("shopper", { reference: order.reference, orderItemId: order.tomatoes.id, kind: "refund", reason: "changedMind" })))
      .toMatchObject({ status: "declined", declineReason: "returns.perishableNoChangeOfMind" });
    expect((await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "other", note: "Colour clashes" })).status)
      .toBe("requested");
  });

  it("insists 'other' says something", async () => {
    const order = await delivered();
    await expect(ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "other" }))
      .rejects.toMatchObject({ message: "returns.needsReason" });
  });

  it("refuses a line that is not returnable, saying why", async () => {
    const order = await delivered();
    await db.update(orders).set({ status: "pending_payment" }).where(eq(orders.id, order.orderId));
    await expect(ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" }))
      .rejects.toMatchObject({ message: "returns.blockedUnpaid" });
    await db.update(orders).set({ status: "paid" }).where(eq(orders.id, order.orderId));
    await db.update(orderItems).set({ deliveredAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(orderItems.id, order.sofa.id));
    await expect(ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" }))
      .rejects.toMatchObject({ message: "returns.blockedWindowClosed" });
  });

  /* Not "not yours": an answer that differs would confirm the order exists. */
  it("does not find another shopper's order", async () => {
    const order = await delivered();
    await expect(ask("stranger", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* Two taps on a phone. */
  it("allows one open request per line, enforced by the database", async () => {
    const order = await delivered();
    const input = { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" };
    const results = await Promise.allSettled([ask("shopper", input), ask("shopper", input)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { message: "returns.alreadyOpen" } });
  });

  it("lets the shopper withdraw before collection and not after", async () => {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    await as("shopper").orders.cancelReturn({ requestId: id });
    const { id: again } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    await as("manager").returns.collect({ requestId: again });
    await expect(as("shopper").orders.cancelReturn({ requestId: again })).rejects.toMatchObject({ message: "returns.moved" });
    await expect(as("stranger").orders.cancelReturn({ requestId: again })).rejects.toMatchObject({ message: "returns.moved" });
  });
});

describe("the desk", () => {
  it("shows each store its own returns, and NetLet every one", async () => {
    const order = await delivered();
    await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    await ask("shopper", { reference: order.reference, orderItemId: order.mug.id, kind: "refund", reason: "defective" });
    expect((await as("manager").returns.list()).map((row: { productTitle: string }) => row.productTitle)).toEqual(["sofa"]);
    expect((await as("rival").returns.list()).map((row: { productTitle: string }) => row.productTitle)).toEqual(["mug"]);
    expect(await as("admin").returns.list()).toHaveLength(2);
    expect(await as("manager").returns.waiting()).toBe(1);
  });

  it("is a manager's, not staff's or a shopper's", async () => {
    await expect(as("staff").returns.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").returns.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not find another store's request", async () => {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    await expect(as("rival").returns.collect({ requestId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("decides what a rule could not, and a decline must say why", async () => {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "other", note: "Too big" });
    await expect(as("manager").returns.decide({ requestId: id, approve: false })).rejects.toMatchObject({ message: "returns.needsReason" });
    await as("manager").returns.decide({ requestId: id, approve: false, reason: "Used and marked" });
    const [row] = await db.select().from(returnRequests).where(eq(returnRequests.id, id));
    expect(row).toMatchObject({ status: "declined", decidedBy: "seller", declineReason: "Used and marked" });
  });
});

describe("receiving", () => {
  async function collectedRefund() {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "damaged" });
    await as("manager").returns.collect({ requestId: id });
    return { ...order, id };
  }

  it("refunds the line's frozen total, marks it returned, and restocks only when asked", async () => {
    const order = await collectedRefund();
    await db.update(productVariants).set({ price: "999.000" }).where(eq(productVariants.id, ids.sofaVariant));
    const before = (await db.select().from(productVariants).where(eq(productVariants.id, ids.sofaVariant)))[0].stock;

    const reply = await as("manager").returns.receive({ requestId: order.id, restock: true });
    expect(reply).toEqual({ outcome: "refunded", refundAmount: "240.000", replacementReference: null });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.id, order.sofa.id));
    expect(line.fulfilment).toBe("returned");
    const after = (await db.select().from(productVariants).where(eq(productVariants.id, ids.sofaVariant)))[0].stock;
    expect(after).toBe(before + 1);
    await db.update(productVariants).set({ price: "240.000" }).where(eq(productVariants.id, ids.sofaVariant));
  });

  /* Two presses cannot refund one line twice. */
  it("refunds once when received twice at once", async () => {
    const order = await collectedRefund();
    const results = await Promise.allSettled([
      as("manager").returns.receive({ requestId: order.id, restock: true }),
      as("admin").returns.receive({ requestId: order.id, restock: true }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const stock = (await db.select().from(productVariants).where(eq(productVariants.id, ids.sofaVariant)))[0].stock;
    expect(stock).toBe(10); // took one at sale, restocked one once
  });

  it("records the cash handed back, once", async () => {
    const order = await collectedRefund();
    await as("manager").returns.receive({ requestId: order.id, restock: false });
    expect(await as("manager").returns.waiting()).toBe(1);
    /* The tab and the tile count the same work: cash still owed is to do. */
    expect((await as("manager").returns.list({ open: true })).map((row: { id: number }) => row.id)).toEqual([order.id]);
    await as("manager").returns.refundPaid({ requestId: order.id });
    expect(await as("manager").returns.list({ open: true })).toEqual([]);
    await expect(as("manager").returns.refundPaid({ requestId: order.id })).rejects.toMatchObject({ message: "returns.moved" });
    expect(await as("manager").returns.waiting()).toBe(0);
  });

  it("refunds the whole order once every line has come back", async () => {
    const order = await delivered();
    for (const line of [order.sofa, order.tomatoes]) {
      const { id } = await ask("shopper", { reference: order.reference, orderItemId: line.id, kind: "refund", reason: "damaged" });
      await as("manager").returns.collect({ requestId: id });
      await as("manager").returns.receive({ requestId: id, restock: false });
    }
    expect((await db.select().from(orders).where(eq(orders.id, order.orderId)))[0].status).toBe("paid");
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.mug.id, kind: "refund", reason: "damaged" });
    await as("rival").returns.collect({ requestId: id });
    await as("rival").returns.receive({ requestId: id, restock: false });
    expect((await db.select().from(orders).where(eq(orders.id, order.orderId)))[0].status).toBe("refunded");
  });

  it("sends an exchange as a new, zero-priced, paid order through normal dispatch", async () => {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "exchange", reason: "defective" });
    await as("manager").returns.collect({ requestId: id });
    const reply = await as("manager").returns.receive({ requestId: id, restock: false });
    expect(reply.outcome).toBe("exchanged");

    const [replacement] = await db.select().from(orders).where(eq(orders.reference, reply.replacementReference));
    expect(replacement).toMatchObject({ status: "paid", grandTotal: "0.000", userId: people.shopper.id });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, replacement.id));
    expect(line).toMatchObject({ productTitle: "sofa", lineTotal: "0.000", vendorNet: "0.000", fulfilment: "pending", vendorId: ids.acme });
    /* The original stays sold: the shopper keeps what they paid for, swapped. */
    expect((await db.select().from(orderItems).where(eq(orderItems.id, order.sofa.id)))[0].fulfilment).toBe("delivered");
    expect((await as("shopper").orders.list()).rows.map((row: { reference: string }) => row.reference)).toContain(reply.replacementReference);

    /* The original is still "delivered" and inside its window; it has had its return. */
    await expect(ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "refund", reason: "changedMind" }))
      .rejects.toMatchObject({ message: "returns.alreadyHandled" });
  });

  it("refunds an exchange when there is nothing on the shelf to send", async () => {
    const order = await delivered();
    const { id } = await ask("shopper", { reference: order.reference, orderItemId: order.sofa.id, kind: "exchange", reason: "defective" });
    await as("manager").returns.collect({ requestId: id });
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, ids.sofaVariant));
    const reply = await as("manager").returns.receive({ requestId: id, restock: false });
    expect(reply).toMatchObject({ outcome: "refunded", refundAmount: "240.000" });
    const [row] = await db.select().from(returnRequests).where(eq(returnRequests.id, id));
    expect(row.declineReason).toBe("returns.exchangeOutOfStock");
  });
});

describe("what size returns teach the size guide", () => {
  it("counts too small and too large for the product, and nothing about who", async () => {
    const first = await delivered();
    const second = await delivered();
    await ask("shopper", { reference: first.reference, orderItemId: first.sofa.id, kind: "exchange", reason: "tooSmall" });
    await ask("shopper", { reference: second.reference, orderItemId: second.sofa.id, kind: "refund", reason: "tooLarge" });
    const withdrawn = await delivered();
    const asked = await ask("shopper", { reference: withdrawn.reference, orderItemId: withdrawn.sofa.id, kind: "refund", reason: "tooSmall" });
    await as("shopper").orders.cancelReturn({ requestId: asked.id });

    const anybody = appRouter.createCaller(contextFor(null));
    const productId = String(first.sofa.productId);
    expect(await anybody.returns.fit({ productId })).toEqual({ tooSmall: 1, tooLarge: 1 });
    /* A size return is a change of mind with a reason: approved at once. */
    expect(asked.status).toBe("approved");
    expect(await anybody.returns.fit({ productId: "demo-product-1" })).toEqual({ tooSmall: 0, tooLarge: 0 });
  });
});

