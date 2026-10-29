/**
 * Affiliate marketing, through the API against a real Postgres (3.7).
 *
 * The arithmetic is proved pure in `Shared/commerce/affiliate.test.ts`. What
 * needs a database is joining in one press, that only a member's product
 * links earn, that a sale pays NetLet points — NetLet's share and the store's
 * — once when the cash is collected, held until the return window, and taken
 * back once when a line is refunded, and that the old programme's money is
 * still paid as it was.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { netletCommissionFils, vendorAffiliateFils } from "../../../Shared/commerce/affiliate.js";
import { MAX_SHARER_LOOKUPS_PER_ADDRESS } from "../../../Shared/auth/rateLimit.js";
import { referralCodeFor, referralSharePoints } from "../../../Shared/commerce/referral.js";
import { RETURN_WINDOW_DAYS } from "../../../Shared/commerce/returns.js";
import { fromFils } from "../../../Shared/money.js";
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
const ids = { sofa: 0, mug: 0, sofaProduct: 0, mugProduct: 0 };

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
    return [row.id, variant.id] as const;
  };
  [ids.sofaProduct, ids.sofa] = await product("sofa", "240.000");
  [ids.mugProduct, ids.mug] = await product("mug", "4.000");
}, 60_000);

beforeEach(async () => {
  await db.delete(featureSwitches);
  await db.delete(pointEntries);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(affiliates);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(products).set({ affiliatePercent: null });
});

const DAY = 86_400_000;

/** The store offers both products to affiliates at 3% of the line (3.7.1). */
async function offerBoth(percent = "3") {
  await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent });
  await as("manager").affiliates.setProduct({ productId: ids.mugProduct, percent });
}

/** A sofa and two mugs, bought through `code` on both products' pages (or no link). */
async function placed(code: string | null, buyer: Who = "shopper") {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people[buyer].id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofa, quantity: 1 },
    { cartId: cart.id, variantId: ids.mug, quantity: 2 },
  ]);
  const result = await ordersModule.placeOrder(cart.id, {
    email: people[buyer].email, userId: people[buyer].id, contactName: "Buyer",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
    productReferrals: code ? [{ productId: String(ids.sofaProduct), code }, { productId: String(ids.mugProduct), code }] : [],
  });
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, result.order.id));
  const [order] = await db.select().from(orders).where(eq(orders.id, result.order.id));
  return { order, lines };
}

const collect = (orderId: number) => as("manager").orders.markCollected({ orderId });

/** What a line earns its sharer, in points: NetLet's share of its own commission and the store's. */
const pointsFor = (line: typeof orderItems.$inferSelect) =>
  referralSharePoints(fromFils(netletCommissionFils(line)), line.referralRate ?? "0") + Number(vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent));

/** The creator, joined. */
async function member() {
  const dashboard = await as("creator").affiliates.join({ displayName: "Noura Reviews", acceptDisclosure: true });
  const [row] = await db.select().from(affiliates);
  return { code: dashboard.code as string, id: row.id };
}

describe("joining", () => {
  it("needs the disclosure agreed, and is a membership at once", async () => {
    await expect(as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: false })).rejects.toMatchObject({ message: "affiliate.disclosureRequired" });
    expect(await as("creator").affiliates.mine()).toBeNull();
    const dashboard = await as("creator").affiliates.join({ displayName: "Noura", acceptDisclosure: true });
    expect(dashboard).toMatchObject({ status: "active", displayName: "Noura", code: referralCodeFor(people.creator.id), earnedPoints: 0, heldPoints: 0, sales: [], earlier: null });
    expect(await as("creator").affiliates.code()).toEqual({ code: referralCodeFor(people.creator.id), joined: true });
  });

  it("is known by the account's first name when no name is given", async () => {
    await db.update(users).set({ name: "Noura Al-Sabah" }).where(eq(users.id, people.creator.id));
    expect((await as("creator").affiliates.join({ acceptDisclosure: true })).displayName).toBe("Noura");
    await db.update(users).set({ name: "creator" }).where(eq(users.id, people.creator.id));
  });

  it("cannot rejoin out of a suspension, and a waiting application from the old review becomes a membership", async () => {
    const { id } = await member();
    await as("admin").affiliates.update({ affiliateId: id, status: "suspended" });
    expect((await as("creator").affiliates.join({ displayName: "Again", acceptDisclosure: true })).status).toBe("suspended");
    /* No code, so a Share carries none — and joined, so nobody offers a suspended member "Join". */
    expect(await as("creator").affiliates.code()).toEqual({ code: null, joined: true });

    await db.insert(affiliates).values({ userId: people.stranger.id, displayName: "Old application", status: "pending", disclosureAcceptedAt: new Date() });
    expect(await as("stranger").affiliates.mine()).toBeNull();
    expect(await as("stranger").affiliates.code()).toEqual({ code: null, joined: false });
    expect((await as("stranger").affiliates.join({ displayName: "Stranger", acceptDisclosure: true })).status).toBe("active");
  });

  it("is suspended and reinstated by an administrator alone, on the trail", async () => {
    const { id } = await member();
    await expect(as("manager").affiliates.update({ affiliateId: id, status: "suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("manager").affiliates.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await as("admin").affiliates.update({ affiliateId: id, status: "suspended" });
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, "affiliate.update"), eq(auditLog.subjectId, id)));
    expect(audit).toMatchObject({ before: { status: "active" }, after: { status: "suspended" } });
    expect((await as("admin").affiliates.list()).rows).toEqual([expect.objectContaining({ status: "suspended", points: 0, code: referralCodeFor(people.creator.id) })]);
  });

  it("names a member to a shopper by either code, and nobody who is not one", async () => {
    const guest = appRouter.createCaller(contextFor(null));
    expect(await guest.affiliates.sharers({ codes: [referralCodeFor(people.creator.id)] })).toEqual([]);
    const { code } = await member();
    expect(await guest.affiliates.sharers({ codes: [code, "AF" + code.slice(2), referralCodeFor(people.stranger.id)] }))
      .toEqual([{ code, displayName: "Noura Reviews" }]);
  });

  it("answers one address a ceiling's worth an hour, because a code is an account id anybody could walk", async () => {
    const from = (ip: string) => appRouter.createCaller({ ...contextFor(null), req: { protocol: "https", headers: {}, ip } as TrpcContext["req"] });
    const walker = from("10.7.7.7");
    for (let ask = 0; ask < MAX_SHARER_LOOKUPS_PER_ADDRESS; ask++) {
      await walker.affiliates.sharers({ codes: [referralCodeFor(ask + 1)] });
    }
    await expect(walker.affiliates.sharers({ codes: [referralCodeFor(1)] })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "affiliate.sharersTooMany" });
    /* Another address is not held to the first one's count, and asking for nothing costs nothing. */
    expect(await from("10.7.7.8").affiliates.sharers({ codes: [referralCodeFor(1)] })).toEqual([]);
    expect(await walker.affiliates.sharers({ codes: [] })).toEqual([]);
  });
});

