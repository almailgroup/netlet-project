/**
 * A discount code on one product (migration 0074), against a real Postgres:
 * typed on a line it takes off that line alone and follows its quantity; it is
 * refused, with the reason, on a product it does not cover, as an order code,
 * from a store whose permit has lapsed; the order freezes it on the line with
 * whoever made it paying for it; the order's own box sends it to its line; an
 * item carrying one can come out of an order but not be lowered, and coming
 * out hands its use back; and a store makes codes for its own products only.
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
  discountCodeProducts,
  discountCodes,
  discountRedemptions,
  invoices,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendors,
} from "../../database/schema.js";
import { addMoney } from "../../../Shared/money.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let catalog: typeof import("./catalog.js");
let ordersModule: typeof import("./orders.js");
let changes: typeof import("./orderChanges.js");
let vouchers: typeof import("./vouchers.js");

const ids = { shopper: 0, acme: 0, other: 0, lamp: 0, lampVariant: 0, mug: 0, mugVariant: 0, rival: 0, rivalVariant: 0 };

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
  catalog = await import("./catalog.js");
  ordersModule = await import("./orders.js");
  changes = await import("./orderChanges.js");
  vouchers = await import("./vouchers.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  ids.shopper = shopper.id;
  /* A store with a valid discount permit, and one whose permit has lapsed. */
  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved", commissionPercent: "10.00",
    discountLicenceNumber: "MOC-1", discountLicenceExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning();
  const [other] = await db.insert(vendors).values({
    slug: "other", name: "Other", status: "approved", commissionPercent: "10.00",
    discountLicenceNumber: "MOC-2", discountLicenceExpiresAt: new Date(Date.now() - 86_400_000),
  }).returning();
  ids.acme = acme.id; ids.other = other.id;

  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Default", price: "10.000", stock: 20 }).returning();
  const [mug] = await db.insert(products).values({ vendorId: acme.id, handle: "mug", title: "Mug", status: "published" }).returning();
  const [mugVariant] = await db.insert(productVariants).values({ productId: mug.id, title: "Default", price: "5.000", stock: 20 }).returning();
  const [rival] = await db.insert(products).values({ vendorId: other.id, handle: "rival", title: "Rival Lamp", status: "published" }).returning();
  const [rivalVariant] = await db.insert(productVariants).values({ productId: rival.id, title: "Default", price: "8.000", stock: 20 }).returning();
  Object.assign(ids, { lamp: lamp.id, lampVariant: lampVariant.id, mug: mug.id, mugVariant: mugVariant.id, rival: rival.id, rivalVariant: rivalVariant.id });

  /* Acme's own 10% on the lamp; NetLet's 2.000 on the lamp; Other's code on its whole store; an order code. */
  const [lampCode] = await db.insert(discountCodes).values({ code: "LAMP10", kind: "percent", value: "10", scope: "products", vendorId: acme.id, fundedBy: "store", perShopper: 5 }).returning();
  await db.insert(discountCodeProducts).values({ codeId: lampCode.id, productId: lamp.id });
  const [netletLamp] = await db.insert(discountCodes).values({ code: "NLLAMP", kind: "fixed", value: "2.000", scope: "products", vendorId: acme.id, fundedBy: "netlet", perShopper: 5 }).returning();
  await db.insert(discountCodeProducts).values({ codeId: netletLamp.id, productId: lamp.id });
  await db.insert(discountCodes).values({ code: "OTHERALL", kind: "percent", value: "20", scope: "store", vendorId: other.id, fundedBy: "store", perShopper: 5 });
  await db.insert(discountCodes).values({ code: "WHOLE5", kind: "fixed", value: "5.000", perShopper: 5 });
}, 60_000);

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(invoices);
  await db.delete(discountRedemptions);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
});

const DETAILS = {
  email: "shopper@example.test",
  contactName: "A Shopper",
  contactPhone: "+96550000000",
  deliveryZoneId: "hawalli",
  addressLine: "Block 4, Street 12, House 7",
  paymentMethod: "cod" as const,
};

async function bag(lines: { variantId: number; quantity: number }[]) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
  const lineIds: string[] = [];
  for (const line of lines) {
    const [row] = await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity }).returning();
    lineIds.push(String(row.id));
  }
  return { cartId: cart.id, lineIds };
}

