/**
 * The dispatch board, against a real Postgres.
 *
 * What a parcel *is* and what a driver may do with one are proved pure in
 * `shared/commerce/parcels.test.ts`. What needs a database is the half that
 * cannot be: that a delivery company sees only its own work, that a parcel
 * moves whole, that a courier cannot assign work to themselves, and that a
 * suspended company stops being one work can be given to.
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
  courierMembers,
  couriers,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendors,
} from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let dispatch: typeof import("./dispatch.js");
let ordersModule: typeof import("./orders.js");
let inventory: typeof import("./inventory.js");

const ids = {
  admin: 0, shopper: 0, driver: 0, rivalDriver: 0,
  acme: 0, sofa: 0, sofaVariant: 0, rice: 0, riceVariant: 0,
  swift: 0, rival: 0,
};

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
  dispatch = await import("./dispatch.js");
  ordersModule = await import("./orders.js");
  inventory = await import("./inventory.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [driver] = await db.insert(users).values({ email: "driver@swift.test" }).returning();
  const [rivalDriver] = await db.insert(users).values({ email: "driver@rival.test" }).returning();
  ids.admin = admin.id; ids.shopper = shopper.id; ids.driver = driver.id; ids.rivalDriver = rivalDriver.id;

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  ids.acme = acme.id;

  // A sofa the seller declared oversize, and rice sold by the 500 g bag —
  // between them they exercise both halves of the vehicle rule.
  const [sofa] = await db.insert(products).values({
    vendorId: acme.id, handle: "sofa", title: "Velvet Sofa", status: "published", sizeClass: "oversize",
  }).returning();
  const [sofaVariant] = await db.insert(productVariants).values({
    productId: sofa.id, title: "Default", sku: "SOFA", price: "240.000", stock: 5,
  }).returning();
  const [rice] = await db.insert(products).values({
    vendorId: acme.id, handle: "rice", title: "Basmati Rice", status: "published",
  }).returning();
  const [riceVariant] = await db.insert(productVariants).values({
    productId: rice.id, title: "500 g", sku: "RICE", price: "1.500", stock: 100,
    unit: "g", stepAmount: "500",
  }).returning();
  ids.sofa = sofa.id; ids.sofaVariant = sofaVariant.id;
  ids.rice = rice.id; ids.riceVariant = riceVariant.id;
}, 60_000);

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const driverActor = (): Actor => ({ kind: "courier", userId: ids.driver, courierId: ids.swift });
const rivalActor = (): Actor => ({ kind: "courier", userId: ids.rivalDriver, courierId: ids.rival });
const sellerActor = (): Actor => ({ kind: "vendor", userId: ids.shopper, vendorId: ids.acme, role: "owner" });

const DETAILS = {
  email: "shopper@example.test",
  contactName: "A Shopper",
  contactPhone: "+96550000000",
  deliveryZoneId: "hawalli",
  addressLine: "Block 4, Street 12, House 7",
};

async function placeBasket(lines: { variantId: number; quantity: number }[]) {
  const [cart] = await db
    .insert(carts)
    .values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper })
    .returning();
  for (const line of lines) {
    await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  }
  return ordersModule.placeOrder(cart.id, { ...DETAILS, userId: ids.shopper });
}

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(courierMembers);
  await db.delete(couriers);
  await db.update(productVariants).set({ stock: 50 }).where(eq(productVariants.id, ids.sofaVariant));
  /* One test re-measures the sofa on purpose, to prove the order does not
     follow it. Put it back, or every later order freezes the wrong class. */
  await db.update(products).set({ sizeClass: "oversize" }).where(eq(products.id, ids.sofa));
  await db.update(productVariants).set({ stock: 500 }).where(eq(productVariants.id, ids.riceVariant));
  const [swift] = await db.insert(couriers).values({ name: "Swift Delivery" }).returning();
  const [rival] = await db.insert(couriers).values({ name: "Rival Logistics" }).returning();
  ids.swift = swift.id; ids.rival = rival.id;
  await db.insert(courierMembers).values([
    { courierId: swift.id, userId: ids.driver },
    { courierId: rival.id, userId: ids.rivalDriver },
  ]);
});

describe("what the order freezes for the dispatcher", () => {
  it("copies the size class and the weight at the sale", async () => {
    const placed = await placeBasket([
      { variantId: ids.sofaVariant, quantity: 1 },
      { variantId: ids.riceVariant, quantity: 4 },
    ]);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const sofa = lines.find(line => line.variantId === ids.sofaVariant)!;
    const rice = lines.find(line => line.variantId === ids.riceVariant)!;

    expect(sofa.sizeClass).toBe("oversize");
    // Per unit, so the parcel multiplies by the quantity exactly once.
    expect(rice.weightGrams).toBe(500);
    expect(rice.sizeClass).toBeNull();
  });

  /* The whole point of freezing: a dispatcher has to be able to ask what was
     agreed to be carried after the seller has re-measured it. */
  it("does not follow the product when the seller re-measures it", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(products).set({ sizeClass: "small" }).where(eq(products.id, ids.sofa));

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.sizeClass).toBe("oversize");
  });
});

