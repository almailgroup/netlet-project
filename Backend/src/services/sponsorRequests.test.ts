/**
 * Sponsored products against a real Postgres (migration 0089).
 *
 * The day arithmetic is proved pure in `Shared/commerce/sponsorRequests.test.ts`.
 * What needs a database is the half that moves places and money: that a
 * request holds its place until it is answered or lapses, that NetLet's
 * answer and the store's payment land once, that paying from earnings is
 * charged off payouts and a transfer is not, that the shelf shows what was
 * paid for and nothing else, and that every read and move is scoped.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adBookings,
  auditLog,
  cartItems,
  carts,
  categories,
  invoiceCounters,
  invoices,
  notifications,
  orderItems,
  orders,
  payoutRunItems,
  payoutRuns,
  productViews,
  productVariants,
  products,
  sponsorRequests,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../../database/schema.js";
import { addDays, kuwaitToday } from "../../../Shared/commerce/adBookings.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import type { TrpcContext } from "../core/context.js";

process.env.PAYOUT_FROM_IBAN = "KW81CBKU0000000000001234560101";
process.env.PAYOUT_FROM_NAME = "NetLet Co.";

let db: ReturnType<typeof drizzle>;
let client: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let sponsor: typeof import("./sponsorRequests.js");
let holds: typeof import("./sponsorHolds.js");
let ads: typeof import("./adBookings.js");
let runs: typeof import("./payoutRuns.js");
let ordersModule: typeof import("./orders.js");

const people = {} as Record<"shopper" | "owner" | "manager" | "rival" | "admin", User>;
const ids = { acme: 0, beta: 0, lamp: 0, lampVariant: 0, rug: 0, chair: 0, stool: 0, desk: 0, betaVase: 0 };

const today = kuwaitToday(new Date());
/** Mid-morning in Kuwait on the day `offset` days from today. */
const on = (offset: number) => new Date(`${addDays(today, offset)}T06:00:00Z`);
const day = (offset: number) => addDays(today, offset);

const owner = (): Actor => ({ kind: "vendor", userId: people.owner.id, vendorId: ids.acme, role: "owner" });
const rival = (): Actor => ({ kind: "vendor", userId: people.rival.id, vendorId: ids.beta, role: "owner" });
const admin = (): Actor => ({ kind: "admin", userId: people.admin.id });

const contextFor = (user: User): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});

beforeAll(async () => {
  client = new PGlite();
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
  sponsor = await import("./sponsorRequests.js");
  holds = await import("./sponsorHolds.js");
  ads = await import("./adBookings.js");
  runs = await import("./payoutRuns.js");
  ordersModule = await import("./orders.js");

  for (const who of ["shopper", "owner", "manager", "rival", "admin"] as const) {
    const [row] = await db.insert(users).values({ email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}) }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", payoutIban: "KW81CBKU0000000000001234560101" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  ids.acme = acme.id; ids.beta = beta.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.owner.id, role: "owner" },
    { vendorId: acme.id, userId: people.manager.id, role: "manager" },
    { vendorId: beta.id, userId: people.rival.id, role: "owner" },
  ]);
  const [home] = await db.insert(categories).values({ slug: "home-and-kitchen", name: "Home & Kitchen" }).returning();

  const product = async (vendorId: number, handle: string, price: string) => {
    const [row] = await db.insert(products).values({ vendorId, handle, title: handle, status: "published", categoryId: home.id }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 50 }).returning();
    return { id: row.id, variant: variant.id };
  };
  const lamp = await product(acme.id, "lamp", "200.000");
  ids.lamp = lamp.id; ids.lampVariant = lamp.variant;
  ids.rug = (await product(acme.id, "rug", "50.000")).id;
  ids.chair = (await product(acme.id, "chair", "40.000")).id;
  ids.stool = (await product(acme.id, "stool", "20.000")).id;
  ids.desk = (await product(acme.id, "desk", "90.000")).id;
  ids.betaVase = (await product(beta.id, "vase", "30.000")).id;
}, 60_000);

beforeEach(async () => {
  await db.delete(sponsorRequests);
  await db.delete(payoutRunItems);
  await db.delete(payoutRuns);
  await db.delete(adBookings);
  await db.delete(auditLog);
  await db.delete(notifications);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(productViews);
  await db.update(products).set({ status: "published" });
});

