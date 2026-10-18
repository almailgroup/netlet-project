/**
 * Fulfilled by NetLet (4.2) against a real Postgres.
 *
 * The rules are proved pure in `Shared/commerce/netletFulfilment.test.ts`.
 * What needs a database is the part that moves stock: a receipt hands a
 * variant over and the shop sells from NetLet's shelf, a seller cannot count
 * a shelf they do not stand in front of, a sale freezes whose shelf it came
 * off, and NetLet — not the seller — packs it for the board to collect.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cartItems, carts, couriers, orderItems, productVariants, products, stockMovements, users, vendors } from "../drizzle/schema.js";
import type { Actor } from "../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let fulfilment: typeof import("./netletFulfilment.js");
let inventory: typeof import("./inventory.js");
let ordersModule: typeof import("./orders.js");
let dispatch: typeof import("./dispatch.js");
let payoutRuns: typeof import("./payoutRuns.js");
const ids = { admin: 0, manager: 0, staff: 0, shopper: 0, acme: 0, other: 0, lamp: 0, rug: 0, theirs: 0, centre: 0, second: 0, courier: 0 };

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const staff = (): Actor => ({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  fulfilment = await import("./netletFulfilment.js");
  inventory = await import("./inventory.js");
  ordersModule = await import("./orders.js");
  dispatch = await import("./dispatch.js");
  payoutRuns = await import("./payoutRuns.js");

  for (const [key, email, role] of [["admin", "owner@netlet.test", "admin"], ["manager", "manager@acme.test", "user"], ["staff", "staff@acme.test", "user"], ["shopper", "noura@shop.test", "user"]] as const) {
    const [row] = await db.insert(users).values({ email, role }).returning();
    ids[key] = row.id;
  }
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  ids.acme = acme.id; ids.other = other.id;
  const [product] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [lamp] = await db.insert(productVariants).values({ productId: product.id, title: "Brass", sku: "LAMP-B", price: "20.000", stock: 7 }).returning();
  const [rug] = await db.insert(productVariants).values({ productId: product.id, title: "Rug", sku: "RUG", price: "30.000", stock: 2, preorderStock: 5 }).returning();
  const [theirProduct] = await db.insert(products).values({ vendorId: other.id, handle: "chair", title: "Chair", status: "published" }).returning();
  const [theirs] = await db.insert(productVariants).values({ productId: theirProduct.id, title: "Default", price: "50.000", stock: 3 }).returning();
  ids.lamp = lamp.id; ids.rug = rug.id; ids.theirs = theirs.id;
  const [courier] = await db.insert(couriers).values({ name: "Fast Riders" }).returning();
  ids.courier = courier.id;
}, 60_000);

describe("before any centre is open", () => {
  it("is not running, and an announcement has nowhere to go", async () => {
    expect(await fulfilment.programmeOpen()).toBe(false);
    await expect(fulfilment.announceShipment(manager(), { vendorId: ids.acme, centreId: 1, lines: [{ variantId: ids.lamp, quantity: 5 }] }))
      .rejects.toMatchObject({ reason: "fulfilment.noCentre" });
  });

  it("is opened by NetLet alone", async () => {
    await expect(fulfilment.createCentre(manager(), { name: "Shuwaikh", governorate: "capital", addressLine: "Street 1" })).rejects.toThrow("FORBIDDEN:fulfilment.operate");
    ids.centre = (await fulfilment.createCentre(admin(), { name: "Shuwaikh", governorate: "capital", addressLine: "Street 1" })).id;
    ids.second = (await fulfilment.createCentre(admin(), { name: "Ahmadi", governorate: "ahmadi", addressLine: "Block 9" })).id;
    expect(await fulfilment.programmeOpen()).toBe(true);
  });
});

describe("sending stock", () => {
  it("is a manager's decision, about their own store's goods", async () => {
    await expect(fulfilment.announceShipment(staff(), { vendorId: ids.acme, centreId: ids.centre, lines: [{ variantId: ids.lamp, quantity: 5 }] })).rejects.toThrow("FORBIDDEN:fulfilment.send");
    await expect(fulfilment.announceShipment(manager(), { vendorId: ids.acme, centreId: ids.centre, lines: [{ variantId: ids.theirs, quantity: 1 }] }))
      .rejects.toMatchObject({ reason: "fulfilment.notYourVariant" });
    await expect(fulfilment.announceShipment(manager(), { vendorId: ids.other, centreId: ids.centre, lines: [{ variantId: ids.theirs, quantity: 1 }] })).rejects.toThrow("FORBIDDEN:fulfilment.send");
  });

  it("refuses a variant with a pre-order allowance — a promise NetLet cannot hold", async () => {
    await expect(fulfilment.announceShipment(manager(), { vendorId: ids.acme, centreId: ids.centre, lines: [{ variantId: ids.rug, quantity: 1 }] }))
      .rejects.toMatchObject({ reason: "fulfilment.preorderVariant" });
  });

  it("changes nothing in the shop until NetLet counts it", async () => {
    await fulfilment.announceShipment(manager(), { vendorId: ids.acme, centreId: ids.centre, lines: [{ variantId: ids.lamp, quantity: 10 }], note: "Two boxes" });
    const [lamp] = await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp));
    expect(lamp).toMatchObject({ stock: 7, centreId: null });
    const mine = await fulfilment.listShipments(manager());
    expect(mine.rows[0]).toMatchObject({ status: "announced", centreName: "Shuwaikh", note: "Two boxes" });
    /* Another store's manager sees none of it. */
    expect((await fulfilment.listShipments({ kind: "vendor", userId: ids.staff, vendorId: ids.other, role: "manager" })).total).toBe(0);
  });
});