describe("the board", () => {
  it("shows an admin every parcel, with the vehicle each needs", async () => {
    await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });

    const board = await dispatch.loadBoard(adminActor(), { state: "waiting" });
    expect(board.parcels).toHaveLength(1);
    expect(board.parcels[0].vehicle).toBe("truck");
    expect(board.parcels[0].vendorName).toBe("Acme");
    expect(board.parcels[0].courierId).toBeNull();
  });

  it("shows a delivery company nothing until somebody gives them work", async () => {
    await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });

    expect((await dispatch.loadBoard(driverActor())).parcels).toHaveLength(0);
  });

  it("shows each company its own work and not a rival's", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;

    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.swift);

    expect((await dispatch.loadBoard(driverActor())).parcels).toHaveLength(1);
    expect((await dispatch.loadBoard(rivalActor())).parcels).toHaveLength(0);
  });

  it("is not a page a seller or a shopper can reach at all", async () => {
    await expect(dispatch.loadBoard(sellerActor())).rejects.toThrow("FORBIDDEN:delivery.view");
    await expect(dispatch.loadBoard({ kind: "customer", userId: ids.shopper })).rejects.toThrow(
      "FORBIDDEN:delivery.view",
    );
  });

  /* An admin narrowing the board is a convenience; a company asking about
     another's is not a request the filter may serve. */
  it("ignores a courier id a company passes for somebody else", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;
    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.rival);

    const asked = await dispatch.loadBoard(driverActor(), { courierId: ids.rival });
    expect(asked.parcels).toHaveLength(0);
  });
});

describe("assigning work", () => {
  it("writes every line in the parcel, so a box cannot go on two vans", async () => {
    const placed = await placeBasket([
      { variantId: ids.sofaVariant, quantity: 1 },
      { variantId: ids.riceVariant, quantity: 2 },
    ]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;
    expect(parcel.lines).toHaveLength(2);

    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.swift);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(lines.every(line => line.courierId === ids.swift)).toBe(true);
  });

  it("is refused to the company that would be doing the work", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;

    await expect(
      dispatch.assignParcel(driverActor(), placed.order.id, parcel.key, ids.swift),
    ).rejects.toThrow("FORBIDDEN:delivery.assign");
  });

  it("refuses a suspended company", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;

    await dispatch.setCourierStatus(adminActor(), ids.swift, "suspended");
    await expect(
      dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.swift),
    ).rejects.toThrow("dispatch.courierSuspended");
  });

  it("un-assigns with the same call rather than a second one", async () => {
    const placed = await placeBasket([{ variantId: ids.sofaVariant, quantity: 1 }]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;

    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.swift);
    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, null);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.courierId).toBeNull();
  });
});

describe("collecting and handing over", () => {
  async function assigned() {
    const placed = await placeBasket([
      { variantId: ids.sofaVariant, quantity: 1 },
      { variantId: ids.riceVariant, quantity: 2 },
    ]);
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const [parcel] = (await dispatch.loadBoard(adminActor())).parcels;
    await dispatch.assignParcel(adminActor(), placed.order.id, parcel.key, ids.swift);
    return { orderId: placed.order.id, key: parcel.key };
  }

  it("moves the whole parcel at once", async () => {
    const { orderId, key } = await assigned();
    await dispatch.moveParcel(driverActor(), orderId, key, "shipped");

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(lines.every(line => line.fulfilment === "shipped")).toBe(true);
  });

  it("stamps the arrival date, which the return window is measured from", async () => {
    const { orderId, key } = await assigned();
    await dispatch.moveParcel(driverActor(), orderId, key, "shipped");
    await dispatch.moveParcel(driverActor(), orderId, key, "delivered");

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(lines.every(line => line.fulfilment === "delivered")).toBe(true);
    expect(lines.every(line => line.deliveredAt !== null)).toBe(true);
  });

  it("refuses a move the board would not offer", async () => {
    const { orderId, key } = await assigned();
    // Straight to delivered from preparing: the driver has not collected it.
    await expect(dispatch.moveParcel(driverActor(), orderId, key, "delivered")).rejects.toThrow("dispatch.badMove");
  });

  it("refuses a parcel that is not this company's", async () => {
    const { orderId, key } = await assigned();
    await expect(dispatch.moveParcel(rivalActor(), orderId, key, "shipped")).rejects.toThrow("dispatch.notYours");
  });

  it("refuses a parcel key that names no parcel", async () => {
    const { orderId } = await assigned();
    await expect(dispatch.moveParcel(driverActor(), orderId, "v999|dorder", "shipped")).rejects.toThrow(
      "dispatch.unknownParcel",
    );
  });
});

describe("who a driver is", () => {
  it("resolves to their company rather than to a shopper", async () => {
    const actor = await inventory.resolveActor({ id: ids.driver, role: "user" });
    expect(actor).toEqual({ kind: "courier", userId: ids.driver, courierId: ids.swift });
  });

  it("leaves somebody with no company an ordinary shopper", async () => {
    const actor = await inventory.resolveActor({ id: ids.shopper, role: "user" });
    expect(actor.kind).toBe("customer");
  });
});