/** A cash order for one lamp, collected long enough ago to be due. Returns what Acme earned. */
async function earned(): Promise<number> {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people.shopper.id }).returning();
  await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.lampVariant, quantity: 1 });
  const placed = await ordersModule.placeOrder(cart.id, {
    email: people.shopper.email, userId: people.shopper.id, contactName: "Buyer",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
  });
  await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(orders.id, placed.order.id));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
  return lines.reduce((sum, line) => sum + Number(line.vendorNet), 0);
}

const ask = (productId: number, startOffset: number, days: number) => ({ productId, startsOn: day(startOffset), days });
const noticesOf = (kind: string) => db.select().from(notifications).where(eq(notifications.kind, kind));

describe("asking", () => {
  it("costs nothing, holds its place, and tells NetLet", async () => {
    const quote = await sponsor.quoteSponsor(owner(), ask(ids.lamp, 3, 7));
    expect(quote).toMatchObject({ ready: true, cost: "70.000", dailyRate: "10.000", problem: null });
    const made = await sponsor.requestSponsor(owner(), { ...ask(ids.lamp, 3, 7), note: "Our winter offer starts then" });
    expect(made.total).toBe("70.000");

    const [row] = (await sponsor.listSponsors(owner(), {}, on(0))).rows;
    expect(row).toMatchObject({ state: "review", step: "requested", note: "Our winter offer starts then", transferReference: `SP-${made.id}` });
    expect(row.actions).toMatchObject({ withdraw: true, payFromEarnings: false });
    expect((await noticesOf("staff_sponsor_request")).map(notice => notice.userId)).toEqual([people.admin.id]);

    /* Its days now hold one of the four places. */
    const calendar = await ads.placementCalendar(owner(), { productId: ids.rug, slot: "home" }, on(0));
    expect(calendar.days.find(entry => entry.date === day(4))).toMatchObject({ taken: 1, free: 3 });
  });

  it("refuses the fifth product on a full day, and the same product twice", async () => {
    for (const id of [ids.lamp, ids.rug, ids.chair, ids.stool]) await sponsor.requestSponsor(owner(), ask(id, 3, 2));
    const quote = await sponsor.quoteSponsor(owner(), ask(ids.desk, 4, 3));
    expect(quote).toMatchObject({ problem: "sponsor.full", fullDays: [day(4)] });
    await expect(sponsor.requestSponsor(owner(), ask(ids.desk, 4, 3))).rejects.toMatchObject({ reason: "sponsor.full", days: [day(4)] });
    await expect(sponsor.requestSponsor(owner(), ask(ids.lamp, 4, 1))).rejects.toMatchObject({ reason: "sponsor.full" });
    /* Withdrawn, a place is free again. */
    const [one] = (await sponsor.listSponsors(owner())).rows;
    await sponsor.withdrawSponsor(owner(), one.id);
    expect((await sponsor.quoteSponsor(owner(), ask(ids.desk, 4, 3))).problem).toBeNull();
    expect((await sponsor.quoteSponsor(owner(), ask(ids.lamp, 3, 1))).problem).toBe("sponsor.alreadyAsked");
  });

  it("is the owner's: a manager is refused, an administrator has nothing to ask for, another store's product is not on offer", async () => {
    await expect(appRouter.createCaller(contextFor(people.manager)).sponsor.request(ask(ids.lamp, 3, 1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sponsor.requestSponsor(admin(), ask(ids.lamp, 3, 1))).rejects.toMatchObject({ reason: "sponsor.notYours" });
    await expect(sponsor.requestSponsor(owner(), ask(ids.betaVase, 3, 1))).rejects.toMatchObject({ reason: "sponsor.productUnavailable" });
    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.lamp));
    await expect(sponsor.requestSponsor(owner(), ask(ids.lamp, 3, 1))).rejects.toMatchObject({ reason: "sponsor.productUnavailable" });
  });

  it("is not another store's to see or move", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 3, 1));
    expect((await sponsor.listSponsors(rival())).rows).toEqual([]);
    await expect(sponsor.withdrawSponsor(rival(), id)).rejects.toMatchObject({ reason: "sponsor.notFound" });
    expect((await sponsor.listSponsors(admin())).rows.map(row => row.id)).toEqual([id]);
  });
});

