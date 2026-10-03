/**
 * Paid placements against a real Postgres (3.3.15).
 *
 * The day arithmetic and the fee are proved pure in
 * `shared/commerce/adBookings.test.ts`. What needs a database is the half that
 * moves money: that a store books only against what it has earned, that a
 * place holds only so many, that the shelf shows what was booked and nothing
 * the shop would not, and that the fee comes off the payout run exactly once.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
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
  orderItems,
  orders,
  payoutRunItems,
  payoutRuns,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../drizzle/schema.js";
import { addDays, kuwaitToday } from "../shared/commerce/adBookings.js";
import type { Actor } from "../shared/inventory/permissions.js";
import type { TrpcContext } from "./_core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let ads: typeof import("./adBookings.js");
let runs: typeof import("./payoutRuns.js");
let ordersModule: typeof import("./orders.js");

const people = {} as Record<"shopper" | "owner" | "manager" | "rival" | "admin", User>;
const ids = { acme: 0, beta: 0, lamp: 0, lampVariant: 0, rug: 0, betaVase: 0, home: 0 };

const today = kuwaitToday(new Date());
/** Mid-morning in Kuwait on the day `offset` days from today. */
const on = (offset: number) => new Date(`${addDays(today, offset)}T06:00:00Z`);

const owner = (): Actor => ({ kind: "vendor", userId: people.owner.id, vendorId: ids.acme, role: "owner" });
const rival = (): Actor => ({ kind: "vendor", userId: people.rival.id, vendorId: ids.beta, role: "owner" });
const admin = (): Actor => ({ kind: "admin", userId: people.admin.id });

const contextFor = (user: User): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});

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
  ads = await import("./adBookings.js");
  runs = await import("./payoutRuns.js");
  ordersModule = await import("./orders.js");

  for (const who of ["shopper", "owner", "manager", "rival", "admin"] as const) {
    const [row] = await db.insert(users).values({ email: `${who}@netlet.test`, name: who, ...(who === "admin" ? { role: "admin" } : {}) }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  ids.acme = acme.id; ids.beta = beta.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.owner.id, role: "owner" },
    { vendorId: acme.id, userId: people.manager.id, role: "manager" },
    { vendorId: beta.id, userId: people.rival.id, role: "owner" },
  ]);
  const [home] = await db.insert(categories).values({ slug: "home-and-kitchen", name: "Home & Kitchen" }).returning();
  ids.home = home.id;

  const product = async (vendorId: number, handle: string, price: string, categoryId: number | null) => {
    const [row] = await db.insert(products).values({ vendorId, handle, title: handle, status: "published", categoryId }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 50 }).returning();
    return { id: row.id, variant: variant.id };
  };
  const lamp = await product(acme.id, "lamp", "200.000", home.id);
  ids.lamp = lamp.id; ids.lampVariant = lamp.variant;
  ids.rug = (await product(acme.id, "rug", "50.000", null)).id;
  ids.betaVase = (await product(beta.id, "vase", "30.000", home.id)).id;
}, 60_000);

