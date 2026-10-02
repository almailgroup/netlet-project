/**
 * Referrals and the points ledger, against a real Postgres.
 *
 * The arithmetic is proved pure in `shared/commerce/referral.test.ts`. What is
 * here is everything that cannot be: that one account can only be referred
 * once however many tabs try, that both tracks are paid exactly once and only
 * when money actually arrives, that a balance cannot be overdrawn by two
 * checkouts racing, and that a spend is handed back when the order it was for
 * does not happen.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems, carts, orderItems, orders as ordersTable, pointEntries, products, productVariants,
  referrals as referralsTable, users, vendors,
  invoices,
} from "../drizzle/schema.js";
import { REFERRED_POINTS, REFERRER_POINTS, referralCodeFor } from "../shared/commerce/referral.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let referral: typeof import("./referral.js");
let orders: typeof import("./orders.js");

const ids = { admin: 0, owner: 0, inviter: 0, friend: 0, stranger: 0, vendor: 0, variant: 0 };

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
  referral = await import("./referral.js");
  orders = await import("./orders.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [inviter] = await db.insert(users).values({ email: "inviter@example.test" }).returning();
  const [friend] = await db.insert(users).values({ email: "friend@example.test" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();

  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved",
  }).returning();
  const [lamp] = await db.insert(products).values({
    vendorId: acme.id, handle: "lamp", title: "Brass Lamp", status: "published",
  }).returning();
  const [variant] = await db.insert(productVariants).values({
    productId: lamp.id, title: "Default", sku: "LAMP-1", price: "12.000", stock: 500,
  }).returning();

  Object.assign(ids, {
    admin: admin.id, owner: owner.id, inviter: inviter.id, friend: friend.id,
    stranger: stranger.id, vendor: acme.id, variant: variant.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(pointEntries);
  await db.delete(referralsTable);
  /* An invoiced order cannot be deleted under its invoice (3.6.6). */
  await db.delete(invoices);
  await db.delete(orderItems);
  await db.delete(ordersTable);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(productVariants).set({ stock: 500 }).where(eq(productVariants.id, ids.variant));
});

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const vendorActor = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.vendor, role: "owner" });

/** A basket of one lamp, ready to be bought. */
async function basket(userId: number, quantity = 1): Promise<string> {
  const [cart] = await db.insert(carts).values({ id: `cart-${userId}-${Date.now()}-${Math.random()}`, userId }).returning();
  await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.variant, quantity });
  return cart.id;
}

async function buy(userId: number, quantity = 1, usePoints = false) {
  return orders.placeOrder(await basket(userId, quantity), {
    email: "friend@example.test",
    userId,
    paymentMethod: "cod",
    addressLine: "Block 4, Street 12, Building 3",
    usePoints,
  });
}

describe("recording who brought whom", () => {
  it("records a referral from a code", async () => {
    expect(await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter))).toBe(true);
  });

  /* The whole of the fraud model that can be enforced without identity. */
  it("refuses somebody referring themselves", async () => {
    expect(await referral.recordReferral(ids.friend, referralCodeFor(ids.friend))).toBe(false);
  });

  it("ignores a code naming nobody rather than failing a registration", async () => {
    expect(await referral.recordReferral(ids.friend, "NLZZZZZZ")).toBe(false);
    expect(await referral.recordReferral(ids.friend, "not a code")).toBe(false);
  });

  /*
   * The index is what enforces this, not a read-then-insert: two tabs are
   * enough to beat a check in application code, and the second credit is money.
   */
  it("lets one account be referred only once, however many try", async () => {
    expect(await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter))).toBe(true);
    expect(await referral.recordReferral(ids.friend, referralCodeFor(ids.stranger))).toBe(false);
    const rows = await db.select().from(referralsTable).where(eq(referralsTable.referredId, ids.friend));
    expect(rows).toHaveLength(1);
    expect(rows[0].referrerId).toBe(ids.inviter);
  });
});

describe("when the points are paid", () => {
  beforeEach(async () => {
    await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter));
  });

  /* A scheme that pays at registration pays for registrations. */
  it("pays nobody for signing up", async () => {
    expect(await referral.pointsBalance(ids.inviter)).toBe(0);
    expect(await referral.pointsBalance(ids.friend)).toBe(0);
  });

  /* Nor for an order that is placed and never collected. */
  it("pays nobody for an order that is only placed", async () => {
    await buy(ids.friend);
    expect(await referral.pointsBalance(ids.inviter)).toBe(0);
  });

  it("pays both tracks when the cash is actually collected", async () => {
    const placed = await buy(ids.friend);
    expect(await orders.recordCashCollected(adminActor(), placed.order.id)).toBe(true);

    expect(await referral.pointsBalance(ids.inviter)).toBe(REFERRER_POINTS);
    expect(await referral.pointsBalance(ids.friend)).toBe(REFERRED_POINTS);
  });

  it("pays once, however many orders follow", async () => {
    const first = await buy(ids.friend);
    await orders.recordCashCollected(adminActor(), first.order.id);
    const second = await buy(ids.friend);
    await orders.recordCashCollected(adminActor(), second.order.id);

    expect(await referral.pointsBalance(ids.inviter)).toBe(REFERRER_POINTS);
  });

  it("pays nobody when somebody who was never referred buys something", async () => {
    const placed = await buy(ids.stranger);
    await orders.recordCashCollected(adminActor(), placed.order.id);
    expect(await referral.pointsBalance(ids.stranger)).toBe(0);
  });
});

