/**
 * Affiliate marketing, through the API against a real Postgres (3.7).
 *
 * The arithmetic is proved pure in `Shared/commerce/affiliate.test.ts`. What
 * needs a database is who an order may be attributed to, that the share is
 * paid once when the cash is collected and taken back once when a line is
 * refunded, and that it lives in its own pot of the referral ledger.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  affiliates,
  auditLog,
  featureSwitches,
  invoiceCounters,
  invoices,
  pointEntries,
  orderItems,
  orders,
  productVariants,
  products,
  returnRequests,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let ordersModule: typeof import("./orders.js");

type Who = "shopper" | "stranger" | "admin" | "manager" | "creator";
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
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({
    ...(await importOriginal<typeof import("./db.js")>()),
    getDb: async () => db,
  }));
  appRouter = (await import("../routes/index.js")).appRouter;
  ordersModule = await import("./orders.js");

  for (const who of ["shopper", "stranger", "admin", "manager", "creator"] as Who[]) {
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
  await db.delete(featureSwitches);
  /* The programme starts switched off (nothing is behind it until a shop
     decides to run one), so every case here is a shop that has turned it on. */
  await db.insert(featureSwitches).values({ key: "affiliates", enabled: true });
  await db.delete(pointEntries);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(affiliates);
  await db.delete(cartItems);
  await db.delete(carts);
});


async function placed(code: string | null, buyer: Who = "shopper") {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people[buyer].id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofa, quantity: 1 },
    { cartId: cart.id, variantId: ids.mug, quantity: 2 },
  ]);
  const result = await ordersModule.placeOrder(cart.id, {
    email: people[buyer].email, userId: people[buyer].id, contactName: "Buyer",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
    affiliateCode: code,
  });
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, result.order.id));
  const [order] = await db.select().from(orders).where(eq(orders.id, result.order.id));
  return { order, lines };
}

const collect = (orderId: number) => as("manager").orders.markCollected({ orderId });

/** The creator, applied and approved. */
async function approvedCreator() {
  const dashboard = await as("creator").affiliates.join({ displayName: "Noura Reviews", channel: "instagram.com/noura", acceptDisclosure: true });
  const [row] = await db.select().from(affiliates);
  await as("admin").affiliates.update({ affiliateId: row.id, status: "active" });
  return { code: dashboard.code as string, id: row.id };
}

describe("joining", () => {
  it("needs the disclosure agreed, and starts pending", async () => {
    await expect(as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: false })).rejects.toMatchObject({ message: "affiliate.disclosureRequired" });
    const dashboard = await as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: true });
    expect(dashboard).toMatchObject({ status: "pending", ratePercent: "3.00", balance: "0.000" });
    expect(dashboard.code).toMatch(/^AF/);
  });

  it("cannot reapply out of a suspension", async () => {
    const { id } = await approvedCreator();
    await as("admin").affiliates.update({ affiliateId: id, status: "suspended" });
    expect((await as("creator").affiliates.join({ displayName: "Again", acceptDisclosure: true })).status).toBe("suspended");
  });

  it("is approved, suspended and re-rated by an administrator alone, on the trail", async () => {
    await as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: true });
    const [row] = await db.select().from(affiliates);
    await expect(as("manager").affiliates.update({ affiliateId: row.id, status: "active" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("manager").affiliates.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("admin").affiliates.update({ affiliateId: row.id, ratePercent: "25" })).rejects.toMatchObject({ message: "affiliate.badRate" });
    await as("admin").affiliates.update({ affiliateId: row.id, status: "active", ratePercent: "5" });
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, "affiliate.update"), eq(auditLog.subjectId, row.id)));
    expect(audit).toMatchObject({ subjectId: row.id, before: { status: "pending", ratePercent: "3.00" }, after: { status: "active", ratePercent: "5.00" } });
    expect((await as("admin").affiliates.list()).rows).toEqual([expect.objectContaining({ status: "active", ratePercent: "5.00" })]);
  });

  it("tells a shopper whose link it is only once they are approved", async () => {
    const dashboard = await as("creator").affiliates.join({ displayName: "Noura Reviews", acceptDisclosure: true });
    expect(await appRouter.createCaller(contextFor(null)).affiliates.lookup({ code: dashboard.code })).toBeNull();
    const [row] = await db.select().from(affiliates);
    await as("admin").affiliates.update({ affiliateId: row.id, status: "active" });
    expect(await appRouter.createCaller(contextFor(null)).affiliates.lookup({ code: dashboard.code })).toEqual({ displayName: "Noura Reviews" });
  });
});

