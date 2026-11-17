/**
 * Paying a cash order online on NetLet's test page, and the driver's scan at
 * the door (0086), against a real Postgres: the figure the page showed is the
 * one paid, the books are not touched, the order comes off cash, items stay as
 * paid for, a cancel gives the payment back, and the scan hands over only the
 * driver's own parcels — at once when paid online, after the cash when not.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  courierMembers,
  couriers,
  orderHandovers,
  orderItems,
  orderPayments,
  orders,
  productVariants,
  products,
  users,
  vendors,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let ordersModule: typeof import("./orders.js");
let payments: typeof import("./onlinePayments.js");
let handovers: typeof import("./handovers.js");
let handover: typeof import("../core/handover.js");
let dispatch: typeof import("./dispatch.js");
let changes: typeof import("./orderChanges.js");

const ids = { admin: 0, shopper: 0, stranger: 0, driver: 0, rivalDriver: 0, acme: 0, lampVariant: 0, mugVariant: 0, swift: 0, rival: 0 };
const savedSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = "a-test-secret-that-is-long-enough-for-hmac";
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
  ordersModule = await import("./orders.js");
  payments = await import("./onlinePayments.js");
  handovers = await import("./handovers.js");
  handover = await import("../core/handover.js");
  dispatch = await import("./dispatch.js");
  changes = await import("./orderChanges.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();
  const [driver] = await db.insert(users).values({ email: "driver@swift.test" }).returning();
  const [rivalDriver] = await db.insert(users).values({ email: "driver@rival.test" }).returning();
  Object.assign(ids, { admin: admin.id, shopper: shopper.id, stranger: stranger.id, driver: driver.id, rivalDriver: rivalDriver.id });

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", deliveryFlat: "2.000" }).returning();
  ids.acme = acme.id;
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "12.000", stock: 50 }).returning();
  const [mug] = await db.insert(products).values({ vendorId: acme.id, handle: "mug", title: "Mug", status: "published" }).returning();
  const [mugVariant] = await db.insert(productVariants).values({ productId: mug.id, title: "Default", price: "4.000", stock: 50 }).returning();
  ids.lampVariant = lampVariant.id; ids.mugVariant = mugVariant.id;
}, 60_000);

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

beforeEach(async () => {
  await db.delete(orderHandovers);
  await db.delete(orderPayments);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(courierMembers);
  await db.delete(couriers);
  const [swift] = await db.insert(couriers).values({ name: "Swift Delivery" }).returning();
  const [rival] = await db.insert(couriers).values({ name: "Rival Logistics" }).returning();
  ids.swift = swift.id; ids.rival = rival.id;
  await db.insert(courierMembers).values([
    { courierId: swift.id, userId: ids.driver },
    { courierId: rival.id, userId: ids.rivalDriver },
  ]);
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const driver = (): Actor => ({ kind: "courier", userId: ids.driver, courierId: ids.swift });
const rival = (): Actor => ({ kind: "courier", userId: ids.rivalDriver, courierId: ids.rival });

async function place(lines: { variantId: number; quantity: number }[]) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
  for (const line of lines) await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  return ordersModule.placeOrder(cart.id, {
    email: "shopper@example.test",
    contactName: "A Shopper",
    contactPhone: "+96550000000",
    deliveryZoneId: "hawalli",
    addressLine: "Block 4, Street 12, House 7",
    paymentMethod: "cod",
    userId: ids.shopper,
  } as never);
}

const orderRow = async (id: number) => (await db.select().from(orders).where(eq(orders.id, id)))[0];

/** Give the whole order to Swift and send it on its way, as the board would. */
async function onTheWay(orderId: number) {
  const board = await dispatch.loadBoard(admin());
  for (const parcel of board.parcels.filter(one => one.orderId === orderId)) {
    await dispatch.assignParcel(admin(), orderId, parcel.key, ids.swift);
  }
  await db.update(orderItems).set({ fulfilment: "preparing" }).where(eq(orderItems.orderId, orderId));
  for (const parcel of (await dispatch.loadBoard(admin())).parcels.filter(one => one.orderId === orderId)) {
    await dispatch.moveParcel(driver(), orderId, parcel.key, "shipped");
  }
}