describe("spending points", () => {
  beforeEach(async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 6000, reason: "admin_adjustment" });
  });

  it("takes the points off the order and off the balance", async () => {
    /* One lamp at 12.000 plus delivery; 6000 points is KWD 6.000 of it. */
    const placed = await buy(ids.friend, 1, true);
    expect(placed.totals.pointsSpent).toBe(6000);
    expect(placed.totals.pointsValue).toBe("6.000");
    expect(await referral.pointsBalance(ids.friend)).toBe(0);

    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, placed.order.id));
    expect(row.pointsSpent).toBe(6000);
    expect(Number(row.grandTotal)).toBeCloseTo(
      Number(placed.totals.itemsTotal) + Number(placed.totals.deliveryTotal) - 6,
      3,
    );
  });

  /*
   * The seller is paid the same whether or not the shopper spent points: a
   * marketing scheme funded out of somebody else's revenue is one they never
   * agreed to.
   */
  it("comes out of NetLet's cut and never the seller's", async () => {
    const withPoints = await buy(ids.friend, 1, true);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, withPoints.order.id));
    expect(lines[0].vendorNet).toBe(withPoints.lines[0].vendorNet);
    expect(lines[0].lineTotal).toBe("12.000");
  });

  /* Points are a discount, not a deposit. */
  it("never spends more than the order is worth", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 900_000, reason: "admin_adjustment" });
    const placed = await buy(ids.friend, 1, true);
    expect(Number(placed.totals.grandTotal)).toBe(0);
    expect(await referral.pointsBalance(ids.friend)).toBeGreaterThan(0);
  });

  it("leaves the balance alone when the shopper did not ask", async () => {
    const placed = await buy(ids.friend, 1, false);
    expect(placed.totals.pointsSpent).toBe(0);
    expect(await referral.pointsBalance(ids.friend)).toBe(6000);
  });

  /*
   * The race a read-then-insert loses. Both spends read the same balance; the
   * row lock is what makes exactly one of them land.
   */
  it("refuses to overdraw when two spends race", async () => {
    const results = await Promise.allSettled([
      referral.takePoints(db as never, ids.friend, 6000, "spent_on_order"),
      referral.takePoints(db as never, ids.friend, 6000, "spent_on_order"),
    ]);
    const landed = results.filter(r => r.status === "fulfilled" && r.value !== null);
    expect(landed).toHaveLength(1);
    expect(await referral.pointsBalance(ids.friend)).toBe(0);
  });

  /* An order that does not happen must not cost anybody their points. */
  it("hands the points back when the order fails", async () => {
    const cartId = await basket(ids.friend, 1);
    await db.update(productVariants).set({ stock: 0, preorderStock: 0 }).where(eq(productVariants.id, ids.variant));
    await expect(orders.placeOrder(cartId, {
      email: "friend@example.test",
      userId: ids.friend,
      paymentMethod: "cod",
      addressLine: "Block 4, Street 12, Building 3",
      usePoints: true,
    })).rejects.toMatchObject({ reason: "order.outOfStock" });

    expect(await referral.pointsBalance(ids.friend)).toBe(6000);
    await db.update(productVariants).set({ stock: 500 }).where(eq(productVariants.id, ids.variant));
  });
});

describe("cashing out", () => {
  it("refuses a balance below the floor and says nothing was taken", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 400, reason: "admin_adjustment" });
    expect(await referral.requestCashOut(ids.friend)).toBeNull();
    expect(await referral.pointsBalance(ids.friend)).toBe(400);
  });

  it("takes the whole balance and pays a tenth", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 2500, reason: "admin_adjustment" });
    expect(await referral.requestCashOut(ids.friend)).toEqual({ points: 2500, value: "0.250" });
    expect(await referral.pointsBalance(ids.friend)).toBe(0);
  });

  it("shows an admin what is owed, and nobody else", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 2500, reason: "admin_adjustment" });
    await referral.requestCashOut(ids.friend);

    const owed = await referral.pendingCashOuts(adminActor());
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ points: 2500, value: "0.250", email: "friend@example.test" });

    await expect(referral.pendingCashOuts(vendorActor())).rejects.toThrow(/FORBIDDEN/);
  });

  it("settles once, so two administrators cannot both pay it", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 2500, reason: "admin_adjustment" });
    await referral.requestCashOut(ids.friend);
    const [owed] = await referral.pendingCashOuts(adminActor());

    expect(await referral.settleCashOut(adminActor(), owed.id)).toBe(true);
    expect(await referral.settleCashOut(adminActor(), owed.id)).toBe(false);
    expect(await referral.pendingCashOuts(adminActor())).toHaveLength(0);
  });
});

describe("what the account page is told", () => {
  /*
   * A code is meant to be pasted into a group chat, so anybody may hold
   * somebody else's — and a list of names would turn that into a way of asking
   * which strangers have registered.
   */
  it("says how many arrived and never who", async () => {
    await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter));
    const placed = await buy(ids.friend);
    await orders.recordCashCollected(adminActor(), placed.order.id);

    const view = await referral.rewardsFor(ids.inviter);
    expect(view).toMatchObject({ code: referralCodeFor(ids.inviter), balance: REFERRER_POINTS, invited: 1, qualified: 1 });
    expect(JSON.stringify(view)).not.toContain("friend@example.test");
    expect(view.entries[0]).toMatchObject({ reason: "referrer_bonus", points: REFERRER_POINTS });
  });

  it("names the order a spend went on, so the ledger explains itself", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 6000, reason: "admin_adjustment" });
    const placed = await buy(ids.friend, 1, true);

    const view = await referral.rewardsFor(ids.friend);
    expect(view.entries[0]).toMatchObject({ reason: "spent_on_order", points: -6000, orderReference: placed.order.reference });
  });
});
