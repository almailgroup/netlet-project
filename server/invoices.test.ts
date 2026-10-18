/**
 * Invoices and credit notes, through the API against a real Postgres (3.6.6).
 *
 * The arithmetic is proved pure in `Shared/commerce/invoice.test.ts`. What
 * needs a database is the series — gap-free, one per order however often it is
 * asked for — that a document is issued at the moment the money moves, that a
 * refund adds a credit note rather than editing anything, and who may read one.
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
  invoiceCounters,
  invoices,
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
let invoicesModule: typeof import("./invoices.js");

type Who = "shopper" | "stranger" | "admin" | "manager";
const people = {} as Record<Who, User>;
const ids = { sofa: 0, mug: 0 };

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const as = (who: Who) => appRouter.createCaller(contextFor(people[who]));
const year = new Date(Date.now() + 3 * 3_600_000).getUTCFullYear();

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
  invoicesModule = await import("./invoices.js");

  for (const who of ["shopper", "stranger", "admin", "manager"] as Who[]) {
    const [row] = await db.insert(users).values({ email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}) }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved", licenceNumber: "MOCI-77", deliveryFlat: "2.000" }).returning();
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: people.manager.id, role: "manager" });
  const product = async (handle: string, price: string) => {
    const [row] = await db.insert(products).values({ vendorId: acme.id, handle, title: handle, titleAr: `${handle}-ar`, status: "published" }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 50 }).returning();
    return variant.id;
  };
  ids.sofa = await product("sofa", "240.000");
  ids.mug = await product("mug", "4.000");
}, 60_000);

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
});

/** A cash order of a sofa and two mugs, placed by the shopper and not yet paid. */
async function placed() {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people.shopper.id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofa, quantity: 1 },
    { cartId: cart.id, variantId: ids.mug, quantity: 2 },
  ]);
  const result = await ordersModule.placeOrder(cart.id, {
    email: people.shopper.email, userId: people.shopper.id, contactName: "Noura Shopper",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
  });
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, result.order.id));
  return { id: result.order.id, reference: result.order.reference, grandTotal: result.order.grandTotal, lines };
}

const collect = (orderId: number) => as("manager").orders.markCollected({ orderId });

describe("what a shopper's order says", () => {
  /* The rows are NetLet's record of a sale; the commission, the seller's net,
     the affiliate's rate and the driver are not the shopper's to read. */
  it("carries no seller's or NetLet's commercial terms", async () => {
    const order = await placed();
    const detail = await as("shopper").orders.get({ reference: order.reference });
    expect(detail.order).not.toHaveProperty("commissionTotal");
    expect(detail.order).not.toHaveProperty("affiliateRate");
    for (const line of detail.lines) {
      for (const key of ["commissionPercent", "commissionFixed", "commissionAmount", "vendorNet", "carriedBy", "courierId"]) {
        expect(line).not.toHaveProperty(key);
      }
    }
    expect(detail.lines[0]).toHaveProperty("lineTotal");

    const page = await as("shopper").orders.list({});
    expect(page.rows[0]).not.toHaveProperty("commissionTotal");
    expect(page.rows[0]).toHaveProperty("owed");
  });
});

