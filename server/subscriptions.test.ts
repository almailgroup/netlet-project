/**
 * Subscribe & Save against a real Postgres (3.1.19).
 *
 * The saving, the ceiling and the cadence are proved pure in
 * `Shared/commerce/subscriptions.test.ts`. What needs a database is what a
 * scheduled run actually does: place an ordinary order at the subscriber's
 * price, exactly once however often it is called, and stop — rather than
 * charge more — when the price has moved above what the shopper agreed to.
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
  customerAddresses,
  invoiceCounters,
  invoices,
  orderItems,
  orders,
  productVariants,
  products,
  subscriptions,
  users,
  vendors,
  type User,
} from "../drizzle/schema.js";
import { addDays, kuwaitToday } from "../Shared/commerce/adBookings.js";

let db: ReturnType<typeof drizzle>;
let subs: typeof import("./subscriptions.js");

const people = {} as Record<"noura" | "fahad", User>;
const ids = { acme: 0, rice: 0, riceVariant: 0, home: 0, fahadHome: 0 };
const today = kuwaitToday(new Date());
const on = (offset: number) => new Date(`${addDays(today, offset)}T06:00:00Z`);

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
  subs = await import("./subscriptions.js");

  for (const who of ["noura", "fahad"] as const) {
    const [row] = await db.insert(users).values({ email: `${who}@shop.test`, name: who }).returning();
    people[who] = row;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  ids.acme = acme.id;
  const [rice] = await db.insert(products).values({ vendorId: acme.id, handle: "rice", title: "Basmati Rice", status: "published" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: rice.id, title: "5 kg", sku: "RICE", price: "10.000", stock: 50 }).returning();
  ids.rice = rice.id; ids.riceVariant = variant.id;
  const [home] = await db.insert(customerAddresses).values({ userId: people.noura.id, label: "Home", governorate: "hawalli", addressLine: "Block 4, Street 12", contactPhone: "+96550000000" }).returning();
  ids.home = home.id;
  const [fahadHome] = await db.insert(customerAddresses).values({ userId: people.fahad.id, label: "Home", addressLine: "Block 1" }).returning();
  ids.fahadHome = fahadHome.id;
}, 60_000);

beforeEach(async () => {
  await db.update(orders).set({ subscriptionId: null });
  await db.delete(subscriptions);
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(productVariants).set({ price: "10.000", stock: 50 }).where(eq(productVariants.id, ids.riceVariant));
  await db.update(products).set({ status: "published" }).where(eq(products.id, ids.rice));
  /* Offers 10% and holds a permit with no recorded expiry. */
  await db.update(vendors).set({ subscriptionPercent: "10.00", discountLicenceNumber: "MOCI-DISC-1", discountLicenceExpiresAt: null }).where(eq(vendors.id, ids.acme));
});

const request = (overrides: Partial<{ quantity: number; intervalWeeks: number; addressId: number; firstRunOn: string }> = {}) => ({
  variantId: ids.riceVariant, quantity: 2, intervalWeeks: 2, addressId: ids.home, firstRunOn: addDays(today, 1), ...overrides,
});