describe("earning", () => {
  it("attributes an order to an approved affiliate and freezes the rate", async () => {
    const { code, id } = await approvedCreator();
    const { order } = await placed(code);
    expect(order).toMatchObject({ affiliateId: id, affiliateRate: "3.00" });
    /* A later change of rate does not reach back. */
    await as("admin").affiliates.update({ affiliateId: id, ratePercent: "10" });
    const [again] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(again.affiliateRate).toBe("3.00");
  });

  it("does not attribute to a pending affiliate, to the buyer themselves, or to nonsense", async () => {
    const pending = await as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: true });
    expect((await placed(pending.code)).order.affiliateId).toBeNull();
    /* Approved now: still not on the affiliate's own purchase. */
    const { code } = await approvedCreator();
    expect((await placed(code, "creator")).order.affiliateId).toBeNull();
    expect((await placed("NL0002")).order.affiliateId).toBeNull();
    expect((await placed("AFZZZZZZ")).order.affiliateId).toBeNull();
  });

  it("pays once, when the cash is collected, out of NetLet's cut", async () => {
    const { code } = await approvedCreator();
    const { order, lines } = await placed(code);
    expect(await db.select().from(pointEntries)).toEqual([]);
    await collect(order.id);
    await collect(order.id);
    const entries = await db.select().from(pointEntries);
    /* 3% of 240.000 and of 8.000, each under NetLet's 10% on the line. */
    expect(entries).toEqual([expect.objectContaining({ pot: "affiliate", reason: "affiliate_commission", points: 7200 + 240, orderId: order.id, userId: people.creator.id })]);
    expect(lines.every(line => Number(line.vendorNet) > 0)).toBe(true);
    const dashboard = await as("creator").affiliates.mine();
    expect(dashboard).toMatchObject({ paidOrders: 1, earned: "7.440", balance: "7.440", payout: { ok: true } });
  });

  it("takes back a refunded line's share, exactly, once", async () => {
    const { code } = await approvedCreator();
    const { order, lines } = await placed(code);
    await collect(order.id);
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, order.id));
    const mug = lines.find(line => line.productTitle === "mug")!;
    await as("shopper").orders.requestReturn({ reference: order.reference, orderItemId: mug.id, kind: "refund", reason: "damaged" });
    const [request] = await db.select().from(returnRequests);
    await as("manager").returns.collect({ requestId: request.id });
    await as("manager").returns.receive({ requestId: request.id, restock: true });
    const dashboard = await as("creator").affiliates.mine();
    expect(dashboard).toMatchObject({ earned: "7.440", reversed: "0.240", balance: "7.200" });
  });

  it("is its own pot: not spendable as points, and paid out at face value", async () => {
    const { code } = await approvedCreator();
    const { order } = await placed(code);
    await collect(order.id);
    expect((await as("creator").rewards.mine()).balance).toBe(0);
    const paid = await as("creator").affiliates.payout();
    expect(paid).toEqual({ amount: "7.440" });
    expect((await as("creator").affiliates.mine()).balance).toBe("0.000");
    const owed = await as("admin").rewards.pendingCashOuts({});
    expect(owed).toEqual([expect.objectContaining({ pot: "affiliate", value: "7.440", userId: people.creator.id })]);
    await expect(as("creator").affiliates.payout()).rejects.toMatchObject({ message: "affiliate.notEnough" });
  });
});

describe("the switch", () => {
  it("closes applications and stops new attribution, but still pays an order already attributed", async () => {
    const { code } = await approvedCreator();
    const { order } = await placed(code);
    await as("admin").features.set({ key: "affiliates", enabled: false });
    await expect(as("stranger").affiliates.join({ displayName: "X", acceptDisclosure: true })).rejects.toMatchObject({ message: "features.off" });
    expect((await placed(code)).order.affiliateId).toBeNull();
    await collect(order.id);
    expect((await as("creator").affiliates.mine()).balance).toBe("7.440");
  });
});