describe("NetLet's answer", () => {
  it("approves at its own day rate, asks for the payment and tells the store", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 6, 5));
    await expect(sponsor.approveSponsor(owner(), { id })).rejects.toThrow("FORBIDDEN");
    const answer = await sponsor.approveSponsor(admin(), { id, dailyRate: "8.000", reply: "Welcome aboard" }, on(0));
    expect(answer).toEqual({ startsOn: day(6), total: "40.000", payBy: day(3) });
    const [row] = (await sponsor.listSponsors(owner(), {}, on(0))).rows;
    expect(row).toMatchObject({ state: "payment", dailyRate: "8.000", total: "40.000", payBy: day(3), reply: "Welcome aboard" });
    expect(row.actions).toMatchObject({ payFromEarnings: true, sendTransfer: true, withdraw: true });
    expect((await noticesOf("seller_sponsor_payment")).length).toBe(2);
    await expect(sponsor.approveSponsor(admin(), { id })).rejects.toMatchObject({ reason: "sponsor.moved" });
  });

  it("approved after its first day, asks only for the days left", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 1, 5), on(0));
    const answer = await sponsor.approveSponsor(admin(), { id }, on(3));
    expect(answer).toEqual({ startsOn: day(3), total: "30.000", payBy: day(3) });
  });

  it("refuses a rate or a last day to pay the rule refuses", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 6, 2));
    await expect(sponsor.approveSponsor(admin(), { id, dailyRate: "0" })).rejects.toMatchObject({ reason: "sponsor.rateBad" });
    await expect(sponsor.approveSponsor(admin(), { id, payBy: day(8) })).rejects.toMatchObject({ reason: "sponsor.payByLate" });
  });

  it("declines with a reason the store reads, and frees the days", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 3, 2));
    await expect(sponsor.declineSponsor(admin(), { id, reply: "  " })).rejects.toMatchObject({ reason: "sponsor.needsReply" });
    expect(await sponsor.declineSponsor(admin(), { id, reply: "Photo is blurry" })).toEqual({ refund: null });
    const [row] = (await sponsor.listSponsors(owner())).rows;
    expect(row).toMatchObject({ state: "declined", reply: "Photo is blurry", stopped: true });
    const [notice] = await noticesOf("seller_sponsor_declined");
    expect(notice.params).toMatchObject({ reason: "Photo is blurry" });
    const calendar = await ads.placementCalendar(owner(), { productId: ids.rug, slot: "home" });
    expect(calendar.days.find(entry => entry.date === day(3))).toMatchObject({ taken: 0 });
  });

  it("lapses when NetLet does not answer, and when the store does not pay, and the place is free from then", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 6, 2), on(0));
    await sponsor.approveSponsor(admin(), { id, payBy: day(2) }, on(0));
    expect((await sponsor.listSponsors(owner(), {}, on(3))).rows[0]).toMatchObject({ state: "lapsed", step: "payment", stopped: true });
    await expect(sponsor.paySponsorFromEarnings(owner(), id, on(3))).rejects.toMatchObject({ reason: "sponsor.moved" });
    const calendar = await ads.placementCalendar(owner(), { productId: ids.rug, slot: "home" }, on(3));
    expect(calendar.days.find(entry => entry.date === day(6))).toMatchObject({ taken: 0 });
  });
});