describe("counting it in", () => {
  it("records what was counted, short or over, and hands the variant over", async () => {
    const [shipment] = (await fulfilment.listShipments(admin(), { status: "announced" })).rows;
    await expect(fulfilment.receiveShipment(manager(), shipment.id, [])).rejects.toThrow("FORBIDDEN:fulfilment.operate");
    await expect(fulfilment.receiveShipment(admin(), shipment.id, [])).rejects.toMatchObject({ reason: "fulfilment.countMissing" });

    expect(await fulfilment.receiveShipment(admin(), shipment.id, [{ lineId: shipment.lines[0].id, received: 9 }])).toEqual({ received: 9 });
    const [lamp] = await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp));
    /* The shop now sells NetLet's nine, not the seller's seven. */
    expect(lamp).toMatchObject({ stock: 9, centreId: ids.centre });
    const history = await db.select().from(stockMovements).where(eq(stockMovements.variantId, ids.lamp)).orderBy(asc(stockMovements.id));
    expect(history.map(row => [row.reason, row.delta, row.resulting])).toEqual([["netletHandedOver", -7, 0], ["netletReceived", 9, 9]]);

    const [after] = (await fulfilment.listShipments(manager(), { status: "received" })).rows;
    expect(after.lines[0]).toMatchObject({ expected: 10, received: 9, short: 1, over: 0 });
  });

  it("counts a shipment once, however many people press", async () => {
    const [shipment] = (await fulfilment.listShipments(manager(), { status: "received" })).rows;
    await expect(fulfilment.receiveShipment(admin(), shipment.id, [{ lineId: shipment.lines[0].id, received: 9 }])).rejects.toMatchObject({ reason: "fulfilment.notAnnounced" });
  });

  it("keeps one item in one place", async () => {
    await expect(fulfilment.announceShipment(manager(), { vendorId: ids.acme, centreId: ids.second, lines: [{ variantId: ids.lamp, quantity: 1 }] }))
      .rejects.toMatchObject({ reason: "fulfilment.otherCentre" });
  });
});

describe("NetLet's shelf", () => {
  it("is counted by NetLet only", async () => {
    await expect(inventory.adjustStock(manager(), ids.lamp, 5, "received")).rejects.toThrow("fulfilment.netletHolds");
    expect(await inventory.adjustStock(admin(), ids.lamp, -1, "damaged")).toBe(8);
    expect(await inventory.adjustStock(admin(), ids.lamp, 1, "correction")).toBe(9);
  });

  it("is not touched by editing the variant, and takes no pre-orders", async () => {
    const product = (await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp)))[0];
    await inventory.saveVariant(manager(), { id: ids.lamp, productId: product.productId, title: "Brass, polished", price: "21.000" });
    expect((await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp)))[0].stock).toBe(9);
    await expect(inventory.saveVariant(manager(), { id: ids.lamp, productId: product.productId, title: "Brass", price: "21.000", preorderStock: 3 }))
      .rejects.toThrow("fulfilment.noPreorder");
  });

  it("shows each store only its own", async () => {
    expect((await fulfilment.heldStock(manager())).rows.map(row => row.variantId)).toEqual([ids.lamp]);
    expect((await fulfilment.heldStock({ kind: "vendor", userId: ids.staff, vendorId: ids.other, role: "manager" })).total).toBe(0);
  });
});