describe("a code on one line of the bag", () => {
  it("comes off that line alone, follows its quantity, and the total moves with it", async () => {
    const { cartId, lineIds } = await bag([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.mugVariant, quantity: 1 }]);
    const answer = await catalog.setLineCode(cartId, lineIds[0], " lamp-10 ");
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const lamp = answer.cart.items.find(item => item.lineId === lineIds[0])!;
    const mug = answer.cart.items.find(item => item.lineId === lineIds[1])!;
    expect(lamp.code).toMatchObject({ code: "LAMP10", amount: { amount: "2.000" }, fundedBy: "store" });
    expect(mug.code ?? null).toBeNull();
    expect(answer.cart.subtotal.amount).toBe("25.000");
    expect(answer.cart.codeDiscount?.amount).toBe("2.000");
    expect(answer.cart.total.amount).toBe(addMoney("23.000", answer.cart.delivery.total.amount));

    /* Three lamps: 10% of 30. */
    await db.update(cartItems).set({ quantity: 3 }).where(eq(cartItems.id, Number(lineIds[0])));
    const again = await catalog.getCart(cartId);
    expect(again!.items.find(item => item.lineId === lineIds[0])!.code!.amount.amount).toBe("3.000");
  });

  it("is refused with the reason, and a refusal leaves the line's earlier code on it", async () => {
    const { cartId, lineIds } = await bag([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.mugVariant, quantity: 1 }, { variantId: ids.rivalVariant, quantity: 1 }]);
    expect(await catalog.setLineCode(cartId, lineIds[1], "LAMP10")).toEqual({ ok: false, reason: "voucher.notForProduct" });
    expect(await catalog.setLineCode(cartId, lineIds[0], "WHOLE5")).toEqual({ ok: false, reason: "voucher.orderWide" });
    expect(await catalog.setLineCode(cartId, lineIds[0], "NOSUCH")).toEqual({ ok: false, reason: "voucher.unknown" });
    /* Other's permit has lapsed, so its own code cannot be used. */
    expect(await catalog.setLineCode(cartId, lineIds[2], "OTHERALL")).toEqual({ ok: false, reason: "voucher.storeUnavailable" });
    /* Another store's code is never for this store's products. */
    expect(await catalog.setLineCode(cartId, lineIds[0], "OTHERALL")).toEqual({ ok: false, reason: "voucher.notForProduct" });

    expect((await catalog.setLineCode(cartId, lineIds[0], "LAMP10")).ok).toBe(true);
    await catalog.setLineCode(cartId, lineIds[0], "WHOLE5");
    const drawn = await catalog.getCart(cartId);
    expect(drawn!.items.find(item => item.lineId === lineIds[0])!.code?.code).toBe("LAMP10");

    const cleared = await catalog.clearLineCode(cartId, lineIds[0]);
    expect(cleared!.items.find(item => item.lineId === lineIds[0])!.code ?? null).toBeNull();
    expect(cleared!.codeDiscount ?? null).toBeNull();
  });

  it("is not taken in the order's own box, which says where it belongs", async () => {
    const { cartId } = await bag([{ variantId: ids.lampVariant, quantity: 1 }]);
    expect(await ordersModule.quoteVoucherForCart(cartId, "LAMP10", ids.shopper)).toEqual({ ok: false, reason: "voucher.forProducts" });
  });
});