describe("paying a cash order online on the test page", () => {
  it("pays the figure the page showed, takes the order off cash and leaves the books alone", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]); // 12.000 + 2.000
    const reference = placed.order.reference;

    await expect(payments.startTestPayment(ids.shopper, reference, "knet", "13.000")).rejects.toMatchObject({ reason: "orders.payMoved" });
    const started = await payments.startTestPayment(ids.shopper, reference, "knet", "14.000");
    expect(started).toMatchObject({ method: "knet", amount: "14.000", reference });

    /* Another shopper cannot see or finish it. */
    expect(await payments.paymentForShopper(ids.stranger, started.paymentId)).toBeNull();
    await expect(payments.finishTestPayment(ids.stranger, started.paymentId, "paid")).rejects.toMatchObject({ reason: "orders.payNotFound" });

    const paid = await payments.finishTestPayment(ids.shopper, started.paymentId, "paid");
    expect(paid.status).toBe("paid");
    const order = await orderRow(placed.order.id);
    expect(order.paymentMethod).toBe("knet");
    /* No money moved, so nothing on the books says it did. */
    expect(order.status).toBe("pending_payment");
    expect(order.paymentCollectedAt).toBeNull();
    /* Nobody can record cash against it now. */
    expect(await ordersModule.recordCashCollected(admin(), placed.order.id)).toBe(false);

    const read = await payments.paidOnlineFor(db as never, [placed.order.id]);
    expect(read.get(placed.order.id)).toMatchObject({ method: "knet", amount: "14.000", test: true });

    /* Pressing again answers what the first press did, and paying twice is refused. */
    expect((await payments.finishTestPayment(ids.shopper, started.paymentId, "paid")).status).toBe("paid");
    await expect(payments.startTestPayment(ids.shopper, reference, "card", "14.000")).rejects.toMatchObject({ reason: "orders.payAlready" });
  });

  it("closes an earlier attempt when a new one starts, and backing out pays nothing", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    const first = await payments.startTestPayment(ids.shopper, placed.order.reference, "card", "14.000");
    const second = await payments.startTestPayment(ids.shopper, placed.order.reference, "apple_pay", "14.000");
    expect((await payments.paymentForShopper(ids.shopper, first.paymentId))?.status).toBe("failed");
    expect((await payments.finishTestPayment(ids.shopper, first.paymentId, "paid")).status).toBe("failed");

    expect((await payments.finishTestPayment(ids.shopper, second.paymentId, "cancelled")).status).toBe("failed");
    expect((await orderRow(placed.order.id)).paymentMethod).toBe("cod");
  });

  it("refuses to pay at a figure the order no longer owes", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.mugVariant, quantity: 1 }]); // 16 + 2
    const started = await payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "18.000");
    /* The store cancels the mug between the two presses. */
    const [mugLine] = await db.select().from(orderItems).where(eq(orderItems.variantId, ids.mugVariant));
    await db.update(orderItems).set({ fulfilment: "cancelled" }).where(eq(orderItems.id, mugLine.id));

    await expect(payments.finishTestPayment(ids.shopper, started.paymentId, "paid")).rejects.toMatchObject({ reason: "orders.payMoved" });
    expect((await payments.paymentForShopper(ids.shopper, started.paymentId))?.status).toBe("failed");
    expect((await orderRow(placed.order.id)).paymentMethod).toBe("cod");
  });

  it("is open while the driver is on the way and closed once it has arrived", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    await onTheWay(placed.order.id);
    const started = await payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "14.000");
    expect(started.amount).toBe("14.000");
    await payments.finishTestPayment(ids.shopper, started.paymentId, "cancelled");

    await db.update(orderItems).set({ fulfilment: "delivered" }).where(eq(orderItems.orderId, placed.order.id));
    await expect(payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "14.000")).rejects.toMatchObject({ reason: "orders.payDelivered" });
  });

  it("keeps the items as paid for, the address free to change, and gives it back on a cancel", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 2 }]);
    const started = await payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "26.000");
    await payments.finishTestPayment(ids.shopper, started.paymentId, "paid");

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    await expect(changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 1 }]))
      .rejects.toMatchObject({ reason: "orders.changePaidOnline" });

    await ordersModule.cancelOrderForShopper(ids.shopper, placed.order.reference);
    expect((await orderRow(placed.order.id)).status).toBe("cancelled");
    expect((await payments.paymentForShopper(ids.shopper, started.paymentId))?.status).toBe("refunded");
  });
});

