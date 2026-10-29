/**
 * Referrals and the points ledger, against a real Postgres.
 *
 * The arithmetic is proved pure in `Shared/commerce/referral.test.ts`. What is
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
  affiliates, cartItems, carts, orderItems, orders as ordersTable, pointEntries, products, productVariants,
  referrals as referralsTable, users, vendors,
  invoices, platformSettings,
} from "../../database/schema.js";
import { REFERRED_POINTS, REFERRER_POINTS, referralCodeFor, referralSharePoints } from "../../../Shared/commerce/referral.js";
import { RETURN_WINDOW_DAYS } from "../../../Shared/commerce/returns.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let referral: typeof import("./referral.js");
let orders: typeof import("./orders.js");
let settings: typeof import("./settings.js");

const ids = { admin: 0, owner: 0, inviter: 0, friend: 0, stranger: 0, vendor: 0, product: 0, variant: 0 };

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
  referral = await import("./referral.js");
  orders = await import("./orders.js");
  settings = await import("./settings.js");

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
    stranger: stranger.id, vendor: acme.id, product: lamp.id, variant: variant.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(affiliates);
  await db.delete(platformSettings);
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

async function buy(userId: number, quantity = 1, usePoints = false, productReferrals: { productId: string; code: string }[] = []) {
  return orders.placeOrder(await basket(userId, quantity), {
    email: "friend@example.test",
    userId,
    paymentMethod: "cod",
    addressLine: "Block 4, Street 12, Building 3",
    usePoints,
    productReferrals,
  });
}

/** The order's one line, as frozen. */
async function lineOf(orderId: number) {
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return line;
}

const DAY = 86_400_000;

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

  it("takes the whole balance and pays it less the 10% fee", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 2500, reason: "admin_adjustment" });
    expect(await referral.requestCashOut(ids.friend)).toEqual({ points: 2500, value: "2.250" });
    expect(await referral.pointsBalance(ids.friend)).toBe(0);
  });

  it("shows an admin what is owed, and nobody else", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 2500, reason: "admin_adjustment" });
    await referral.requestCashOut(ids.friend);

    const owed = await referral.pendingCashOuts(adminActor());
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ points: 2500, value: "2.250", email: "friend@example.test" });

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
    /* The welcome, and beside it the first of the ongoing commissions — still held. */
    expect(view.entries.find(entry => entry.reason === "referrer_bonus")).toMatchObject({ points: REFERRER_POINTS, availableAt: null });
    expect(view.entries.find(entry => entry.reason === "invite_commission")?.availableAt).not.toBeNull();
  });

  it("names the order a spend went on, so the ledger explains itself", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 6000, reason: "admin_adjustment" });
    const placed = await buy(ids.friend, 1, true);

    const view = await referral.rewardsFor(ids.friend);
    expect(view.entries[0]).toMatchObject({ reason: "spent_on_order", points: -6000, orderReference: placed.order.reference });
  });
});

/*
 * The two commissions beside the welcome (3.1.14, 3.1.15): a percentage of
 * NetLet's own commission on each line, held until the line's return window
 * has passed. Migration 0062.
 */