describe("paying from earnings", () => {
  it("is refused beyond what the store has earned", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 3, 2));
    await sponsor.approveSponsor(admin(), { id });
    await expect(sponsor.paySponsorFromEarnings(owner(), id)).rejects.toMatchObject({ reason: "sponsor.notEnoughEarned" });
  });

  it("puts the product on the home shelf on its days and charges each day off the payout", async () => {
    const net = await earned();
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 1, 5), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    expect(await sponsor.paySponsorFromEarnings(owner(), id, on(0))).toEqual({ startsOn: day(1), endsOn: day(5) });

    expect(await ads.sponsoredToday("home", {}, on(0))).toEqual([]);
    expect((await ads.sponsoredToday("home", {}, on(2))).map(product => product.handle)).toEqual(["lamp"]);

    const [batch] = await runs.readyBatches(admin(), on(2));
    expect(batch.lines.filter((line: { kind: string }) => line.kind === "fee").map((line: { amount: string }) => line.amount)).toEqual(["-20.000"]);
    expect(Number(batch.total)).toBeCloseTo(net - 20, 3);

    const [row] = (await sponsor.listSponsors(owner(), {}, on(2))).rows;
    expect(row).toMatchObject({ state: "paid", paidWith: "earnings", step: "live", placement: { state: "running", accrued: "20.000" } });
    expect(row.actions.stop).toBe(true);

    /* The Placements page leaves it to this page, and cannot stop it. */
    expect((await ads.listPlacements(owner(), {}, on(2))).rows).toEqual([]);
    const [booking] = await db.select().from(adBookings);
    await expect(ads.cancelPlacement(owner(), booking.id, on(2))).rejects.toMatchObject({ reason: "ads.useSponsoredPage" });

    /* Stopped while running: ends today, today charged, nothing owed back. */
    expect(await sponsor.stopSponsor(owner(), id, on(2))).toEqual({ refund: null });
    /* A run stopped part-way has ended, on the day it was stopped. */
    expect((await sponsor.listSponsors(owner(), {}, on(9))).rows[0]).toMatchObject({ step: "ended", placement: { cancelledOn: day(2), accrued: "20.000" } });
  });
});

describe("paying by bank transfer", () => {
  it("waits for NetLet to see it arrive, then runs without anything coming off a payout", async () => {
    const net = await earned();
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 2, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    const page = await sponsor.listSponsors(owner(), {}, on(0));
    expect(page.transfer).toEqual({ name: "NetLet Co.", iban: "KW81CBKU0000000000001234560101" });

    await expect(sponsor.sendSponsorTransfer(owner(), { id, reference: "x" }, on(0))).rejects.toMatchObject({ reason: "sponsor.referenceNeeded" });
    await sponsor.sendSponsorTransfer(owner(), { id, reference: "FT26-1188" }, on(0));
    expect((await noticesOf("staff_sponsor_sent")).length).toBe(1);
    const sent = (await sponsor.listSponsors(admin(), { view: "todo" }, on(5))).rows;
    /* Past its pay-by day, a sent transfer has not lapsed. */
    expect(sent.map(row => [row.id, row.state, row.paymentReference])).toEqual([[id, "sent", "FT26-1188"]]);

    await expect(sponsor.confirmSponsorPayment(owner(), { id })).rejects.toThrow("FORBIDDEN");
    await sponsor.confirmSponsorPayment(admin(), { id }, on(1));
    expect((await noticesOf("seller_sponsor_live")).length).toBe(2);
    expect((await ads.sponsoredToday("home", {}, on(3))).map(product => product.handle)).toEqual(["lamp"]);

    const [batch] = await runs.readyBatches(admin(), on(4));
    expect(batch.lines.filter((line: { kind: string }) => line.kind === "fee")).toEqual([]);
    expect(Number(batch.total)).toBeCloseTo(net, 3);

    const [row] = (await sponsor.listSponsors(owner(), {}, on(3))).rows;
    expect(row).toMatchObject({ paidWith: "transfer", placement: { accrued: "30.000" } });
    /* The store cannot stop what is already in NetLet's account; NetLet can, and owes back the rest. */
    expect(row.actions.stop).toBe(false);
    await expect(sponsor.stopSponsor(owner(), id, on(3))).rejects.toMatchObject({ reason: "sponsor.notStoppable" });
    expect((await sponsor.listSponsors(admin(), {}, on(3))).rows[0].refundIfStopped).toBe("10.000");
    expect(await sponsor.stopSponsor(admin(), id, on(3))).toEqual({ refund: "10.000" });
    expect((await noticesOf("seller_sponsor_stopped")).length).toBe(2);
  });

  it("confirmed by two people at once, and declined while it is confirmed, lands once", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 2, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    await sponsor.sendSponsorTransfer(owner(), { id, reference: "FT26-1188" }, on(0));
    const answers = await Promise.allSettled([
      sponsor.confirmSponsorPayment(admin(), { id }, on(1)),
      sponsor.confirmSponsorPayment(admin(), { id }, on(1)),
      sponsor.declineSponsor(admin(), { id, reply: "We could not find the transfer." }, on(1)),
    ]);
    expect(answers.filter(answer => answer.status === "fulfilled")).toHaveLength(1);
    expect(answers.filter(answer => answer.status === "rejected").map(answer => (answer as PromiseRejectedResult).reason.reason)).toEqual(["sponsor.moved", "sponsor.moved"]);
    /* Whichever landed, there is one placement or none, never two. */
    const homes = await db.select().from(adBookings).where(eq(adBookings.slot, "home"));
    const [row] = (await sponsor.listSponsors(admin(), {}, on(1))).rows;
    expect(homes).toHaveLength(row.state === "paid" ? 1 : 0);
  });

  it("confirmed after its first day, keeps every day paid for", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 2, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    await sponsor.sendSponsorTransfer(owner(), { id, reference: "FT26-0001" }, on(1));
    expect(await sponsor.confirmSponsorPayment(admin(), { id }, on(4))).toEqual({ startsOn: day(4), endsOn: day(6) });
  });

  it("not received, goes back to waiting for the payment by a new day", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 5, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    await sponsor.sendSponsorTransfer(owner(), { id, reference: "FT26-0002" }, on(0));
    await expect(sponsor.sponsorNotReceived(admin(), { id, reply: "" })).rejects.toMatchObject({ reason: "sponsor.needsReply" });
    expect(await sponsor.sponsorNotReceived(admin(), { id, reply: "Nothing with SP on it yet", payBy: day(4) }, on(1))).toEqual({ payBy: day(4) });
    const [row] = (await sponsor.listSponsors(owner(), {}, on(1))).rows;
    expect(row).toMatchObject({ state: "payment", payBy: day(4), reply: "Nothing with SP on it yet", paymentReference: "FT26-0002" });
    expect((await noticesOf("seller_sponsor_not_received")).length).toBe(2);
  });

  it("declined after the store sent it, says what is owed back", async () => {
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 5, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    await sponsor.sendSponsorTransfer(owner(), { id, reference: "FT26-0003" }, on(0));
    expect(await sponsor.declineSponsor(admin(), { id, reply: "Product withdrawn by NetLet" }, on(1))).toEqual({ refund: "30.000" });
  });
});

