/**
 * Payout runs, through the API against a real Postgres (3.3.21).
 *
 * The batching is proved pure in `shared/commerce/payoutRuns.test.ts`. What
 * needs a database is that a batch assembles itself from what has come due,
 * that recording it is NetLet's alone and happens once, that a refund after a
 * payout comes off the next one, and that a store sees only its own.
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
  auditLog,
  invoiceCounters,
  invoices,
  payoutRunItems,
  payoutRuns,
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

  for (const who of ["shopper", "stranger", "admin", "manager", "staff", "rival"] as Who[]) {
    const [row] = await db.insert(users).values({ email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}) }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved", licenceNumber: "MOCI-77", deliveryFlat: "2.000" }).returning();
  await db.update(vendors).set({ payoutIban: "KW81CBKU0000000000001234560101" }).where(eq(vendors.id, acme.id));
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.manager.id, role: "manager" },
    { vendorId: acme.id, userId: people.staff.id, role: "staff" },
  ]);
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: beta.id, userId: people.rival.id, role: "owner" });
  const product = async (handle: string, price: string) => {
    const [row] = await db.insert(products).values({ vendorId: acme.id, handle, title: handle, titleAr: `${handle}-ar`, status: "published" }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 50 }).returning();
    return variant.id;
  };
  ids.sofa = await product("sofa", "240.000");
  ids.mug = await product("mug", "4.000");
}, 60_000);

beforeEach(async () => {
  await db.delete(payoutRunItems);
  await db.delete(payoutRuns);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
});


/** A cash order of a sofa and two mugs whose cash was collected `daysAgo` days ago. */
async function collected(daysAgo: number) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people.shopper.id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofa, quantity: 1 },
    { cartId: cart.id, variantId: ids.mug, quantity: 2 },
  ]);
  const result = await ordersModule.placeOrder(cart.id, {
    email: people.shopper.email, userId: people.shopper.id, contactName: "Buyer",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
  });
  await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date(Date.now() - daysAgo * 86_400_000) }).where(eq(orders.id, result.order.id));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, result.order.id));
  const net = lines.reduce((sum, line) => sum + Math.round(Number(line.vendorNet) * 1000), 0);
  return { id: result.order.id, reference: result.order.reference, lines, net: (net / 1000).toFixed(3) };
}

describe("a batch", () => {
  it("assembles itself from what has come due, and waits on what has not", async () => {
    const old = await collected(40);
    await collected(1);
    const [batch] = await as("admin").finance.payoutBatches();
    expect(batch).toMatchObject({ vendorName: "Acme", total: old.net, payable: true, iban: "KW81CBKU0000000000001234560101" });
    expect(batch.lines).toEqual([expect.objectContaining({ reference: old.reference, amount: old.net, kind: "payout" })]);
  });

  it("is a store's own to read, with the account masked, and nobody else's", async () => {
    await collected(40);
    const [mine] = await as("manager").finance.payoutBatches();
    expect(mine.iban).toBe("KW•••• 0101");
    expect(await as("rival").finance.payoutBatches()).toEqual([]);
    await expect(as("staff").finance.payoutBatches()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").finance.payoutBatches()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("recording a payout", () => {
  it("is NetLet's alone, needs the bank's reference, and pays once", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await expect(as("manager").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const run = await as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-1" });
    expect(run.total).toBe(old.net);
    expect(await as("admin").finance.payoutBatches()).toEqual([]);
    await expect(as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-2" })).rejects.toMatchObject({ code: "CONFLICT", message: "payouts.nothingDue" });

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "payout.record"));
    expect(audit).toMatchObject({ subjectId: run.id, after: { total: old.net, bankReference: "TRX-1" } });
  });

  it("cannot be recorded twice by two people pressing at once", async () => {
    await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const results = await Promise.allSettled([
      as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "A" }),
      as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "B" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(payoutRuns)).toHaveLength(1);
  });

  it("takes a refund after the payout off the next batch, and pays nothing while the store owes", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-1" });

    const mug = old.lines.find(line => line.productTitle === "mug")!;
    await db.update(orderItems).set({ fulfilment: "returned" }).where(eq(orderItems.id, mug.id));
    const [after] = await as("admin").finance.payoutBatches();
    expect(after).toMatchObject({ payable: false, total: `-${mug.vendorNet}` });
    expect(after.lines).toEqual([expect.objectContaining({ kind: "clawback", amount: `-${mug.vendorNet}` })]);
    await expect(as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-2" })).rejects.toMatchObject({ message: "payouts.nothingDue" });

    /* The next order to come due pays the difference. */
    const next = await collected(40);
    const [netted] = await as("admin").finance.payoutBatches();
    expect(netted.payable).toBe(true);
    expect(Number(netted.total)).toBeCloseTo(Number(next.net) - Number(mug.vendorNet), 3);
  });

  it("shows up in the history, each order it settled, masked for the store", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await as("admin").finance.recordPayout({ vendorId: batch.vendorId, bankReference: "TRX-9" });
    const theirs = await as("manager").finance.payoutHistory();
    expect(theirs.rows).toEqual([expect.objectContaining({ bankReference: "TRX-9", total: old.net, iban: "KW•••• 0101", lines: [{ reference: old.reference, amount: old.net }] })]);
    expect((await as("rival").finance.payoutHistory()).rows).toEqual([]);
  });
});