describe("earning", () => {
  it("freezes a member's link on each line it brought, with the store's rate on what it offered", async () => {
    const { code } = await member();
    await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: "3" });
    const { order, lines } = await placed(code);
    /* Nothing is attributed to the order any more: the link is per line. */
    expect(order).toMatchObject({ affiliateId: null, affiliateRate: null });
    const sofa = lines.find(line => line.productTitle === "sofa")!;
    const mug = lines.find(line => line.productTitle === "mug")!;
    expect(sofa).toMatchObject({ referrerId: people.creator.id, referralRate: "20.00", affiliateVendorPercent: "3.00" });
    expect(mug).toMatchObject({ referrerId: people.creator.id, referralRate: "20.00", affiliateVendorPercent: null });
    /* The store's share passes through the commission, off the seller's net, and the line still adds up. */
    expect(Number(sofa.commissionAmount) + Number(sofa.vendorNet)).toBeCloseTo(240, 3);
    /* A later change of the store's rate does not reach back. */
    await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: "10" });
    const [again] = await db.select().from(orderItems).where(eq(orderItems.id, sofa.id));
    expect(again.affiliateVendorPercent).toBe("3.00");
  });

  it("freezes nothing for somebody who never joined, for the buyer themselves, or for nonsense", async () => {
    await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: "3" });
    const unjoined = await placed(referralCodeFor(people.stranger.id));
    expect(unjoined.lines.every(line => line.referrerId === null && line.affiliateVendorPercent === null)).toBe(true);
    const { code } = await member();
    expect((await placed(code, "creator")).lines.every(line => line.referrerId === null)).toBe(true);
    expect((await placed("NLZZZZZZZZ")).lines.every(line => line.referrerId === null)).toBe(true);
  });

  it("reads an old affiliate link's AF code as the same member's link", async () => {
    const { code } = await member();
    const { lines } = await placed("AF" + code.slice(2));
    expect(lines.every(line => line.referrerId === people.creator.id)).toBe(true);
  });

  it("pays NetLet points once, when the cash is collected, held until the return window passes", async () => {
    const { code } = await member();
    await offerBoth();
    const { order, lines } = await placed(code);
    expect(await db.select().from(pointEntries)).toEqual([]);
    await collect(order.id);
    await collect(order.id);
    const entries = await db.select().from(pointEntries).where(eq(pointEntries.userId, people.creator.id));
    expect(entries).toHaveLength(2);
    for (const line of lines) {
      const entry = entries.find(row => row.orderItemId === line.id)!;
      /* NetLet's share of its own commission, and the store's 3% on top. */
      expect(entry).toMatchObject({ pot: "points", reason: "product_referral", points: pointsFor(line) });
      expect(pointsFor(line)).toBeGreaterThan(Number(vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent)));
      expect(entry.availableAt!.getTime()).toBeGreaterThan(Date.now() + (RETURN_WINDOW_DAYS - 1) * DAY);
    }
    const total = lines.reduce((sum, line) => sum + pointsFor(line), 0);
    expect(await as("creator").affiliates.mine()).toMatchObject({ paidOrders: 1, waitingOrders: 0, earnedPoints: total, heldPoints: total, reversedPoints: 0 });
    /* Held, so not yet spendable: the points page says so. */
    expect(await as("creator").rewards.mine()).toMatchObject({ balance: 0, held: total });
    /* Nothing went to the old programme's money. */
    expect(await db.select().from(pointEntries).where(eq(pointEntries.pot, "affiliate"))).toEqual([]);
  });

  it("takes back a refunded line's points, exactly, once", async () => {
    const { code } = await member();
    await offerBoth();
    const { order, lines } = await placed(code);
    await collect(order.id);
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, order.id));
    const mug = lines.find(line => line.productTitle === "mug")!;
    await as("shopper").orders.requestReturn({ reference: order.reference, orderItemId: mug.id, kind: "refund", reason: "damaged" });
    const [request] = await db.select().from(returnRequests);
    await as("manager").returns.collect({ requestId: request.id });
    await as("manager").returns.receive({ requestId: request.id, restock: true });
    const total = lines.reduce((sum, line) => sum + pointsFor(line), 0);
    const dashboard = await as("creator").affiliates.mine();
    expect(dashboard).toMatchObject({ earnedPoints: total, reversedPoints: pointsFor(mug) });
    expect(dashboard.sales.filter((sale: { reversed: boolean }) => sale.reversed)).toHaveLength(1);
  });
});