describe("issuing", () => {
  it("issues nothing before the money is collected", async () => {
    const order = await placed();
    expect((await as("shopper").orders.get({ reference: order.reference })).documents).toEqual([]);
    expect(await db.select().from(invoices)).toEqual([]);
  });

  it("issues the invoice when the cash is recorded, for exactly what was collected", async () => {
    const order = await placed();
    expect((await collect(order.id)).recorded).toBe(true);

    const [row] = await db.select().from(invoices);
    expect(row).toMatchObject({ number: `INV-${year}-000001`, kind: "invoice", orderId: order.id });
    const document = row.document as import("../Shared/commerce/invoice.js").InvoiceDocument;
    expect(document.paidWith.cash).toBe(order.grandTotal);
    expect(document).toMatchObject({ orderReference: order.reference, goods: "248.000", buyer: { name: "Noura Shopper" } });
    expect(document.sellers).toEqual([expect.objectContaining({ name: "Acme", nameAr: "أكمي", licence: "MOCI-77" })]);
    expect(document.sellers[0].lines.map(line => line.titleAr)).toEqual(["sofa-ar", "mug-ar"]);

    const detail = await as("shopper").orders.get({ reference: order.reference });
    expect(detail.documents).toEqual([expect.objectContaining({ number: `INV-${year}-000001`, kind: "invoice", total: "250.000" })]);
  });

  it("leaves off a line cancelled before collection", async () => {
    const order = await placed();
    const mug = order.lines.find(line => line.productTitle === "mug")!;
    await as("manager").orders.setFulfilment({ lineId: mug.id, fulfilment: "cancelled" });
    await collect(order.id);
    const [row] = await db.select().from(invoices);
    const document = row.document as import("../Shared/commerce/invoice.js").InvoiceDocument;
    expect(document.sellers[0].lines.map(line => line.title)).toEqual(["sofa"]);
    expect(document).toMatchObject({ goods: "240.000", total: "242.000" });
  });

  it("numbers without gaps and never twice for one order, however often it is asked", async () => {
    const first = await placed();
    const second = await placed();
    await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date() });
    /* Three racing issues for one order, then the other. */
    const raced = await Promise.all([1, 2, 3].map(() => invoicesModule.issueInvoice(first.id)));
    expect(new Set(raced.map(issued => issued?.number)).size).toBe(1);
    await invoicesModule.issueInvoice(second.id);
    expect((await db.select({ number: invoices.number }).from(invoices)).map(row => row.number).sort())
      .toEqual([`INV-${year}-000001`, `INV-${year}-000002`]);
    expect(await db.select().from(invoiceCounters)).toEqual([{ series: `INV-${year}`, last: 2 }]);
  });

  it("issues one a write missed, the next time the order is read", async () => {
    const order = await placed();
    /* Paid by a path that did not issue — or before invoices existed. */
    await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date() }).where(eq(orders.id, order.id));
    expect((await as("shopper").orders.get({ reference: order.reference })).documents).toHaveLength(1);
  });

  it("keeps an invoiced order: it cannot be deleted out from under its invoice", async () => {
    const order = await placed();
    await collect(order.id);
    await expect(db.delete(orders).where(eq(orders.id, order.id))).rejects.toThrow();
  });
});

describe("refunds", () => {
  it("add a credit note against the invoice and never edit it", async () => {
    const order = await placed();
    await collect(order.id);
    const mug = order.lines.find(line => line.productTitle === "mug")!;
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, order.id));
    const [invoiceBefore] = await db.select().from(invoices);

    await as("shopper").orders.requestReturn({ reference: order.reference, orderItemId: mug.id, kind: "refund", reason: "damaged" });
    const [request] = await db.select().from(returnRequests);
    await as("manager").returns.collect({ requestId: request.id });
    await as("manager").returns.receive({ requestId: request.id, restock: true });

    const rows = await db.select().from(invoices).orderBy(invoices.id);
    expect(rows.map(row => [row.number, row.kind, row.total])).toEqual([
      [`INV-${year}-000001`, "invoice", "250.000"],
      [`CRN-${year}-000001`, "credit_note", "8.000"],
    ]);
    expect(rows[1].creditsInvoiceId).toBe(rows[0].id);
    expect(rows[0].document).toEqual(invoiceBefore.document);

    const read = await as("shopper").invoices.get({ number: `INV-${year}-000001` });
    expect(read.credits).toEqual([expect.objectContaining({ number: `CRN-${year}-000001`, total: "8.000" })]);
    const credit = await as("shopper").invoices.get({ number: `CRN-${year}-000001` });
    expect(credit.document).toMatchObject({ kind: "credit_note", credits: { invoiceNumber: `INV-${year}-000001` } });

    /* Reading the order again does not mint a second one. */
    await as("shopper").orders.get({ reference: order.reference });
    expect(await db.select().from(invoices)).toHaveLength(2);
  });

  it("send no invoice with an exchange's replacement, which nobody paid for", async () => {
    const order = await placed();
    await collect(order.id);
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, order.id));
    const mug = order.lines.find(line => line.productTitle === "mug")!;
    await as("shopper").orders.requestReturn({ reference: order.reference, orderItemId: mug.id, kind: "exchange", reason: "defective" });
    const [request] = await db.select().from(returnRequests);
    await as("manager").returns.collect({ requestId: request.id });
    const reply = await as("manager").returns.receive({ requestId: request.id, restock: false });
    expect(reply.outcome).toBe("exchanged");
    expect((await as("shopper").orders.get({ reference: reply.replacementReference })).documents).toEqual([]);
    expect(await db.select().from(invoices)).toHaveLength(1);
  });
});

