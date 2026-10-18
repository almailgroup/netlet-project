/**
 * Paid placements against a real Postgres (3.3.15).
 *
 * The day arithmetic and the fee are proved pure in
 * `Shared/commerce/adBookings.test.ts`. What needs a database is the half that
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
  mediaFiles,
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
} from "../../database/schema.js";
import { addDays, kuwaitToday } from "../../../Shared/commerce/adBookings.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let ads: typeof import("./adBookings.js");
let runs: typeof import("./payoutRuns.js");
let ordersModule: typeof import("./orders.js");

const people = {} as Record<"shopper" | "owner" | "manager" | "rival" | "admin", User>;
const ids = { acme: 0, beta: 0, lamp: 0, lampVariant: 0, rug: 0, betaVase: 0, home: 0 };
/* Uploads: a banner-shaped one each for Acme and Beta, and a square one for Acme. */
const media = { acme: "acmeBanner000000000001", beta: "betaBanner000000000001", square: "acmeSquare000000000001" };

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

  const upload = (id: string, vendorId: number, width: number, height: number) =>
    ({ id, vendorId, contentType: "image/webp", bytes: new Uint8Array([1, 2, 3]), width, height, byteSize: 3 });
  await db.insert(mediaFiles).values([
    upload(media.acme, acme.id, 1500, 500),
    upload(media.beta, beta.id, 1500, 500),
    upload(media.square, acme.id, 1000, 1000),
  ]);
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

    const run = await runs.preparePayout(admin(), ids.acme, on(2));
    await runs.markPayoutSent(admin(), { runId: run.id }, "BANK-1", on(2));
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