describe("an order with codes on its lines", () => {
  it("freezes each code on its line, the store paying for its own and NetLet for NetLet's", async () => {
    const { cartId, lineIds } = await bag([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.mugVariant, quantity: 1 }]);
    await catalog.setLineCode(cartId, lineIds[0], "LAMP10");
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper } as never);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    const lamp = lines.find(line => line.productId === ids.lamp)!;
    expect(lamp).toMatchObject({ lineTotal: "18.000", discountCode: "LAMP10", discountAmount: "2.000", commissionAmount: "1.800", vendorNet: "16.200" });
    const mug = lines.find(line => line.productId === ids.mug)!;
    expect(mug).toMatchObject({ lineTotal: "5.000", discountCode: null, discountAmount: "0.000" });
    for (const line of lines) expect(addMoney(line.commissionAmount, line.vendorNet)).toBe(line.lineTotal);
    expect(placed.order.itemsTotal).toBe("23.000");
    const uses = await db.select().from(discountRedemptions).where(eq(discountRedemptions.orderId, placed.order.id));
    expect(uses.map(use => use.amount)).toEqual(["2.000"]);

    const second = await bag([{ variantId: ids.lampVariant, quantity: 1 }]);
    await catalog.setLineCode(second.cartId, second.lineIds[0], "NLLAMP");
    const netlet = await ordersModule.placeOrder(second.cartId, { ...DETAILS, userId: ids.shopper } as never);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, netlet.order.id));
    expect(line).toMatchObject({ lineTotal: "8.000", vendorNet: "9.000", commissionAmount: "-1.000" });
  });

  it("refuses the order when a line's code stopped working, and takes nothing", async () => {
    const { cartId, lineIds } = await bag([{ variantId: ids.lampVariant, quantity: 1 }]);
    await catalog.setLineCode(cartId, lineIds[0], "LAMP10");
    await db.update(discountCodes).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(discountCodes.code, "LAMP10"));
    const stockBefore = (await db.select().from(productVariants).where(eq(productVariants.id, ids.lampVariant)))[0].stock;
    try {
      const cart = await catalog.getCart(cartId);
      expect(cart!.items[0].codeProblem).toEqual({ code: "LAMP10", reason: "voucher.expired" });
      await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper } as never)).rejects.toThrow("order.voucherGone");
      expect(await db.select().from(orders)).toEqual([]);
      const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, ids.lampVariant));
      expect(variant.stock).toBe(stockBefore);
    } finally {
      await db.update(discountCodes).set({ endsAt: null }).where(eq(discountCodes.code, "LAMP10"));
    }
  });

  it("lets a coded item come out whole but not be lowered, and hands its use back", async () => {
    const { cartId, lineIds } = await bag([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.mugVariant, quantity: 1 }]);
    await catalog.setLineCode(cartId, lineIds[0], "LAMP10");
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper } as never);
    const lamp = (await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id))).find(line => line.productId === ids.lamp)!;

    await expect(changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: lamp.id, quantity: 1 }])).rejects.toThrow("orders.changeCoded");
    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: lamp.id, quantity: 0 }]);
    await changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: lamp.id, quantity: 0 }], quote.owedAfter);
    expect(await db.select().from(discountRedemptions).where(eq(discountRedemptions.orderId, placed.order.id))).toEqual([]);
    expect(quote.owedAfter).toBe("5.000");
  });
});

describe("who makes a product code", () => {
  const manager = (): Actor => ({ kind: "vendor", userId: ids.shopper, vendorId: ids.acme, role: "manager" });
  const staff = (): Actor => ({ kind: "vendor", userId: ids.shopper, vendorId: ids.acme, role: "staff" });

  it("lets a store's manager make codes for its own products, always paid by the store", async () => {
    await vouchers.saveDiscountCode(manager(), { code: "MUGDEAL", kind: "fixed", value: "1.000", scope: "products", productIds: [ids.mug], fundedBy: "netlet" });
    const [row] = await db.select().from(discountCodes).where(eq(discountCodes.code, "MUGDEAL"));
    expect(row).toMatchObject({ scope: "products", vendorId: ids.acme, fundedBy: "store" });
    const listed = await vouchers.listVouchers(manager());
    expect(listed.codes.map(code => code.code).sort()).toEqual(["LAMP10", "MUGDEAL", "NLLAMP"]);
    expect(listed.cards).toEqual([]);
  });

  it("refuses another store's products, an order code, NetLet's words and a staff member", async () => {
    await expect(vouchers.saveDiscountCode(manager(), { code: "STEAL", kind: "fixed", value: "1.000", scope: "products", productIds: [ids.rival] })).rejects.toThrow("promotion.notYourProducts");
    await expect(vouchers.saveDiscountCode(manager(), { code: "ALLOFIT", kind: "fixed", value: "1.000", scope: "order" })).rejects.toThrow("FORBIDDEN");
    await expect(vouchers.saveDiscountCode(manager(), { code: "WHOLE5", kind: "fixed", value: "1.000", scope: "store" })).rejects.toThrow("promotion.codeTaken");
    await expect(vouchers.saveDiscountCode(staff(), { code: "STAFFY", kind: "fixed", value: "1.000", scope: "store" })).rejects.toThrow("FORBIDDEN");
    const [whole] = await db.select().from(discountCodes).where(eq(discountCodes.code, "WHOLE5"));
    expect(whole).toMatchObject({ scope: "order", vendorId: null, value: "5.000" });
  });
});