beforeEach(async () => {
  await db.delete(payoutRunItems);
  await db.delete(payoutRuns);
  await db.delete(adBookings);
  await db.delete(auditLog);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
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

const home = (startOffset: number, days: number) => ({ productId: ids.lamp, slot: "home" as const, startsOn: addDays(today, startOffset), days });

describe("booking against what was earned", () => {
  it("refuses a store with nothing earned, and says so before the press", async () => {
    const quote = await ads.quotePlacement(owner(), home(1, 3));
    expect(quote).toMatchObject({ cost: "30.000", room: "0.000", problem: "ads.notEnoughEarned" });
    await expect(ads.bookPlacement(owner(), home(1, 3))).rejects.toMatchObject({ reason: "ads.notEnoughEarned" });
  });

  it("books within what was earned, and the room shrinks by the whole run", async () => {
    const net = await earned();
    const booked = await ads.bookPlacement(owner(), home(1, 3));
    expect(booked.total).toBe("30.000");
    const quote = await ads.quotePlacement(owner(), home(10, 1));
    expect(Number(quote.room)).toBeCloseTo(net - 30, 3);
  });

  it("refuses a run bigger than what is left", async () => {
    await earned();
    await ads.bookPlacement(owner(), home(1, 15));
    await ads.bookPlacement(owner(), { ...home(1, 1), slot: "department" });
    /* About 180 earned; 150 + 3 committed; another 30 days at 10 is too much. */
    await expect(ads.bookPlacement(owner(), home(20, 30))).rejects.toMatchObject({ reason: "ads.notEnoughEarned" });
  });

  it("is an owner's: a manager is refused, and an administrator has nothing to pay from", async () => {
    await earned();
    await expect(appRouter.createCaller(contextFor(people.manager)).ads.book(home(1, 1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ads.bookPlacement(admin(), home(1, 1))).rejects.toMatchObject({ reason: "ads.notYours" });
  });

  it("refuses another store's product, a draft, and a department booking with no department", async () => {
    await earned();
    await expect(ads.bookPlacement(owner(), { ...home(1, 1), productId: ids.betaVase })).rejects.toMatchObject({ reason: "ads.productUnavailable" });
    await expect(ads.bookPlacement(owner(), { ...home(1, 1), productId: ids.rug, slot: "department" })).rejects.toMatchObject({ reason: "ads.noDepartment" });
    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.lamp));
    await expect(ads.bookPlacement(owner(), home(1, 1))).rejects.toMatchObject({ reason: "ads.productUnavailable" });
  });

  it("refuses a start in the past", async () => {
    await earned();
    await expect(ads.bookPlacement(owner(), home(-1, 1))).rejects.toMatchObject({ reason: "ads.inPast" });
  });
});

describe("a place holds so many a day", () => {
  it("names the full days when a department's two places are taken", async () => {
    await earned();
    const dept = (offset: number, days: number) => ({ ...home(offset, days), slot: "department" as const });
    await ads.bookPlacement(owner(), dept(2, 2));
    await ads.bookPlacement(owner(), dept(3, 1));
    await expect(ads.bookPlacement(owner(), dept(1, 4))).rejects.toMatchObject({ reason: "ads.full", days: [addDays(today, 3)] });
    /* The day either side of it is free. */
    expect((await ads.quotePlacement(owner(), dept(4, 2))).problem).toBeNull();
  });
});

describe("the shelf", () => {
  it("shows a booking on its days, first booked first, and nothing the shop would not", async () => {
    await earned();
    await ads.bookPlacement(owner(), home(1, 2));
    expect(await ads.sponsoredToday("home", {}, on(0))).toEqual([]);
    expect((await ads.sponsoredToday("home", {}, on(1))).map(product => product.handle)).toEqual(["lamp"]);
    expect(await ads.sponsoredToday("home", {}, on(3))).toEqual([]);

    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.lamp));
    expect(await ads.sponsoredToday("home", {}, on(1))).toEqual([]);
  });

  it("tops only the department it was booked for", async () => {
    await earned();
    await ads.bookPlacement(owner(), { ...home(1, 1), slot: "department" });
    expect((await ads.sponsoredToday("department", { departmentSlug: "home-and-kitchen" }, on(1))).map(product => product.handle)).toEqual(["lamp"]);
    expect(await ads.sponsoredToday("department", { departmentSlug: "beauty" }, on(1))).toEqual([]);
    expect(await ads.sponsoredToday("home", {}, on(1))).toEqual([]);
  });
});

describe("stopping a booking", () => {
  it("costs nothing before it starts", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), home(2, 5));
    await ads.cancelPlacement(owner(), id, on(1));
    const [row] = (await ads.listPlacements(owner(), {}, on(10))).rows;
    expect(row).toMatchObject({ state: "cancelled", accrued: "0.000", cancellable: false });
  });

  it("ends it today while it runs, and charges the days it ran", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), home(1, 5));
    await ads.cancelPlacement(owner(), id, on(2));
    const [row] = (await ads.listPlacements(owner(), {}, on(10))).rows;
    expect(row).toMatchObject({ state: "ended", accrued: "20.000" });
    await expect(ads.cancelPlacement(owner(), id, on(2))).rejects.toMatchObject({ reason: "ads.notCancellable" });
  });

  it("is not another store's to stop, and not even theirs to see", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), home(1, 2));
    await expect(ads.cancelPlacement(rival(), id)).rejects.toMatchObject({ reason: "ads.notFound" });
    expect((await ads.listPlacements(rival())).rows).toEqual([]);
    await ads.cancelPlacement(admin(), id);
    expect((await ads.listPlacements(admin())).rows[0].cancellable).toBe(false);
  });
});

describe("the fee comes off the payout, once", () => {
  it("takes what has accrued, records it against the booking, and takes it only once", async () => {
    const net = await earned();
    const { id } = await ads.bookPlacement(owner(), home(1, 5));

    const [batch] = await runs.readyBatches(admin(), on(2));
    expect(batch.lines).toContainEqual({ orderId: null, reference: `AD-${id}`, amount: "-20.000", kind: "fee" });
    expect(Number(batch.total)).toBeCloseTo(net - 20, 3);

    await runs.recordPayout(admin(), ids.acme, "BANK-1", on(2));
    const items = await db.select().from(payoutRunItems).where(eq(payoutRunItems.bookingId, id));
    expect(items.map(item => item.amount)).toEqual(["-20.000"]);

    /* The same day again: nothing left to take. The next day: one more day. */
    expect(await runs.readyBatches(admin(), on(2))).toEqual([]);
    const [next] = await runs.readyBatches(admin(), on(3));
    expect(next).toMatchObject({ total: "-10.000", payable: false });

    const [row] = (await ads.listPlacements(owner(), {}, on(3))).rows;
    expect(row).toMatchObject({ accrued: "30.000", deducted: "20.000" });
  });
});
