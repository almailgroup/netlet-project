/**
 * The inbox and its email against a real Postgres.
 *
 * The rules are proved pure in `Shared/commerce/notices.test.ts`. What needs a
 * database is that the acts which already happen in the shop tell the right
 * person once — a restock, a cheaper price, an order placed, shipped and
 * delivered, a cancelled line, a forgotten basket — that a preference and the
 * email switch are honoured, that an email that fails is tried again and
 * then given up on, and that nobody can read or clear somebody else's inbox.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  customerNotificationPreferences,
  customerPreferences,
  followedProducts,
  notificationDeliveries,
  notifications as noticeTable,
  orderItems,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import { EMAIL_ATTEMPTS } from "../../../Shared/commerce/notices.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let notices: typeof import("./notifications.js");
let inventory: typeof import("./inventory.js");
let ordersModule: typeof import("./orders.js");
let email: typeof import("../core/email.js");
const ids = { noura: 0, fahad: 0, owner: 0, acme: 0, lamp: 0, lampVariant: 0, chair: 0, chairVariant: 0 };
const sent: { to: string[]; subject: string }[] = [];
let failNext = 0;

const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });

async function inbox(userId: number) {
  return db.select().from(noticeTable).where(eq(noticeTable.userId, userId));
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("NOTIFY_EMAIL_FROM", "NetLet <hello@netlet.test>");
  vi.stubEnv("SITE_URL", "https://netlet.test");
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  vi.doMock("./features", () => ({ featureOn: async () => true }));
  email = await import("../core/email.js");
  email.setEmailTransport(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    if (failNext > 0) {
      failNext -= 1;
      return new Response("provider down", { status: 503 });
    }
    sent.push({ to: body.to, subject: body.subject });
    return new Response("{}", { status: 200 });
  });
  notices = await import("./notifications.js");
  inventory = await import("./inventory.js");
  ordersModule = await import("./orders.js");

  for (const [key, address] of [["noura", "noura@shop.test"], ["fahad", "fahad@shop.test"], ["owner", "owner@acme.test"]] as const) {
    const [row] = await db.insert(users).values({ email: address, role: "user" }).returning();
    ids[key] = row.id;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved" }).returning();
  ids.acme = acme.id;
  await db.insert(vendorMembers).values({ vendorId: acme.id, userId: ids.owner, role: "owner" });
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Lamp", titleAr: "مصباح", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Default", sku: "LAMP", price: "20.000", stock: 0 }).returning();
  const [chair] = await db.insert(products).values({ vendorId: acme.id, handle: "chair", title: "Chair", status: "published" }).returning();
  const [chairVariant] = await db.insert(productVariants).values({ productId: chair.id, title: "Default", sku: "CHAIR", price: "45.000", stock: 10 }).returning();
  Object.assign(ids, { lamp: lamp.id, lampVariant: lampVariant.id, chair: chair.id, chairVariant: chairVariant.id });
}, 60_000);

beforeEach(() => {
  sent.length = 0;
  failNext = 0;
});

afterEach(async () => {
  await db.delete(noticeTable);
  await db.delete(followedProducts);
  await db.delete(customerNotificationPreferences);
});

describe("telling somebody", () => {
  it("writes the same event once, however often it is told", async () => {
    const notice = { userId: ids.noura, kind: "back_in_stock" as const, params: { product: "Lamp" }, link: "/products/lamp", dedupe: "stock:x:2026-10-18" };
    expect(await notices.notify(notice)).toBe(1);
    expect(await notices.notify([notice, notice])).toBe(0);
    expect(await inbox(ids.noura)).toHaveLength(1);
  });

  it("drops a link to another site rather than storing it", async () => {
    await notices.notify({ userId: ids.noura, kind: "support_answered", link: "https://evil.example/", dedupe: "support:1:x" });
    const [row] = await inbox(ids.noura);
    expect(row.link).toBeNull();
  });

  it("writes nothing a preference has silenced", async () => {
    await db.insert(customerNotificationPreferences).values({ userId: ids.noura, kind: "price_drop", enabled: false });
    expect(await notices.notify({ userId: ids.noura, kind: "price_drop", params: { product: "Lamp", price: "1.000" }, dedupe: "price:x" })).toBe(0);
    expect(await notices.notify({ userId: ids.noura, kind: "order_placed", params: { reference: "NL-1" }, dedupe: "order:NL-1:placed" })).toBe(1);
  });
});

describe("followers", () => {
  it("hears a product came back, once, and only if they asked to", async () => {
    await db.insert(followedProducts).values([
      { userId: ids.noura, productId: String(ids.lamp), backInStock: true, priceDrop: false },
      { userId: ids.fahad, productId: String(ids.lamp), backInStock: false, priceDrop: true },
    ]);
    await inventory.adjustStock(owner(), ids.lampVariant, 5, "received");
    const [told] = await inbox(ids.noura);
    expect(told.kind).toBe("back_in_stock");
    expect(told.link).toBe("/products/lamp");
    expect(told.params).toMatchObject({ product: "Lamp", productAr: "مصباح" });
    expect(await inbox(ids.fahad)).toHaveLength(0);
    /* More of something already on the shelf is not news. */
    await inventory.adjustStock(owner(), ids.lampVariant, 2, "received");
    expect(await inbox(ids.noura)).toHaveLength(1);
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, ids.lampVariant));
  });

  it("hears a lower price, and not the same price again after it goes back up", async () => {
    await db.insert(followedProducts).values({ userId: ids.noura, productId: String(ids.chair), backInStock: false, priceDrop: true });
    await inventory.saveVariant(owner(), { id: ids.chairVariant, productId: ids.chair, title: "Default", price: "40.000" });
    let rows = await inbox(ids.noura);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "price_drop", params: { product: "Chair", price: "40.000" } });
    const [follow] = await db.select().from(followedProducts).where(eq(followedProducts.userId, ids.noura));
    expect(follow.lastNotifiedPrice).toBe("40.000");

    await inventory.saveVariant(owner(), { id: ids.chairVariant, productId: ids.chair, title: "Default", price: "45.000" });
    await inventory.saveVariant(owner(), { id: ids.chairVariant, productId: ids.chair, title: "Default", price: "40.000" });
    rows = await inbox(ids.noura);
    expect(rows).toHaveLength(1);

    await inventory.saveVariant(owner(), { id: ids.chairVariant, productId: ids.chair, title: "Default", price: "38.000" });
    expect(await inbox(ids.noura)).toHaveLength(2);
    await inventory.saveVariant(owner(), { id: ids.chairVariant, productId: ids.chair, title: "Default", price: "45.000" });
  });
});

