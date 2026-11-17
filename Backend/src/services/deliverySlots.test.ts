/**
 * Each store's delivery chosen in the bag (migration 0085), against a real
 * Postgres: one press sets every line of a store, the bag offers the store's
 * own days and says when a chosen one is gone, the order refuses a gone day
 * and freezes a kept one, the store and the driver read it — and until the
 * SQL is pasted the day and time are closed while the rest works.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartDeliverySlots,
  cartItems,
  carts,
  customerAddresses,
  invoices,
  orderDeliverySlots,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendors,
} from "../../database/schema.js";
import { slotDays } from "../../../Shared/commerce/deliverySlots.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let catalog: typeof import("./catalog.js");
let ordersModule: typeof import("./orders.js");
let slots: typeof import("./deliverySlots.js");
let dispatch: typeof import("./dispatch.js");

const ids = { shopper: 0, other: 0, acme: 0, plain: 0, lampVariant: 0, mugVariant: 0, kettleVariant: 0, home: 0, office: 0 };

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
  catalog = await import("./catalog.js");
  ordersModule = await import("./orders.js");
  slots = await import("./deliverySlots.js");
  dispatch = await import("./dispatch.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [other] = await db.insert(users).values({ email: "other@example.test" }).returning();
  ids.shopper = shopper.id;
  ids.other = other.id;

  /* Acme says next day, and offers Express the same day for KWD 2. */
  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved", deliveryFlat: "1.000", deliverySpeed: "next_day",
    fastDeliveryFee: "2.000", fastDeliverySpeed: "same_day",
  }).returning();
  /* Plain has said nothing about how soon it ships. */
  const [plain] = await db.insert(vendors).values({ slug: "plain", name: "Plain", status: "approved" }).returning();
  ids.acme = acme.id;
  ids.plain = plain.id;

  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [mug] = await db.insert(products).values({ vendorId: acme.id, handle: "mug", title: "Mug", status: "published" }).returning();
  const [kettle] = await db.insert(products).values({ vendorId: plain.id, handle: "kettle", title: "Kettle", status: "published" }).returning();
  ids.lampVariant = (await db.insert(productVariants).values({ productId: lamp.id, title: "Default", price: "10.000", stock: 50 }).returning())[0].id;
  ids.mugVariant = (await db.insert(productVariants).values({ productId: mug.id, title: "Default", price: "3.000", stock: 50 }).returning())[0].id;
  ids.kettleVariant = (await db.insert(productVariants).values({ productId: kettle.id, title: "Default", price: "8.000", stock: 50 }).returning())[0].id;

  ids.home = (await db.insert(customerAddresses).values({ userId: shopper.id, label: "Home", governorate: "hawalli", addressLine: "Block 4, Street 12, House 7" }).returning())[0].id;
  ids.office = (await db.insert(customerAddresses).values({ userId: other.id, label: "Office", governorate: "capital", addressLine: "Block 1, Street 1, House 1" }).returning())[0].id;
}, 60_000);

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(invoices);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
});

async function basket(lines: { variantId: number; quantity: number }[]) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
  for (const line of lines) await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  return cart.id;
}

const DETAILS = {
  email: "shopper@example.test", contactName: "A Shopper", contactPhone: "+96550000000",
  deliveryZoneId: "hawalli", addressLine: "Block 4, Street 12, House 7",
};

describe("each store's delivery in the bag", () => {
  it("offers the store's own days, and none for a store that has said nothing", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }]);
    const cart = await catalog.getCart(cartId);
    expect(cart?.slotsReady).toBe(true);
    const acme = cart?.stores?.find(store => store.vendorId === ids.acme);
    const plain = cart?.stores?.find(store => store.vendorId === ids.plain);
    expect(acme?.days.map(day => day.date)).toEqual(slotDays("next_day").map(day => day.date));
    expect(acme?.choice).toBe("regular");
    expect(acme?.fast?.fee.amount).toBe("2.000");
    expect(acme?.addressId).toBeNull();
    expect(plain?.days).toEqual([]);
  });

  /* One press on the store's row sets every one of its lines, and the bag
     comes back with the fee moved. */
  it("sets Express and the address for every line of the store at once", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.mugVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }]);
    await slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { choice: "fast", addressId: ids.home });
    const cart = await catalog.getCart(cartId);
    const acmeLines = cart!.items.filter(item => item.vendor?.id === ids.acme);
    expect(acmeLines.every(item => item.deliveryChoice === "fast" && item.destination?.id === ids.home)).toBe(true);
    const kettle = cart!.items.find(item => item.vendor?.id === ids.plain);
    expect(kettle?.deliveryChoice).toBe("regular");
    expect(kettle?.destination ?? null).toBeNull();
    const acme = cart?.stores?.find(store => store.vendorId === ids.acme);
    expect(acme?.choice).toBe("fast");
    expect(acme?.addressId).toBe(ids.home);
    /* Express takes the store's same-day band. */
    expect(acme?.days[0].date).toBe(slotDays("same_day")[0].date);
    expect(cart?.delivery.perVendor.find(row => row.vendorId === ids.acme)?.fee.amount).toBe("2.000");
  });

  it("refuses somebody else's address and a store not in the bag", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    await expect(slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { addressId: ids.office })).rejects.toMatchObject({ reason: "address.unknown" });
    await expect(slots.setStoreDelivery(cartId, null, ids.acme, { addressId: ids.home })).rejects.toMatchObject({ reason: "address.needsAccount" });
    await expect(slots.setStoreDelivery(cartId, ids.shopper, ids.plain, { choice: "fast" })).rejects.toMatchObject({ reason: "delivery.noStore" });
  });

  it("keeps a day the store offers and refuses one it does not", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }]);
    const day = slotDays("next_day")[1];
    await slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { slot: { date: day.date, window: "evening" } });
    const cart = await catalog.getCart(cartId);
    const acme = cart?.stores?.find(store => store.vendorId === ids.acme);
    expect(acme?.slot).toEqual({ date: day.date, window: "evening" });
    expect(acme?.slotState).toBe("kept");
    await expect(slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { slot: { date: "2020-01-05", window: "morning" } }))
      .rejects.toMatchObject({ reason: "delivery.slotNotOffered" });
    await expect(slots.setStoreDelivery(cartId, ids.shopper, ids.plain, { slot: { date: day.date, window: "morning" } }))
      .rejects.toMatchObject({ reason: "delivery.slotNotOffered" });
    /* Null takes the preference away. */
    await slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { slot: null });
    expect((await catalog.getCart(cartId))?.stores?.find(store => store.vendorId === ids.acme)?.slot).toBeNull();
  });
});