describe("home banners", () => {
  const banner = (startOffset: number, days: number, extra: Partial<{ mediaId: string; headline: string; headlineAr: string | null }> = {}) => ({
    ...home(startOffset, days),
    slot: "home_banner" as const,
    banner: { mediaId: media.acme, headline: "Lamps for the long evenings", headlineAr: null, ...extra },
  });

  it("needs this store's own banner-shaped picture and a headline with no contact details", async () => {
    await earned();
    await expect(ads.bookPlacement(owner(), { ...banner(1, 3), banner: null })).rejects.toMatchObject({ reason: "ads.bannerNeedsImage" });
    await expect(ads.bookPlacement(owner(), banner(1, 3, { mediaId: media.beta }))).rejects.toMatchObject({ reason: "ads.bannerNeedsImage" });
    await expect(ads.bookPlacement(owner(), banner(1, 3, { mediaId: media.square }))).rejects.toMatchObject({ reason: "ads.bannerShape" });
    await expect(ads.bookPlacement(owner(), banner(1, 3, { headline: "  " }))).rejects.toMatchObject({ reason: "ads.bannerNeedsHeadline" });
    await expect(ads.bookPlacement(owner(), banner(1, 3, { headline: "Call 99887766 for lamps" }))).rejects.toMatchObject({ reason: "ads.bannerContact" });
    await expect(ads.bookPlacement(owner(), banner(1, 3, { headlineAr: "تواصل معنا على انستغرام: @acme.kw" }))).rejects.toMatchObject({ reason: "ads.bannerContact" });
  });

  it("waits for NetLet: not shown, not charged, but holding its place and its price", async () => {
    const net = await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 5));
    const [row] = (await ads.listPlacements(owner(), {}, on(2))).rows;
    expect(row).toMatchObject({ state: "inReview", accrued: "0.000", banner: { status: "pending", headline: "Lamps for the long evenings" } });
    expect(row.banner?.imageUrl).toBe(`/media/${media.acme}.webp`);
    expect(await ads.bannersToday({}, on(2))).toEqual([]);

    /* Its full price is still committed against the store's earnings. */
    expect(Number((await ads.quotePlacement(owner(), home(10, 1), on(2))).room)).toBeCloseTo(net - 125, 3);
    /* And the payout run takes nothing for it. */
    const [batch] = await runs.readyBatches(admin(), on(3));
    expect(batch.lines.filter((line: { kind: string }) => line.kind === "fee")).toEqual([]);
    expect(await ads.countWaitingBanners(admin(), on(2))).toBe(1);
    expect((await ads.listPlacements(admin(), { waiting: true }, on(2))).rows.map(r => r.id)).toEqual([id]);
  });

  it("approved after its first day, runs from the day of approval and charges only those days", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 5));
    const approved = await ads.reviewBanner(admin(), { id, decision: "approve" }, on(3));
    expect(approved).toEqual({ startsOn: addDays(today, 3), status: "approved" });

    const shown = await ads.bannersToday({}, on(3));
    expect(shown).toEqual([{ id, imageUrl: `/media/${media.acme}.webp`, headline: "Lamps for the long evenings", productHandle: "lamp", storeName: "Acme" }]);
    const [row] = (await ads.listPlacements(owner(), {}, on(4))).rows;
    expect(row).toMatchObject({ state: "running", startsOn: addDays(today, 3), total: "75.000", accrued: "50.000" });

    const [batch] = await runs.readyBatches(admin(), on(4));
    expect(batch.lines).toContainEqual({ orderId: null, reference: `AD-${id}`, amount: "-50.000", kind: "fee" });
    await expect(ads.reviewBanner(admin(), { id, decision: "reject", note: "late" }, on(4))).rejects.toMatchObject({ reason: "ads.bannerNotWaiting" });
  });

  it("speaks the reader's language when the store wrote it, and leaves with its product", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 2, { headlineAr: "مصابيح للأمسيات الطويلة" }));
    await ads.reviewBanner(admin(), { id, decision: "approve" }, on(0));
    expect((await ads.bannersToday({ locale: "ar" }, on(1)))[0].headline).toBe("مصابيح للأمسيات الطويلة");
    expect((await ads.bannersToday({ locale: "en" }, on(1)))[0].headline).toBe("Lamps for the long evenings");
    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.lamp));
    expect(await ads.bannersToday({}, on(1))).toEqual([]);
  });

  it("turned down says why, costs nothing and gives back its place and its price", async () => {
    const net = await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 5));
    await expect(ads.reviewBanner(admin(), { id, decision: "reject", note: " " }, on(0))).rejects.toMatchObject({ reason: "ads.bannerNeedsNote" });
    await ads.reviewBanner(admin(), { id, decision: "reject", note: "The picture is mostly text." }, on(2));
    const [row] = (await ads.listPlacements(owner(), {}, on(3))).rows;
    expect(row).toMatchObject({ state: "rejected", accrued: "0.000", cancellable: false, banner: { status: "rejected", note: "The picture is mostly text." } });
    expect(Number((await ads.quotePlacement(owner(), home(10, 1), on(3))).room)).toBeCloseTo(net, 3);
    await expect(ads.reviewBanner(admin(), { id, decision: "approve" }, on(3))).rejects.toMatchObject({ reason: "ads.bannerNotWaiting" });
  });

  it("past its last day unanswered can only be turned down, and stops holding the store's money", async () => {
    const net = await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 2));
    await expect(ads.reviewBanner(admin(), { id, decision: "approve" }, on(4))).rejects.toMatchObject({ reason: "ads.bannerLapsed" });
    expect(Number((await ads.quotePlacement(owner(), home(10, 1), on(4))).room)).toBeCloseTo(net, 3);
    expect(await ads.countWaitingBanners(admin(), on(4))).toBe(0);
  });

  it("is NetLet's to answer, not a store's", async () => {
    await earned();
    const { id } = await ads.bookPlacement(owner(), banner(1, 2));
    await expect(appRouter.createCaller(contextFor(people.owner)).ads.reviewBanner({ id, decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(contextFor(people.owner)).ads.bannersWaiting()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("holds three a day, waiting ones included", async () => {
    await earned();
    for (let i = 0; i < 3; i++) await ads.bookPlacement(owner(), banner(1, 1));
    await expect(ads.bookPlacement(owner(), banner(1, 1))).rejects.toMatchObject({ reason: "ads.full" });
  });

  it("is never offered to the product shelves' read", async () => {
    await expect(appRouter.createCaller(contextFor(people.shopper)).ads.sponsored({ slot: "home_banner" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