describe("results", () => {
  it("counts the home page's views on its days against the days before, and the orders", async () => {
    await earned();
    const { id } = await sponsor.requestSponsor(owner(), ask(ids.lamp, 0, 3), on(0));
    await sponsor.approveSponsor(admin(), { id }, on(0));
    await sponsor.paySponsorFromEarnings(owner(), id, on(0));
    await db.insert(productViews).values([
      { productId: ids.lamp, day: day(-2), channel: "web_phone", source: "home", views: 10, visitors: 8 },
      { productId: ids.lamp, day: day(0), channel: "app", source: "home", views: 30, visitors: 20 },
      { productId: ids.lamp, day: day(1), channel: "web_phone", source: "home", views: 10, visitors: 6 },
      { productId: ids.lamp, day: day(1), channel: "web_phone", source: "search", views: 99, visitors: 50 },
    ]);
    const [row] = (await sponsor.listSponsors(owner(), {}, on(1))).rows;
    /* The lamp `earned()` sold was ordered today, on the run's first day; the search views are not the home page's. */
    expect(row.results).toEqual({ daysShown: 2, homeViews: 40, homeVisitors: 26, viewsBefore: 10, lift: 300, orders: 1 });
  });
});

describe("before 0089 is pasted", () => {
  it("is closed, and every placement read goes on as before", async () => {
    await client.exec(`ALTER TABLE sponsor_requests RENAME TO sponsor_requests_away`);
    holds.forgetSponsorReadiness();
    try {
      expect((await sponsor.listSponsors(owner())).ready).toBe(false);
      expect((await sponsor.quoteSponsor(owner(), ask(ids.lamp, 3, 1))).problem).toBe("sponsor.unavailable");
      await expect(sponsor.requestSponsor(owner(), ask(ids.lamp, 3, 1))).rejects.toMatchObject({ reason: "sponsor.unavailable" });
      expect((await ads.listPlacements(owner())).rows).toEqual([]);
      expect((await ads.placementCalendar(owner(), { productId: ids.lamp, slot: "home" })).days[0].taken).toBe(0);
      expect(await sponsor.countSponsorsWaiting(admin())).toBe(0);
    } finally {
      await client.exec(`ALTER TABLE sponsor_requests_away RENAME TO sponsor_requests`);
      holds.forgetSponsorReadiness();
    }
    await db.execute(sql`select 1`);
  });
});