describe("the order", () => {
  it("freezes the day per store, clears it from the bag, and the store and the board read it", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }]);
    const day = slotDays("next_day")[2];
    await slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { slot: { date: day.date, window: "morning" } });
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    const frozen = await db.select().from(orderDeliverySlots).where(eq(orderDeliverySlots.orderId, placed.order.id));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ vendorId: ids.acme, deliveryDate: day.date, timeWindow: "morning" });
    expect(await db.select().from(cartDeliverySlots).where(eq(cartDeliverySlots.cartId, cartId))).toHaveLength(0);

    /* The store sees its own day; another store's desk sees none of it. */
    const acmeView = await ordersModule.getOrderFor({ kind: "vendor", userId: ids.shopper, vendorId: ids.acme, role: "owner" }, placed.order.id);
    expect(acmeView?.deliverySlots).toEqual([{ vendorId: ids.acme, date: day.date, window: "morning" }]);
    const plainView = await ordersModule.getOrderFor({ kind: "vendor", userId: ids.shopper, vendorId: ids.plain, role: "owner" }, placed.order.id);
    expect(plainView?.deliverySlots).toEqual([]);

    const board = await dispatch.loadBoard({ kind: "admin", userId: ids.shopper });
    const acmeParcel = board.parcels.find(parcel => parcel.orderId === placed.order.id && parcel.vendorId === ids.acme);
    const plainParcel = board.parcels.find(parcel => parcel.orderId === placed.order.id && parcel.vendorId === ids.plain);
    expect(acmeParcel?.preferredSlot).toEqual({ date: day.date, window: "morning" });
    expect(plainParcel?.preferredSlot).toBeNull();
  });

  /* Said, never moved: a day that passed refuses the order until it is changed. */
  it("refuses a day that is no longer offered", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    await db.insert(cartDeliverySlots).values({ cartId, vendorId: ids.acme, deliveryDate: "2020-01-05", timeWindow: "morning" });
    const cart = await catalog.getCart(cartId);
    expect(cart?.stores?.[0].slotState).toBe("gone");
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper })).rejects.toMatchObject({ reason: "order.slotGone" });
  });
});

describe("before 0085 is pasted", () => {
  it("draws no day, refuses one in a sentence, and places the order without it", async () => {
    await client.exec("alter table cart_delivery_slots rename to cart_delivery_slots_away; alter table order_delivery_slots rename to order_delivery_slots_away;");
    try {
      const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
      const cart = await catalog.getCart(cartId);
      expect(cart?.slotsReady).toBe(false);
      expect(cart?.stores?.[0].days).toEqual([]);
      /* Express and the address go on working. */
      await slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { choice: "fast" });
      expect((await catalog.getCart(cartId))?.stores?.[0].choice).toBe("fast");
      await expect(slots.setStoreDelivery(cartId, ids.shopper, ids.acme, { slot: { date: slotDays("same_day")[0].date, window: "evening" } }))
        .rejects.toMatchObject({ reason: "delivery.slotUnavailable" });
      const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
      expect(placed.order.id).toBeGreaterThan(0);
      const board = await dispatch.loadBoard({ kind: "admin", userId: ids.shopper });
      expect(board.parcels.find(parcel => parcel.orderId === placed.order.id)?.preferredSlot).toBeNull();
    } finally {
      await client.exec("alter table cart_delivery_slots_away rename to cart_delivery_slots; alter table order_delivery_slots_away rename to order_delivery_slots;");
    }
  });
});