describe("the old programme's money", () => {
  it("still pays an order it attributed, in the affiliate pot, and never the store's share twice", async () => {
    const { code, id } = await member();
    await offerBoth();
    const { order, lines } = await placed(code);
    /* An order placed under the old programme carried the affiliate on the order. */
    await db.update(orders).set({ affiliateId: id }).where(eq(orders.id, order.id));
    await collect(order.id);
    const money = await db.select().from(pointEntries).where(eq(pointEntries.pot, "affiliate"));
    const storeShare = lines.reduce((sum, line) => sum + Number(vendorAffiliateFils(line.lineTotal, line.affiliateVendorPercent)), 0);
    expect(money).toEqual([expect.objectContaining({ reason: "affiliate_commission", points: storeShare })]);
    /* The points are NetLet's share alone on such an order. */
    const points = await db.select().from(pointEntries).where(and(eq(pointEntries.pot, "points"), eq(pointEntries.reason, "product_referral")));
    expect(points.reduce((sum, row) => sum + row.points, 0)).toBe(lines.reduce((sum, line) => sum + referralSharePoints(fromFils(netletCommissionFils(line)), "20.00"), 0));
    const dashboard = await as("creator").affiliates.mine();
    expect(dashboard.earlier).toMatchObject({ balance: fromFils(BigInt(storeShare)), payout: { ok: true } });
    expect(await as("creator").affiliates.payout()).toEqual({ amount: fromFils(BigInt(storeShare)) });
    expect(await as("admin").rewards.pendingCashOuts({})).toEqual([expect.objectContaining({ pot: "affiliate", value: fromFils(BigInt(storeShare)) })]);
  });
});

describe("the stores' offers (3.7.1)", () => {
  it("is a manager of the product's store's to make, within the ceiling, on the trail", async () => {
    await expect(as("stranger").affiliates.setProduct({ productId: ids.sofaProduct, percent: "3" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const percent of ["25", "0", "abc", "1.234"]) {
      await expect(as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent })).rejects.toMatchObject({ message: "affiliate.badRate" });
    }
    expect(await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: "4.5" })).toEqual({ percent: "4.50" });
    expect(await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: null })).toEqual({ percent: null });
    const trail = await db.select().from(auditLog).where(and(eq(auditLog.action, "product.setAffiliate"), eq(auditLog.subjectId, ids.sofaProduct)));
    expect(trail.map(row => row.after)).toEqual(expect.arrayContaining([{ affiliatePercent: "4.50" }, { affiliatePercent: null }]));
  });

  it("lists what pays extra to a member, highest rate first, and to nobody else", async () => {
    await as("manager").affiliates.setProduct({ productId: ids.sofaProduct, percent: "2" });
    await as("manager").affiliates.setProduct({ productId: ids.mugProduct, percent: "8" });
    expect(await as("creator").affiliates.products()).toBeNull();
    await member();
    const offered = await as("creator").affiliates.products();
    expect(offered.rows.map((row: { handle: string; percent: string }) => [row.handle, row.percent])).toEqual([["mug", "8.00"], ["sofa", "2.00"]]);
    expect(offered.total).toBe(2);
  });
});

describe("the switch", () => {
  it("is on unless a shop turns it off; off closes joining and new links, but pays a line already frozen", async () => {
    const { code } = await member();
    const { order } = await placed(code);
    await as("admin").features.set({ key: "affiliates", enabled: false });
    await expect(as("stranger").affiliates.join({ displayName: "X", acceptDisclosure: true })).rejects.toMatchObject({ message: "features.off" });
    expect((await placed(code)).lines.every(line => line.referrerId === null)).toBe(true);
    expect((await as("creator").affiliates.code()).code).toBeNull();
    await collect(order.id);
    expect((await as("creator").affiliates.mine()).earnedPoints).toBeGreaterThan(0);
  });
});