describe("referral commissions", () => {
  /* A product link earns its sharer only once they have joined the affiliate
     programme (3.7), so the stranger who shares here is a member. */
  beforeEach(async () => {
    await db.insert(affiliates).values({ userId: ids.stranger, displayName: "Stranger", status: "active", disclosureAcceptedAt: new Date() });
  });

  it("pays the inviter on every order the friend places, held until the return window passes", async () => {
    await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter));
    const first = await buy(ids.friend);
    const second = await buy(ids.friend, 2);
    await orders.recordCashCollected(adminActor(), first.order.id);
    await orders.recordCashCollected(adminActor(), second.order.id);

    const earned = await db.select().from(pointEntries).where(eq(pointEntries.reason, "invite_commission"));
    expect(earned).toHaveLength(2);
    for (const placed of [first, second]) {
      const line = await lineOf(placed.order.id);
      const entry = earned.find(row => row.orderItemId === line.id);
      expect(entry?.points).toBe(referralSharePoints(line.commissionAmount, "10.00"));
      expect(entry?.userId).toBe(ids.inviter);
    }
    /* The welcome is spendable at once; the commissions are not, yet. */
    const now = new Date();
    expect(await referral.balanceFor(db as never, ids.inviter, "points", now)).toBe(REFERRER_POINTS);
    const held = earned.reduce((sum, row) => sum + row.points, 0);
    expect((await referral.heldFor(db as never, ids.inviter, now)).held).toBe(held);
    const later = new Date(now.getTime() + (RETURN_WINDOW_DAYS + 1) * DAY);
    expect(await referral.balanceFor(db as never, ids.inviter, "points", later)).toBe(REFERRER_POINTS + held);
  });

  it("freezes a product link's sharer and rate on the line, and pays them at collection", async () => {
    const placed = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.stranger) }]);
    const line = await lineOf(placed.order.id);
    expect(line).toMatchObject({ referrerId: ids.stranger, referralRate: "20.00" });

    await orders.recordCashCollected(adminActor(), placed.order.id);
    const [entry] = await db.select().from(pointEntries).where(eq(pointEntries.reason, "product_referral"));
    expect(entry).toMatchObject({ userId: ids.stranger, orderItemId: line.id, points: referralSharePoints(line.commissionAmount, "20.00") });
    expect(entry.availableAt!.getTime()).toBeGreaterThan(Date.now() + (RETURN_WINDOW_DAYS - 1) * DAY);

    /* Collecting twice pays once. */
    await referral.creditReferralCommissions(db as never, placed.order.id);
    expect(await db.select().from(pointEntries).where(eq(pointEntries.reason, "product_referral"))).toHaveLength(1);
  });

  it("never pays a shopper for their own link, nor a link for a product not in the order", async () => {
    await db.insert(affiliates).values({ userId: ids.friend, displayName: "Friend", status: "active", disclosureAcceptedAt: new Date() });
    const own = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.friend) }]);
    expect((await lineOf(own.order.id)).referrerId).toBeNull();
    const elsewhere = await buy(ids.friend, 1, false, [{ productId: "999999", code: referralCodeFor(ids.stranger) }]);
    expect((await lineOf(elsewhere.order.id)).referrerId).toBeNull();
  });

  it("pays nobody for the link of somebody who has not joined the affiliate programme", async () => {
    const placed = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.inviter) }]);
    expect(await lineOf(placed.order.id)).toMatchObject({ referrerId: null, referralRate: null });
  });

  it("uses the rate an administrator set, at the sale", async () => {
    expect(await settings.setSetting(adminActor(), "referral.productPercent", "35")).toBe("35.00");
    const placed = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.stranger) }]);
    expect((await lineOf(placed.order.id)).referralRate).toBe("35.00");
  });

  it("refuses a rate out of range or out of shape, and a seller setting one", async () => {
    await expect(settings.setSetting(adminActor(), "referral.invitePercent", "60")).rejects.toThrow("settings.badValue");
    await expect(settings.setSetting(adminActor(), "referral.invitePercent", "1.234")).rejects.toThrow("settings.badValue");
    await expect(settings.setSetting(vendorActor(), "referral.invitePercent", "5")).rejects.toThrow(/FORBIDDEN/);
    expect(await settings.settingValue("referral.invitePercent")).toBe("10.00");
  });

  it("takes a refunded line's commission back, maturing with it, so neither is ever spendable", async () => {
    await referral.recordReferral(ids.friend, referralCodeFor(ids.inviter));
    const placed = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.stranger) }]);
    await orders.recordCashCollected(adminActor(), placed.order.id);
    const line = await lineOf(placed.order.id);

    await referral.reverseReferralLine(db as never, line.id);
    await referral.reverseReferralLine(db as never, line.id);
    const rows = await db.select().from(pointEntries).where(eq(pointEntries.orderItemId, line.id));
    expect(rows.map(row => row.reason).sort()).toEqual(["invite_commission", "invite_commission_reversal", "product_referral", "product_referral_reversal"]);
    for (const reversal of rows.filter(row => row.reason.endsWith("_reversal"))) {
      const original = rows.find(row => row.reason === reversal.reason.replace("_reversal", ""))!;
      expect(reversal.points).toBe(-original.points);
      expect(reversal.availableAt?.getTime()).toBe(original.availableAt?.getTime());
    }
    const later = new Date(Date.now() + (RETURN_WINDOW_DAYS + 1) * DAY);
    expect(await referral.balanceFor(db as never, ids.stranger, "points", later)).toBe(0);
    expect((await referral.heldFor(db as never, ids.stranger)).held).toBe(0);
  });

  it("moves the hold on when the parcel arrives after the cash was collected", async () => {
    const placed = await buy(ids.friend, 1, false, [{ productId: String(ids.product), code: referralCodeFor(ids.stranger) }]);
    await orders.recordCashCollected(adminActor(), placed.order.id);
    const line = await lineOf(placed.order.id);
    const arrived = new Date(Date.now() + 5 * DAY);
    await referral.extendReferralHold(db as never, [line.id], arrived);
    const [entry] = await db.select().from(pointEntries).where(eq(pointEntries.reason, "product_referral"));
    expect(entry.availableAt?.getTime()).toBe(arrived.getTime() + RETURN_WINDOW_DAYS * DAY);
    /* Never earlier. */
    await referral.extendReferralHold(db as never, [line.id], new Date());
    const [still] = await db.select().from(pointEntries).where(eq(pointEntries.reason, "product_referral"));
    expect(still.availableAt?.getTime()).toBe(arrived.getTime() + RETURN_WINDOW_DAYS * DAY);
  });

  it("cannot spend what is held", async () => {
    await db.insert(pointEntries).values({ userId: ids.friend, points: 9000, reason: "product_referral", availableAt: new Date(Date.now() + DAY) });
    expect(await referral.takePoints(db as never, ids.friend, 100, "spent_on_order")).toBeNull();
  });
});