describe("subscribing", () => {
  it("agrees the subscriber's price as the ceiling, and places nothing yet", async () => {
    const sub = await subs.subscribe(people.noura.id, request());
    expect(sub.priceCeiling).toBe("9.000");
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("saves nothing without a valid permit, and is absent where the store offers none", async () => {
    await db.update(vendors).set({ discountLicenceNumber: null });
    expect((await subs.subscribe(people.noura.id, request())).priceCeiling).toBe("10.000");
    await db.delete(subscriptions);
    await db.update(vendors).set({ subscriptionPercent: null });
    await expect(subs.subscribe(people.noura.id, request())).rejects.toMatchObject({ reason: "subscriptions.notOffered" });
  });

  it("refuses a second open one for the same thing, somebody else's address, and today", async () => {
    await subs.subscribe(people.noura.id, request());
    await expect(subs.subscribe(people.noura.id, request())).rejects.toMatchObject({ reason: "subscriptions.alreadyOpen" });
    await expect(subs.subscribe(people.fahad.id, request())).rejects.toMatchObject({ reason: "subscriptions.unknownAddress" });
    await expect(subs.subscribe(people.fahad.id, request({ addressId: ids.fahadHome, firstRunOn: today }))).rejects.toMatchObject({ reason: "subscriptions.tooSoon" });
  });

  it("is the subscriber's own to change", async () => {
    const sub = await subs.subscribe(people.noura.id, request());
    await expect(subs.changeSubscription(people.fahad.id, sub.id, { action: "cancel" })).rejects.toMatchObject({ reason: "subscriptions.notFound" });
    await subs.changeSubscription(people.noura.id, sub.id, { action: "skip" });
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(row.nextRunOn).toBe(addDays(today, 15));
  });
});

describe("a run", () => {
  it("places an ordinary cash order at the subscriber's price, and moves on", async () => {
    const sub = await subs.subscribe(people.noura.id, request());
    const summary = await subs.runDueSubscriptions(on(1));
    expect(summary).toMatchObject({ due: 1, placed: 1 });

    const [order] = await db.select().from(orders);
    expect(order).toMatchObject({ subscriptionId: sub.id, paymentMethod: "cod", status: "pending_payment", addressLine: "Block 4, Street 12" });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(line).toMatchObject({ unitPrice: "9.000", quantity: 2, lineTotal: "18.000" });

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(row).toMatchObject({ lastOutcome: "placed", lastOrderId: order.id, nextRunOn: addDays(today, 15), status: "active" });
    /* The cart it used is gone. */
    expect(await db.select().from(carts)).toHaveLength(0);
  });

  it("places once however often it is called", async () => {
    await subs.subscribe(people.noura.id, request());
    const [first, second] = await Promise.all([subs.runDueSubscriptions(on(1)), subs.runDueSubscriptions(on(1))]);
    expect(first.placed + second.placed).toBe(1);
    expect(await subs.runDueSubscriptions(on(1))).toMatchObject({ due: 0, placed: 0 });
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it("pauses rather than charging above the agreed price, until the shopper accepts the new one", async () => {
    const sub = await subs.subscribe(people.noura.id, request());
    await db.update(productVariants).set({ price: "12.000" }).where(eq(productVariants.id, ids.riceVariant));
    expect(await subs.runDueSubscriptions(on(1))).toMatchObject({ placed: 0, paused: 1 });
    expect(await db.select().from(orders)).toHaveLength(0);

    await expect(subs.changeSubscription(people.noura.id, sub.id, { action: "resume" })).rejects.toMatchObject({ reason: "subscriptions.priceChanged" });
    /* A price the page showed that has since moved again is not accepted. */
    await expect(subs.changeSubscription(people.noura.id, sub.id, { action: "acceptPrice", price: "10.000" })).rejects.toMatchObject({ reason: "subscriptions.priceChanged" });
    await subs.changeSubscription(people.noura.id, sub.id, { action: "acceptPrice", price: "10.800" });
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(row).toMatchObject({ status: "active", priceCeiling: "10.800", pausedReason: null });
  });

  it("pauses when the permit lapses and the saving with it", async () => {
    await subs.subscribe(people.noura.id, request());
    await db.update(vendors).set({ discountLicenceExpiresAt: new Date(Date.now() - 86_400_000) });
    expect(await subs.runDueSubscriptions(on(1))).toMatchObject({ paused: 1 });
    const [row] = await db.select().from(subscriptions);
    expect(row.pausedReason).toBe("priceRose");
  });

  it("passes a lower price on without asking", async () => {
    await subs.subscribe(people.noura.id, request());
    await db.update(productVariants).set({ price: "8.000" }).where(eq(productVariants.id, ids.riceVariant));
    await subs.runDueSubscriptions(on(1));
    const [line] = await db.select().from(orderItems);
    expect(line.unitPrice).toBe("7.200");
  });

  it("skips a delivery that is out of stock and keeps standing", async () => {
    await subs.subscribe(people.noura.id, request());
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.id, ids.riceVariant));
    expect(await subs.runDueSubscriptions(on(1))).toMatchObject({ outOfStock: 1 });
    const [row] = await db.select().from(subscriptions);
    expect(row).toMatchObject({ status: "active", lastOutcome: "outOfStock", nextRunOn: addDays(today, 15) });
    expect(await db.select().from(carts)).toHaveLength(0);
  });

  it("pauses when its address is gone or the product is off the shelf", async () => {
    const [spare] = await db.insert(customerAddresses).values({ userId: people.noura.id, label: "Office", addressLine: "Tower 3" }).returning();
    await subs.subscribe(people.noura.id, request({ addressId: spare.id }));
    await db.delete(customerAddresses).where(eq(customerAddresses.id, spare.id));
    await subs.runDueSubscriptions(on(1));
    expect((await db.select().from(subscriptions))[0].pausedReason).toBe("noAddress");

    await db.delete(subscriptions);
    await subs.subscribe(people.noura.id, request());
    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.rice));
    await subs.runDueSubscriptions(on(1));
    expect((await db.select().from(subscriptions))[0].pausedReason).toBe("unavailable");
  });

  it("does not run a paused or stopped one, and runs a missed one once", async () => {
    const sub = await subs.subscribe(people.noura.id, request());
    await subs.changeSubscription(people.noura.id, sub.id, { action: "pause" });
    expect(await subs.runDueSubscriptions(on(1))).toMatchObject({ due: 0 });
    await subs.changeSubscription(people.noura.id, sub.id, { action: "resume" });
    /* Five weeks late on a fortnightly order: one order, then the next date ahead. */
    expect(await subs.runDueSubscriptions(on(36))).toMatchObject({ placed: 1 });
    const [row] = await db.select().from(subscriptions);
    expect(row.nextRunOn > addDays(today, 36)).toBe(true);
    await subs.changeSubscription(people.noura.id, sub.id, { action: "cancel" });
    expect(await subs.runDueSubscriptions(on(80))).toMatchObject({ due: 0 });
  });
});
