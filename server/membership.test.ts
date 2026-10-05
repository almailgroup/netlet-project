/**
 * NetLet membership (4.1) against a real Postgres.
 *
 * The rules are proved pure in `shared/commerce/membership.test.ts` and
 * `shopperPrice.test.ts`. What needs a database is that the bag and checkout
 * agree for a member — price, delivery and total — that the permit gate holds
 * on the read, that the order freezes what it was given, and that granting is
 * NetLet's alone.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cartItems, carts, orderItems, orders, productVariants, products, users, vendors } from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let membership: typeof import("./membership.js");
let catalog: typeof import("./catalog.js");
let ordersModule: typeof import("./orders.js");
let dispatch: typeof import("./dispatch.js");
let inventory: typeof import("./inventory.js");
const ids = { admin: 0, noura: 0, fahad: 0, acme: 0, beta: 0, lamp: 0, lampProduct: 0, rug: 0 };
const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const manager = (): Actor => ({ kind: "vendor", userId: ids.fahad, vendorId: ids.acme, role: "manager" });
let carted = 0;

async function basket(userId: number) {
  const [cart] = await db.insert(carts).values({ id: `cart-m-${carted++}`, userId }).returning();
  await db.insert(cartItems).values([{ cartId: cart.id, variantId: ids.lamp, quantity: 1 }, { cartId: cart.id, variantId: ids.rug, quantity: 1 }]);
  return cart.id;
}
const place = (cartId: string, userId: number) => ordersModule.placeOrder(cartId, { email: "x@shop.test", userId, contactName: "N", contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4", paymentMethod: "cod" });

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
  membership = await import("./membership.js");
  catalog = await import("./catalog.js");
  ordersModule = await import("./orders.js");
  dispatch = await import("./dispatch.js");
  inventory = await import("./inventory.js");

  for (const [key, email, role] of [["admin", "owner@netlet.test", "admin"], ["noura", "noura@shop.test", "user"], ["fahad", "fahad@shop.test", "user"]] as const) {
    ids[key] = (await db.insert(users).values({ email, role }).returning())[0].id;
  }
  const nextYear = new Date(Date.now() + 365 * 86_400_000);
  ids.acme = (await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", deliveryFlat: "1.500", discountLicenceNumber: "MOC-1", discountLicenceExpiresAt: nextYear }).returning())[0].id;
  /* No permit: Beta's member price must not reach anybody. */
  ids.beta = (await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved", deliveryFlat: "2.000" }).returning())[0].id;
  const [lampProduct] = await db.insert(products).values({ vendorId: ids.acme, handle: "lamp", title: "Lamp", status: "published" }).returning();
  ids.lampProduct = lampProduct.id;
  ids.lamp = (await db.insert(productVariants).values({ productId: lampProduct.id, title: "Default", price: "20.000", memberPrice: "17.000", stock: 50 }).returning())[0].id;
  const [rugProduct] = await db.insert(products).values({ vendorId: ids.beta, handle: "rug", title: "Rug", status: "published" }).returning();
  ids.rug = (await db.insert(productVariants).values({ productId: rugProduct.id, title: "Default", price: "30.000", memberPrice: "25.000", stock: 50 }).returning())[0].id;
}, 60_000);

describe("granting", () => {
  it("is NetLet's alone, by an account's email", async () => {
    await expect(membership.grantMembership(manager(), { email: "noura@shop.test", months: 3 })).rejects.toThrow("FORBIDDEN:membership.manage");
    await expect(membership.grantMembership(admin(), { email: "nobody@shop.test", months: 3 })).rejects.toMatchObject({ reason: "membership.noSuchAccount" });
    await expect(membership.grantMembership(admin(), { email: "noura@shop.test", months: 13 })).rejects.toMatchObject({ reason: "membership.badMonths" });
  });

  it("extends rather than overlaps when granted again", async () => {
    const first = await membership.grantMembership(admin(), { email: " Noura@Shop.test ", months: 3, note: "Pilot" });
    const second = await membership.grantMembership(admin(), { email: "noura@shop.test", months: 1 });
    expect(second.startsAt).toEqual(first.endsAt);
    const mine = await membership.myMembership(ids.noura);
    expect(mine).toMatchObject({ member: true, until: second.endsAt, freeDeliveryOver: null });
    expect((await membership.myMembership(ids.fahad)).member).toBe(false);
  });
});