describe("reading", () => {
  it("is the shopper's and an administrator's, and 'not found' for anybody else", async () => {
    const order = await placed();
    await collect(order.id);
    const number = `INV-${year}-000001`;
    expect((await as("shopper").invoices.get({ number })).document.number).toBe(number);
    expect((await as("admin").invoices.get({ number })).document.number).toBe(number);
    await expect(as("stranger").invoices.get({ number })).rejects.toMatchObject({ code: "NOT_FOUND" });
    /* The seller included: the invoice names every seller and the buyer's address. */
    await expect(as("manager").invoices.get({ number })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("shopper").invoices.get({ number: "INV-2026-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists every document for an administrator, paged and searchable, and nobody else", async () => {
    const first = await placed();
    const second = await placed();
    await collect(first.id);
    await collect(second.id);
    const page = await as("admin").invoices.list({});
    expect(page.total).toBe(2);
    expect(page.rows.map((row: { number: string }) => row.number)).toEqual([`INV-${year}-000002`, `INV-${year}-000001`]);
    const found = await as("admin").invoices.list({ query: second.reference.toLowerCase() });
    expect(found.rows).toEqual([expect.objectContaining({ orderReference: second.reference })]);
    await expect(as("manager").invoices.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("verifying a printed document", () => {
  it("confirms a genuine one to anybody, showing only what the paper shows", async () => {
    const order = await placed();
    await collect(order.id);
    const number = `INV-${year}-000001`;
    const { verifyCode } = await as("shopper").invoices.get({ number });
    expect(verifyCode).toMatch(/^[A-Z0-9]{10}$/);

    const anybody = appRouter.createCaller(contextFor(null));
    const verified = await anybody.invoices.verify({ number, code: verifyCode.toLowerCase() });
    expect(verified).toMatchObject({ number, kind: "invoice", total: "250.000", issuerName: "NetLet", sellers: ["Acme"], corrected: false });
    expect(JSON.stringify(verified)).not.toContain("Noura");
    expect(JSON.stringify(verified)).not.toContain("Block 4");
  });

  it("gives one answer for a wrong code and for a number that does not exist", async () => {
    const order = await placed();
    await collect(order.id);
    const anybody = appRouter.createCaller(contextFor(null));
    expect(await anybody.invoices.verify({ number: `INV-${year}-000001`, code: "WRONGCODE2" })).toBeNull();
    expect(await anybody.invoices.verify({ number: `INV-${year}-999999`, code: "WRONGCODE2" })).toBeNull();
  });

  it("gives a code to a document issued before codes existed, once", async () => {
    const order = await placed();
    await collect(order.id);
    await db.update(invoices).set({ verifyCode: null });
    const first = await as("shopper").invoices.get({ number: `INV-${year}-000001` });
    const second = await as("admin").invoices.get({ number: `INV-${year}-000001` });
    expect(first.verifyCode).toMatch(/^[A-Z0-9]{10}$/);
    expect(second.verifyCode).toBe(first.verifyCode);
  });
});