describe("an order, from placing to the door", () => {
  it("tells the shopper and the store, and the shopper again as it moves", async () => {
    const [cart] = await db.insert(carts).values({ id: "cart-notices", userId: ids.noura }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.chairVariant, quantity: 2 });
    const placed = await ordersModule.placeOrder(cart.id, {
      email: "noura@shop.test", userId: ids.noura, contactName: "Noura", contactPhone: "+96550000000",
      deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
    });
    const reference = placed.order.reference;
    expect((await inbox(ids.noura)).map(row => row.kind)).toEqual(["order_placed"]);
    expect((await inbox(ids.owner)).map(row => row.kind)).toEqual(["seller_new_order"]);
    /* Both were emailed, at once. */
    expect(sent.map(mail => mail.to[0]).sort()).toEqual(["noura@shop.test", "owner@acme.test"]);

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    await ordersModule.setLineFulfilment(owner(), line.id, "preparing");
    await ordersModule.setLineFulfilment(owner(), line.id, "shipped");
    await ordersModule.setLineFulfilment(owner(), line.id, "delivered");
    const kinds = (await inbox(ids.noura)).map(row => row.kind).sort();
    expect(kinds).toEqual(["order_delivered", "order_on_the_way", "order_placed"]);
    const delivered = (await inbox(ids.noura)).find(row => row.kind === "order_delivered")!;
    expect(delivered.params).toEqual({ reference });
    expect(delivered.link).toBe(`/account/orders?order=${encodeURIComponent(reference)}`);
  });

  it("tells the shopper a line was cancelled", async () => {
    const [cart] = await db.insert(carts).values({ id: "cart-cancel", userId: ids.noura }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.chairVariant, quantity: 1 });
    const placed = await ordersModule.placeOrder(cart.id, {
      email: "noura@shop.test", userId: ids.noura, contactName: "Noura", contactPhone: "+96550000000",
      deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod",
    });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    await ordersModule.setLineFulfilment(owner(), line.id, "cancelled");
    const cancelled = (await inbox(ids.noura)).find(row => row.kind === "line_cancelled");
    expect(cancelled?.params).toMatchObject({ product: "Chair", reference: placed.order.reference });
  });
});