describe("selling off NetLet's shelf", () => {
  let orderId = 0;

  it("freezes whose shelf the line came off, and NetLet packs it rather than the seller", async () => {
    const [cart] = await db.insert(carts).values({ id: "cart-fbn", userId: ids.shopper }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.lamp, quantity: 2 });
    const placed = await ordersModule.placeOrder(cart.id, { email: "noura@shop.test", userId: ids.shopper, contactName: "Noura", contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod" });
    orderId = placed.order.id;
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(line.centreId).toBe(ids.centre);
    expect((await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp)))[0].stock).toBe(7);

    await expect(ordersModule.setLineFulfilment(manager(), line.id, "preparing")).rejects.toMatchObject({ reason: "fulfilment.netletShips" });
  });

  it("is on NetLet's pick list, and packing it puts it on the board, collected from the centre", async () => {
    const picks = await fulfilment.pickList(admin());
    expect(picks.orders).toHaveLength(1);
    expect(picks.orders[0]).toMatchObject({ orderId, centreId: ids.centre, centreName: "Shuwaikh" });
    await expect(fulfilment.pickList(manager())).rejects.toThrow("FORBIDDEN:fulfilment.operate");

    expect(await fulfilment.markPacked(admin(), orderId, ids.centre)).toEqual({ packed: 1 });
    expect((await fulfilment.pickList(admin())).orders).toHaveLength(0);
    /* Pressing twice packs nothing twice. */
    expect(await fulfilment.markPacked(admin(), orderId, ids.centre)).toEqual({ packed: 0 });

    const board = await dispatch.loadBoard(admin(), { state: "waiting" });
    const parcel = board.parcels.find(entry => entry.orderId === orderId)!;
    expect(parcel.collectFrom).toEqual({ name: "Shuwaikh", addressLine: "Street 1", governorate: "capital" });
    expect(parcel.key.endsWith(`|c${ids.centre}`)).toBe(true);
    expect(await fulfilment.waitingAtCentres(admin())).toEqual({ toReceive: 0, toPick: 0 });
  });

  it("goes back to the seller at zero, while what was already sold stays NetLet's to pack", async () => {
    await expect(fulfilment.returnToSeller(manager(), ids.lamp)).rejects.toThrow("FORBIDDEN:fulfilment.operate");
    expect(await fulfilment.returnToSeller(admin(), ids.lamp)).toEqual({ returned: 7 });
    expect((await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp)))[0]).toMatchObject({ stock: 0, centreId: null });
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].centreId).toBe(ids.centre);
    /* And the seller counts it again. */
    expect(await inventory.adjustStock(manager(), ids.lamp, 4, "received")).toBe(4);
    await expect(fulfilment.returnToSeller(admin(), ids.lamp)).rejects.toMatchObject({ reason: "fulfilment.notHeld" });
  });

  /* The two boxes sold off NetLet's shelf are in NetLet's building: cancelling
     the line after the variant went back must not add them to the seller's count. */
  it("puts cancelled units back only on the shelf they came off", async () => {
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await ordersModule.setLineFulfilment(admin(), line.id, "cancelled");
    expect((await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp)))[0]).toMatchObject({ stock: 4, centreId: null });
  });
});

/*
 * The packing fee (4.2): a per-unit rate NetLet sets on a centre, charged once
 * per line when NetLet packs it, frozen at that moment's rate, and taken off
 * the seller's next payout run as a fee line — the shape a placement uses.
 */
describe("the packing fee", () => {
  it("is NetLet's to set, and blank is no charge", async () => {
    await expect(fulfilment.setPackRate(manager(), ids.centre, "0.250")).rejects.toThrow("FORBIDDEN:fulfilment.operate");
    await expect(fulfilment.setPackRate(admin(), ids.centre, "-1")).rejects.toMatchObject({ reason: "fulfilment.badRate" });
    await fulfilment.setPackRate(admin(), ids.centre, "0.250");
  });

  it("is charged once per line packed, at the rate of that moment, and comes off the next payout", async () => {
    const [product] = await db.insert(products).values({ vendorId: ids.acme, handle: "candle", title: "Candle", status: "published" }).returning();
    const [candle] = await db.insert(productVariants).values({ productId: product.id, title: "Default", price: "5.000", stock: 10, centreId: ids.centre }).returning();
    const [cart] = await db.insert(carts).values({ id: "cart-fee", userId: ids.shopper }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: candle.id, quantity: 3 });
    const placed = await ordersModule.placeOrder(cart.id, { email: "noura@shop.test", userId: ids.shopper, contactName: "Noura", contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod" });

    expect(await fulfilment.markPacked(admin(), placed.order.id, ids.centre)).toEqual({ packed: 1 });
    /* A later rate does not reach a charge already made. */
    await fulfilment.setPackRate(admin(), ids.centre, "9.000");
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    await db.update(orderItems).set({ fulfilment: "pending" }).where(eq(orderItems.id, line.id));
    await fulfilment.markPacked(admin(), placed.order.id, ids.centre);

    const charges = await fulfilment.listCharges(manager());
    expect(charges.rows).toHaveLength(1);
    expect(charges.rows[0]).toMatchObject({ orderReference: placed.order.reference, units: 3, ratePerUnit: "0.250", amount: "0.750", deducted: false });
    /* Another store sees none of it. */
    expect((await fulfilment.listCharges({ kind: "vendor", userId: ids.staff, vendorId: ids.other, role: "manager" })).total).toBe(0);

    const batches = await payoutRuns.readyBatches(admin());
    const acme = batches.find(batch => batch.vendorId === ids.acme)!;
    expect(acme.lines).toContainEqual({ orderId: null, reference: charges.rows[0].reference, amount: "-0.750", kind: "fee" });
    await fulfilment.setPackRate(admin(), ids.centre, null);
  });
});
