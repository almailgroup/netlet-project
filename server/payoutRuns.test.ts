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
  payoutFiles,
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
  await db.delete(payoutFiles);
  await db.delete(auditLog);
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

/** Prepare a seller's batch and mark it sent at once — the whole of a hand transfer. */
async function pay(vendorId: number, bankReference: string) {
  const run = await as("admin").finance.preparePayout({ vendorId });
  await as("admin").finance.markPayoutSent({ runId: run.id, bankReference });
  return run;
}

describe("preparing and recording a payout", () => {
  it("is NetLet's alone, needs the bank's reference, and pays once", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await expect(as("manager").finance.preparePayout({ vendorId: batch.vendorId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const run = await as("admin").finance.preparePayout({ vendorId: batch.vendorId });
    expect(run.total).toBe(old.net);
    /* Prepared is committed: there is nothing left to prepare. */
    expect(await as("admin").finance.payoutBatches()).toEqual([]);
    await expect(as("admin").finance.preparePayout({ vendorId: batch.vendorId })).rejects.toMatchObject({ code: "CONFLICT", message: "payouts.nothingDue" });

    await expect(as("manager").finance.markPayoutSent({ runId: run.id, bankReference: "TRX-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("admin").finance.markPayoutSent({ runId: run.id, bankReference: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as("admin").finance.markPayoutSent({ runId: run.id, fileId: 1, bankReference: "TRX-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await as("admin").finance.markPayoutSent({ runId: run.id, bankReference: "TRX-1" })).toEqual({ runs: 1, total: old.net });
    await expect(as("admin").finance.markPayoutSent({ runId: run.id, bankReference: "TRX-2" })).rejects.toMatchObject({ code: "CONFLICT", message: "payouts.nothingPrepared" });
    await expect(as("admin").finance.cancelPayout({ runId: run.id })).rejects.toMatchObject({ code: "CONFLICT", message: "payouts.nothingPrepared" });

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "payout.record"));
    expect(audit).toMatchObject({ subjectId: run.id, after: { total: old.net, bankReference: "TRX-1" } });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "payout.prepare"))).toHaveLength(1);
  });

  it("is refused with nowhere valid to send it", async () => {
    await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await db.update(vendors).set({ payoutIban: null }).where(eq(vendors.id, batch.vendorId));
    await expect(as("admin").finance.preparePayout({ vendorId: batch.vendorId })).rejects.toMatchObject({ message: "payouts.noIban" });
    await db.update(vendors).set({ payoutIban: "KW81CBKU0000000000001234560102" }).where(eq(vendors.id, batch.vendorId));
    await expect(as("admin").finance.preparePayout({ vendorId: batch.vendorId })).rejects.toMatchObject({ message: "payouts.badIban" });
    await db.update(vendors).set({ payoutIban: "KW81CBKU0000000000001234560101" }).where(eq(vendors.id, batch.vendorId));
  });

  it("cannot be prepared twice by two people pressing at once", async () => {
    await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const results = await Promise.allSettled([
      as("admin").finance.preparePayout({ vendorId: batch.vendorId }),
      as("admin").finance.preparePayout({ vendorId: batch.vendorId }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(payoutRuns)).toHaveLength(1);
  });

  /*
   * The defect this order of steps fixes. Recording used to recompute the batch
   * when "sent" was pressed — after the money had gone at the page's figure —
   * so an order coming due in between was recorded as paid though nobody sent
   * it, and a refund in between left the seller holding money the ledger said
   * they never got.
   */
  it("records what was frozen, whatever happens between preparing and sending", async () => {
    const first = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const run = await as("admin").finance.preparePayout({ vendorId: batch.vendorId });

    /* While the transfer is at the bank: an order comes due, and a line of the prepared one is refunded. */
    const second = await collected(40);
    const mug = first.lines.find(line => line.productTitle === "mug")!;
    await db.update(orderItems).set({ fulfilment: "returned" }).where(eq(orderItems.id, mug.id));
    expect(await as("admin").finance.markPayoutSent({ runId: run.id, bankReference: "TRX-1" })).toEqual({ runs: 1, total: first.net });

    /* The next batch pays the new order and takes back the refunded mug — the seller did receive it. */
    const [next] = await as("admin").finance.payoutBatches();
    expect(next.lines).toEqual([
      expect.objectContaining({ reference: first.reference, amount: `-${mug.vendorNet}`, kind: "clawback" }),
      expect.objectContaining({ reference: second.reference, amount: second.net, kind: "payout" }),
    ]);
  });

  it("puts a cancelled transfer's money back into the next batch", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const run = await as("admin").finance.preparePayout({ vendorId: batch.vendorId });
    await expect(as("manager").finance.cancelPayout({ runId: run.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await as("admin").finance.cancelPayout({ runId: run.id });
    const [again] = await as("admin").finance.payoutBatches();
    expect(again).toMatchObject({ total: old.net, payable: true });
    expect(await db.select().from(payoutRunItems)).toEqual([]);
    /* Gone from the history: it moved no money. The trail keeps it. */
    expect((await as("admin").finance.payoutHistory()).rows).toEqual([]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "payout.cancel"))).toHaveLength(1);
  });

  it("takes a refund after the payout off the next batch, and pays nothing while the store owes", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    await pay(batch.vendorId, "TRX-1");

    const mug = old.lines.find(line => line.productTitle === "mug")!;
    await db.update(orderItems).set({ fulfilment: "returned" }).where(eq(orderItems.id, mug.id));
    const [after] = await as("admin").finance.payoutBatches();
    expect(after).toMatchObject({ payable: false, total: `-${mug.vendorNet}` });
    expect(after.lines).toEqual([expect.objectContaining({ kind: "clawback", amount: `-${mug.vendorNet}` })]);
    await expect(as("admin").finance.preparePayout({ vendorId: batch.vendorId })).rejects.toMatchObject({ message: "payouts.nothingDue" });

    /* The next order to come due pays the difference. */
    const next = await collected(40);
    const [netted] = await as("admin").finance.payoutBatches();
    expect(netted.payable).toBe(true);
    expect(Number(netted.total)).toBeCloseTo(Number(next.net) - Number(mug.vendorNet), 3);
  });

  it("shows up in the history, being sent and then sent, masked for the store", async () => {
    const old = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const run = await as("admin").finance.preparePayout({ vendorId: batch.vendorId });
    expect((await as("manager").finance.payoutHistory()).rows).toEqual([expect.objectContaining({ status: "prepared", bankReference: null, paidAt: null })]);
    /* The schedule says it is on its way, not that it arrived. */
    expect((await as("manager").finance.payoutsDue({})).find((row: { reference: string }) => row.reference === old.reference)).toMatchObject({ paid: "0.000", sending: old.net });

    await as("admin").finance.markPayoutSent({ runId: run.id, bankReference: "TRX-9" });
    const theirs = await as("manager").finance.payoutHistory();
    expect(theirs.rows).toEqual([expect.objectContaining({ status: "sent", bankReference: "TRX-9", total: old.net, iban: "KW•••• 0101", lines: [{ reference: old.reference, amount: old.net }] })]);
    expect((await as("manager").finance.payoutsDue({})).find((row: { reference: string }) => row.reference === old.reference)).toMatchObject({ paid: old.net, sending: "0.000" });
    expect((await as("rival").finance.payoutHistory()).rows).toEqual([]);
    await expect(as("manager").finance.preparedPayouts()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("bank files", () => {
  async function prepared() {
    const order = await collected(40);
    const [batch] = await as("admin").finance.payoutBatches();
    const run = await as("admin").finance.preparePayout({ vendorId: batch.vendorId });
    return { order, run, vendorId: batch.vendorId as number };
  }

  it("gathers what is waiting once, and is NetLet's alone", async () => {
    const { run } = await prepared();
    await expect(as("manager").finance.makePayoutFile()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("manager").finance.payoutFiles()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const results = await Promise.allSettled([as("admin").finance.makePayoutFile(), as("admin").finance.makePayoutFile()]);
    const made = results.filter(result => result.status === "fulfilled");
    expect(made).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { message: "payouts.nothingPrepared" } });
    const [row] = await db.select().from(payoutRuns).where(eq(payoutRuns.id, run.id));
    expect(row.fileId).toBe((made[0] as PromiseFulfilledResult<{ id: number }>).value.id);
    expect((await as("admin").finance.preparedPayouts()).unfiled).toBe(0);
  });

  it("downloads the same file twice, CSV always, ISO 20022 only once NetLet's account is set", async () => {
    const { run } = await prepared();
    const file = await as("admin").finance.makePayoutFile();
    await expect(as("manager").finance.downloadPayoutFile({ fileId: file.id, format: "csv" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const csv = await as("admin").finance.downloadPayoutFile({ fileId: file.id, format: "csv" });
    expect(csv).toMatchObject({ filename: `${file.reference}.csv`, mimeType: "text/csv" });
    expect(csv.content).toContain(`"Acme","KW81CBKU0000000000001234560101","${run.total}","KWD","NLPO-${run.id}"`);
    expect((await as("admin").finance.downloadPayoutFile({ fileId: file.id, format: "csv" })).content).toBe(csv.content);

    const { ENV } = await import("./_core/env.js");
    ENV.payoutFromName = "";
    await expect(as("admin").finance.downloadPayoutFile({ fileId: file.id, format: "pain001" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "payouts.noDebtorName" });
    expect((await as("admin").finance.payoutFiles()).pain001).toBe("payouts.noDebtorName");
    Object.assign(ENV, { payoutFromName: "NetLet General Trading", payoutFromIban: "KW81CBKU0000000000001234560101", payoutFromBic: "" });
    const xml = await as("admin").finance.downloadPayoutFile({ fileId: file.id, format: "pain001" });
    expect(xml.filename).toBe(`${file.reference}.xml`);
    expect(xml.content).toContain(`<MsgId>${file.reference}</MsgId>`);
    expect(xml.content).toContain(`<InstdAmt Ccy="KWD">${run.total}</InstdAmt>`);
    expect((await as("admin").finance.payoutFiles()).pain001).toBeNull();
    Object.assign(ENV, { payoutFromName: "", payoutFromIban: "" });

    expect(await db.select().from(auditLog).where(eq(auditLog.action, "payout.download"))).toHaveLength(3);
    await expect(as("admin").finance.downloadPayoutFile({ fileId: 999_999, format: "csv" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("drops a cancelled transfer from the file, and marks only what is still waiting", async () => {
    const { run, vendorId } = await prepared();
    const file = await as("admin").finance.makePayoutFile();
    await as("admin").finance.cancelPayout({ runId: run.id });
    await expect(as("admin").finance.downloadPayoutFile({ fileId: file.id, format: "csv" })).rejects.toMatchObject({ message: "payouts.fileEmpty" });
    await expect(as("admin").finance.markPayoutSent({ fileId: file.id, bankReference: "BULK-1" })).rejects.toMatchObject({ message: "payouts.nothingPrepared" });
    const [listed] = (await as("admin").finance.payoutFiles()).rows;
    expect(listed).toMatchObject({ waiting: 0, sent: 0, cancelled: 1, total: "0.000" });

    /* Prepared again, into a second file, which is marked sent whole. */
    const again = await as("admin").finance.preparePayout({ vendorId });
    const second = await as("admin").finance.makePayoutFile();
    expect(await as("admin").finance.markPayoutSent({ fileId: second.id, bankReference: "BULK-2" })).toEqual({ runs: 1, total: again.total });
    const [row] = await db.select().from(payoutRuns).where(eq(payoutRuns.id, again.id));
    expect(row).toMatchObject({ status: "sent", bankReference: "BULK-2", fileId: second.id });
  });

  it("prepares every payable seller at once and names the one it could not", async () => {
    await collected(40);
    const [beta] = await db.select().from(vendors).where(eq(vendors.slug, "beta"));
    const [product] = await db.insert(products).values({ vendorId: beta.id, handle: "beta-lamp", title: "Beta lamp", status: "published" }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", price: "10.000", stock: 5 }).returning();
    const [cart] = await db.insert(carts).values({ id: `cart-beta-${Date.now()}`, userId: people.shopper.id }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: variant.id, quantity: 1 });
    const placed = await ordersModule.placeOrder(cart.id, { email: people.shopper.email, userId: people.shopper.id, contactName: "B", contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod" });
    await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(orders.id, placed.order.id));

    expect(await as("admin").finance.prepareAllPayouts()).toEqual({ prepared: 1, skipped: ["Beta"] });
    expect((await as("admin").finance.payoutBatches()).map((batch: { vendorName: string }) => batch.vendorName)).toEqual(["Beta"]);
    await expect(as("manager").finance.prepareAllPayouts()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