describe("email", () => {
  it("sends nothing to somebody who turned it off, and keeps the inbox", async () => {
    await notices.setEmailPreference(ids.fahad, false);
    await notices.notify({ userId: ids.fahad, kind: "support_answered", link: "/account/help", dedupe: "support:9:x" });
    expect(await inbox(ids.fahad)).toHaveLength(1);
    expect(sent).toHaveLength(0);
    await notices.setEmailPreference(ids.fahad, true);
  });

  it("tries a failed email again later, and gives up after the last attempt", async () => {
    failNext = 100;
    await notices.notify({ userId: ids.noura, kind: "support_answered", link: "/account/help", dedupe: "support:retry" });
    const [row] = await db.select().from(notificationDeliveries).innerJoin(noticeTable, eq(noticeTable.id, notificationDeliveries.notificationId)).where(eq(noticeTable.dedupeKey, "support:retry"));
    expect(row.notification_deliveries).toMatchObject({ status: "pending", attempts: 1 });
    /* Not due yet: the sweep leaves it alone. */
    expect((await notices.sendDueEmails(50, new Date())).failed).toBe(0);
    let at = new Date();
    for (let attempt = 2; attempt <= EMAIL_ATTEMPTS; attempt += 1) {
      at = new Date(at.getTime() + 24 * 3_600_000);
      await notices.sendDueEmails(50, at);
    }
    const [after] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, row.notification_deliveries.id));
    expect(after).toMatchObject({ status: "failed", attempts: EMAIL_ATTEMPTS });
    expect(after.lastError).toContain("503");
  });

  it("sends a pending email on the sweep once the provider is back", async () => {
    failNext = 1;
    await notices.notify({ userId: ids.noura, kind: "support_answered", link: "/account/help", dedupe: "support:later" });
    expect(sent).toHaveLength(0);
    const later = new Date(Date.now() + 10 * 60_000);
    expect(await notices.sendDueEmails(50, later)).toEqual({ sent: 1, failed: 0 });
    expect(sent[0].subject).toBe("NetLet replied to your message.");
  });

  it("writes the email in the shopper's language", async () => {
    await db.insert(customerPreferences).values({ userId: ids.fahad, locale: "ar" }).onConflictDoUpdate({ target: customerPreferences.userId, set: { locale: "ar" } });
    await notices.notify({ userId: ids.fahad, kind: "back_in_stock", params: { product: "Lamp", productAr: "مصباح" }, link: "/products/lamp", dedupe: "stock:ar" });
    expect(sent[0].subject).toBe("مصباح متوفر من جديد.");
  });
});

describe("the inbox is its owner's", () => {
  it("lists newest first, counts unread, and marks only the reader's own", async () => {
    await notices.notify([
      { userId: ids.noura, kind: "support_answered", dedupe: "a" },
      { userId: ids.noura, kind: "seller_message", params: { store: "Acme" }, dedupe: "b" },
      { userId: ids.fahad, kind: "support_answered", dedupe: "c" },
    ]);
    const mine = await notices.inboxFor(ids.noura);
    expect(mine.total).toBe(2);
    expect(mine.unread).toBe(2);
    const fahads = await notices.inboxFor(ids.fahad);
    /* Fahad naming Noura's notices marks nothing. */
    await notices.markNoticesRead(ids.fahad, mine.entries.map(entry => entry.id));
    expect(await notices.unreadNotices(ids.noura)).toBe(2);
    await notices.markNoticesRead(ids.noura, [mine.entries[0].id]);
    expect(await notices.unreadNotices(ids.noura)).toBe(1);
    await notices.markNoticesRead(ids.noura, "all");
    expect(await notices.unreadNotices(ids.noura)).toBe(0);
    expect(await notices.unreadNotices(ids.fahad)).toBe(fahads.unread);
  });
});

describe("forgotten baskets", () => {
  it("reminds an account once about a basket left in the window, and never a guest", async () => {
    await db.insert(customerNotificationPreferences).values({ userId: ids.fahad, kind: "bag_reminder", enabled: true });
    const left = new Date(Date.now() - 8 * 3_600_000);
    await db.insert(carts).values([
      { id: "left-fahad", userId: ids.fahad, updatedAt: left },
      { id: "left-guest", userId: null, updatedAt: left },
      { id: "fresh-fahad", userId: ids.fahad },
    ]);
    await db.insert(cartItems).values([
      { cartId: "left-fahad", variantId: ids.chairVariant, quantity: 3 },
      { cartId: "left-guest", variantId: ids.chairVariant, quantity: 1 },
      { cartId: "fresh-fahad", variantId: ids.chairVariant, quantity: 1 },
    ]);
    expect(await notices.remindAbandonedBags()).toBe(1);
    expect(await notices.remindAbandonedBags()).toBe(0);
    const [reminder] = await db.select().from(noticeTable).where(and(eq(noticeTable.userId, ids.fahad), eq(noticeTable.kind, "bag_reminder")));
    expect(reminder).toMatchObject({ params: { count: 3 }, link: "/cart" });
  });
});