describe("the driver's scan at the door", () => {
  it("hands the parcel over at once when it was paid online, and records it", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    await onTheWay(placed.order.id);
    const started = await payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "14.000");
    await payments.finishTestPayment(ids.shopper, started.paymentId, "paid");

    /* The board says to collect nothing. */
    const parcel = (await dispatch.loadBoard(driver())).parcels.find(one => one.orderId === placed.order.id)!;
    expect(parcel.paidOnline).toEqual({ method: "knet", test: true });

    const { token } = handover.handoverFor(placed.order.id)!;
    /* Another company's driver cannot use it. */
    await expect(handovers.handOver(rival(), { token })).rejects.toMatchObject({ reason: "dispatch.notYours" });

    const answer = await handovers.handOver(driver(), { token });
    expect(answer).toMatchObject({ done: true, payment: { kind: "online", method: "knet", test: true } });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(lines.every(one => one.fulfilment === "delivered" && one.deliveredAt !== null)).toBe(true);
    const rows = await handovers.handoversFor(placed.order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scannedBy: ids.driver, paidOnline: true });

    /* Scanned again: already handed over. */
    await expect(handovers.handOver(driver(), { token })).rejects.toMatchObject({ reason: "dispatch.scanDelivered" });
  });

  it("says what to collect for cash, and hands over only once the cash is in hand", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    await onTheWay(placed.order.id);
    const { code } = handover.handoverFor(placed.order.id)!;

    const asked = await handovers.handOver(driver(), { orderId: placed.order.id, code: code.toLowerCase().replace(/(.{4})/, "$1 ") });
    expect(asked).toMatchObject({ done: false, payment: { kind: "cash", collect: "14.000" } });
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)))[0].fulfilment).toBe("shipped");

    const handed = await handovers.handOver(driver(), { orderId: placed.order.id, code, cashReceived: true });
    expect(handed.done).toBe(true);
    expect((await handovers.handoversFor(placed.order.id))[0]).toMatchObject({ paidOnline: false });
    /* The cash is still the store's or NetLet's to record, as before. */
    expect((await orderRow(placed.order.id)).status).toBe("pending_payment");
  });

  it("refuses a code it did not make, another order's code, and a parcel not yet collected", async () => {
    const one = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    const two = await place([{ variantId: ids.mugVariant, quantity: 1 }]);
    await expect(handovers.handOver(driver(), { token: "h1.1.AAAAAAAAAAAAAAAAAAAAAAAA" })).rejects.toMatchObject({ reason: "dispatch.scanUnknown" });
    const otherCode = handover.handoverFor(two.order.id)!.code;
    await expect(handovers.handOver(driver(), { orderId: one.order.id, code: otherCode })).rejects.toMatchObject({ reason: "dispatch.scanUnknown" });

    const board = await dispatch.loadBoard(admin());
    for (const parcel of board.parcels.filter(p => p.orderId === one.order.id)) await dispatch.assignParcel(admin(), one.order.id, parcel.key, ids.swift);
    await expect(handovers.handOver(driver(), { token: handover.handoverFor(one.order.id)!.token })).rejects.toMatchObject({ reason: "dispatch.scanNotCollected" });
  });
});

describe("before 0086 is pasted", () => {
  it("offers nothing, reads nothing paid, and still hands a parcel over", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    await onTheWay(placed.order.id);
    await client.exec("ALTER TABLE order_payments RENAME TO order_payments_away; ALTER TABLE order_handovers RENAME TO order_handovers_away;");
    try {
      expect(await payments.onlinePaymentsReady()).toBe(false);
      expect((await payments.paidOnlineFor(db as never, [placed.order.id])).size).toBe(0);
      await expect(payments.startTestPayment(ids.shopper, placed.order.reference, "knet", "14.000")).rejects.toMatchObject({ reason: "orders.payUnavailable" });
      expect((await dispatch.loadBoard(driver())).parcels.find(one => one.orderId === placed.order.id)?.paidOnline).toBeNull();

      const { token } = handover.handoverFor(placed.order.id)!;
      const asked = await handovers.handOver(driver(), { token, cashReceived: true });
      expect(asked.done).toBe(true);
      /* A cancel still closes the order with no table to give a payment back in. */
      const other = await place([{ variantId: ids.mugVariant, quantity: 1 }]);
      await ordersModule.cancelOrderForShopper(ids.shopper, other.order.reference);
      expect((await orderRow(other.order.id)).status).toBe("cancelled");
    } finally {
      await client.exec("ALTER TABLE order_payments_away RENAME TO order_payments; ALTER TABLE order_handovers_away RENAME TO order_handovers;");
    }
  });
});