describe("a member's basket", () => {
  it("shows the member price only where the permit allows, and waives every seller's delivery", async () => {
    const cart = (await catalog.getCart(await basket(ids.noura)))!;
    const lamp = cart.items.find(item => item.productTitle === "Lamp")!;
    const rug = cart.items.find(item => item.productTitle === "Rug")!;
    expect(lamp).toMatchObject({ unitPrice: { amount: "17.000" }, priceReason: "member", agreedFrom: { amount: "20.000" } });
    expect(rug).toMatchObject({ unitPrice: { amount: "30.000" }, priceReason: null });
    expect(cart.delivery.total.amount).toBe("0.000");
    expect(cart.delivery.memberWaived?.amount).toBe("3.500");
    expect(cart.total.amount).toBe("47.000");
  });

  it("is charged exactly what the bag said, and the order freezes what NetLet carried", async () => {
    const cartId = await basket(ids.noura);
    const shown = (await catalog.getCart(cartId))!;
    const placed = await place(cartId, ids.noura);
    expect(placed.order.grandTotal).toBe(shown.total.amount);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order).toMatchObject({ member: true, deliveryWaived: "3.500", deliveryTotal: "0.000" });
    expect(order.deliveryBreakdown).toEqual([
      { vendorId: ids.acme, vendorName: "Acme", destinationLabel: null, fee: "0.000", waived: "1.500" },
      { vendorId: ids.beta, vendorName: "Beta", destinationLabel: null, fee: "0.000", waived: "2.000" },
    ]);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(lines.find(line => line.productTitle === "Lamp")?.unitPrice).toBe("17.000");
  });

  it("pays delivery like anybody under NetLet's minimum", async () => {
    await membership.setTerms(admin(), { freeDeliveryOver: "100.000" });
    const placed = await place(await basket(ids.noura), ids.noura);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order).toMatchObject({ member: true, deliveryWaived: "0.000", deliveryTotal: "3.500" });
    await membership.setTerms(admin(), { freeDeliveryOver: null });
  });
});

describe("everybody else", () => {
  it("pays the shelf and the delivery, and sees no member price", async () => {
    const cart = (await catalog.getCart(await basket(ids.fahad)))!;
    expect(cart.items.find(item => item.productTitle === "Lamp")).toMatchObject({ unitPrice: { amount: "20.000" }, priceReason: null, agreedFrom: null });
    expect(cart.delivery).toMatchObject({ total: { amount: "3.500" }, memberWaived: null });
    const placed = await place(await basket(ids.fahad), ids.fahad);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order).toMatchObject({ member: false, deliveryWaived: "0.000" });
  });
});

describe("the dispatch board", () => {
  it("puts a member's parcels first, and says why", async () => {
    await db.update(orderItems).set({ fulfilment: "preparing" });
    const board = await dispatch.loadBoard(admin(), { state: "waiting" });
    const firstNonMember = board.parcels.findIndex(parcel => !parcel.member);
    const lastMember = board.parcels.map(parcel => parcel.member).lastIndexOf(true);
    expect(lastMember).toBeGreaterThanOrEqual(0);
    expect(lastMember).toBeLessThan(firstNonMember);
  });
});

describe("ending a membership", () => {
  it("stops the benefits from now on", async () => {
    const { rows } = await membership.listMemberships(admin(), { current: true });
    for (const row of rows) await membership.endMembership(admin(), row.id);
    await expect(membership.endMembership(admin(), rows[0].id)).rejects.toMatchObject({ reason: "membership.notFound" });
    const cart = (await catalog.getCart(await basket(ids.noura)))!;
    expect(cart.items.find(item => item.productTitle === "Lamp")?.unitPrice.amount).toBe("20.000");
    expect(cart.delivery.total.amount).toBe("3.500");
  });
});

describe("a seller's member price", () => {
  it("is below the shelf, or refused", async () => {
    await expect(inventory.saveVariant(manager(), { id: ids.lamp, productId: ids.lampProduct, title: "Default", price: "20.000", memberPrice: "21.000" })).rejects.toThrow("membership.priceNotBelow");
    await inventory.saveVariant(manager(), { id: ids.lamp, productId: ids.lampProduct, title: "Default", price: "20.000", memberPrice: null });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, ids.lamp));
    expect(variant.memberPrice).toBeNull();
    /* And the save did not touch the stock. */
    expect(variant.stock).toBeGreaterThan(0);
  });
});
