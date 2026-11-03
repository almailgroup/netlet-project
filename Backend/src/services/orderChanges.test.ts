/**
 * A shopper's own changes before a driver collects the order, against a real
 * Postgres: the stock comes back, the line is split with its figures intact,
 * a store's fee comes in when the threshold is no longer cleared, a code under
 * its minimum comes off, a gift card gets back what no longer fits — and the
 * figure the driver collects is the one the quote showed.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  cartItems,
  carts,
  customerAddresses,
  discountCodes,
  discountRedemptions,
  giftCards,
  giftCardUses,
  invoices,
  orderItems,
  orders,
  pointEntries,
  productVariants,
  products,
  users,
  vendors,
} from "../../database/schema.js";
import { addMoney } from "../../../Shared/money.js";

let db: ReturnType<typeof drizzle>;
let ordersModule: typeof import("./orders.js");
let changes: typeof import("./orderChanges.js");
let owed: typeof import("./owed.js");

const ids = { shopper: 0, stranger: 0, acme: 0, lamp: 0, lampVariant: 0, mug: 0, mugVariant: 0, gone: 0, goneVariant: 0 };

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
  ordersModule = await import("./orders.js");
  changes = await import("./orderChanges.js");
  owed = await import("./owed.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();
  ids.shopper = shopper.id; ids.stranger = stranger.id;

  /* Delivers for 2.000, free over 40. */
  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved", commissionPercent: "12.50", commissionFixed: "0.100",
    deliveryFlat: "2.000", deliveryFreeOver: "40.000",
  }).returning();
  ids.acme = acme.id;

  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "12.375", stock: 10 }).returning();
  const [mug] = await db.insert(products).values({ vendorId: acme.id, handle: "mug", title: "Mug", status: "published" }).returning();
  const [mugVariant] = await db.insert(productVariants).values({ productId: mug.id, title: "Default", price: "4.500", stock: 10 }).returning();
  const [gone] = await db.insert(products).values({ vendorId: acme.id, handle: "gone", title: "Old Clock", status: "published" }).returning();
  const [goneVariant] = await db.insert(productVariants).values({ productId: gone.id, title: "Default", price: "9.000", stock: 5 }).returning();
  Object.assign(ids, { lamp: lamp.id, lampVariant: lampVariant.id, mug: mug.id, mugVariant: mugVariant.id, gone: gone.id, goneVariant: goneVariant.id });

  await db.insert(discountCodes).values({ code: "BIG5", kind: "fixed", value: "5.000", minSpend: "40.000", perShopper: 5 });
  await db.insert(giftCards).values({ code: "GIFT100", initialBalance: "100.000", remaining: "100.000" });
}, 60_000);

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(invoices);
  await db.delete(giftCardUses);
  await db.delete(discountRedemptions);
  await db.delete(pointEntries);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(customerAddresses);
  await db.update(productVariants).set({ stock: 10 }).where(eq(productVariants.id, ids.lampVariant));
  await db.update(productVariants).set({ stock: 10 }).where(eq(productVariants.id, ids.mugVariant));
  await db.update(productVariants).set({ stock: 5 }).where(eq(productVariants.id, ids.goneVariant));
  await db.update(giftCards).set({ remaining: "100.000" }).where(eq(giftCards.code, "GIFT100"));
});

const DETAILS = {
  email: "shopper@example.test",
  contactName: "A Shopper",
  contactPhone: "+96550000000",
  deliveryZoneId: "hawalli",
  addressLine: "Block 4, Street 12, House 7",
  paymentMethod: "cod" as const,
};

async function place(lines: { variantId: number; quantity: number }[], extra: Record<string, unknown> = {}) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
  for (const line of lines) await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  return ordersModule.placeOrder(cart.id, { ...DETAILS, userId: ids.shopper, ...extra } as never);
}

const stockOf = async (variantId: number) => (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0].stock;
const owedNow = async (orderId: number) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  return (await owed.stillOwedFor(db as never, [order])).get(orderId)!.owed;
};

describe("lowering a quantity", () => {
  it("splits the line, returns the units, keeps every figure whole and charges the fee a smaller order earns", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 4 }]); // 49.500, free over 40
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(await owedNow(placed.order.id)).toBe("49.500");

    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 2 }]);
    expect(quote.owedBefore).toBe("49.500");
    expect(quote.owedAfter).toBe("26.750"); // 24.750 + the 2.000 a smaller order no longer saves
    expect(quote.addedFees.map(fee => fee.fee)).toEqual(["2.000"]);

    await changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 2 }], quote.owedAfter);
    expect(await stockOf(ids.lampVariant)).toBe(8);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    expect(lines.map(one => [one.quantity, one.fulfilment])).toEqual([[2, "pending"], [2, "cancelled"]]);
    expect(addMoney(lines[0].lineTotal, lines[1].lineTotal)).toBe(line.lineTotal);
    expect(addMoney(lines[0].commissionAmount, lines[1].commissionAmount)).toBe(line.commissionAmount);
    expect(addMoney(lines[0].vendorNet, lines[1].vendorNet)).toBe(line.vendorNet);
    expect(await owedNow(placed.order.id)).toBe("26.750");
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "order.shopperChange"));
    expect(audit.subjectLabel).toBe(placed.order.reference);
  });

  it("refuses a figure that moved since the quote, and a stranger's order", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 4 }]);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    await expect(changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 2 }], "24.750")).rejects.toThrow("orders.changeMoved");
    await expect(changes.quoteOrderChange(ids.stranger, placed.order.reference, [{ lineId: line.id, quantity: 2 }])).rejects.toThrow("orders.detailMissing");
    expect(await stockOf(ids.lampVariant)).toBe(6);
  });

  it("is refused once the driver has the line", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 4 }, { variantId: ids.mugVariant, quantity: 1 }]);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.id, lines[0].id));
    await expect(changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: lines[0].id, quantity: 1 }])).rejects.toThrow("orders.changeLineGone");
    /* The mug is still the store's, so it can still be taken out. */
    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: lines[1].id, quantity: 0 }]);
    expect(quote.owedAfter).toBe("49.500");
  });
});

describe("what comes back", () => {
  it("takes a code off under its minimum and hands its use back", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 4 }], { voucherCode: "BIG5" }); // 49.500 − 5
    expect(await owedNow(placed.order.id)).toBe("44.500");
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 1 }]);
    expect(quote).toMatchObject({ codeLost: true, discountAfter: "0.000", owedAfter: "14.375" });
    await changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 1 }], quote.owedAfter);
    expect(await db.select().from(discountRedemptions)).toEqual([]);
    expect(await owedNow(placed.order.id)).toBe("14.375");
  });

  it("gives a gift card back what no longer fits", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 4 }], { giftCardCode: "GIFT100" });
    expect(await owedNow(placed.order.id)).toBe("0.000");
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 1 }]);
    expect(quote.giftCardBack).toBe("35.125"); // 49.500 paid, 14.375 still coming
    await changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: line.id, quantity: 1 }], quote.owedAfter);
    const [card] = await db.select().from(giftCards).where(eq(giftCards.code, "GIFT100"));
    expect(card.remaining).toBe("85.625");
    const [use] = await db.select().from(giftCardUses);
    expect(use.amount).toBe("14.375");
    /* Cancelling the rest hands back only what is left on the order. */
    await ordersModule.cancelOrderForShopper(ids.shopper, placed.order.reference);
    const [after] = await db.select().from(giftCards).where(eq(giftCards.code, "GIFT100"));
    expect(after.remaining).toBe("100.000");
  });
});

describe("cancelling", () => {
  it("cancels while a store is packing, and returns the units", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.mugVariant, quantity: 1 }]);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    await db.update(orderItems).set({ fulfilment: "preparing" }).where(eq(orderItems.id, lines[0].id));
    await ordersModule.cancelOrderForShopper(ids.shopper, placed.order.reference);
    expect(await stockOf(ids.lampVariant)).toBe(10);
    expect(await stockOf(ids.mugVariant)).toBe(10);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order.status).toBe("cancelled");
  });
});

describe("the address", () => {
  it("moves to another saved address while nothing has left, and not after", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 1 }]);
    const [office] = await db.insert(customerAddresses).values({
      userId: ids.shopper, label: "Office", contactName: "A Shopper", contactPhone: "+96551111111", governorate: "capital",
      addressLine: "x", area: "Sharq", block: "2", street: "Jaber Al-Mubarak", building: "14",
    }).returning();
    const [theirs] = await db.insert(customerAddresses).values({ userId: ids.stranger, label: "Home", addressLine: "y" }).returning();

    await expect(changes.changeOrderAddress(ids.shopper, placed.order.reference, theirs.id)).rejects.toThrow("orders.addressUnknown");
    const moved = await changes.changeOrderAddress(ids.shopper, placed.order.reference, office.id);
    expect(moved.owed).toBe("14.375");
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order.deliveryZoneId).toBe("capital");
    expect(order.contactPhone).toBe("+96551111111");
    expect(order.addressLine).toContain("Sharq");

    await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.orderId, placed.order.id));
    await expect(changes.changeOrderAddress(ids.shopper, placed.order.reference, office.id)).rejects.toThrow("orders.changeCollected");
  });
});

describe("buying again", () => {
  it("puts what is still for sale in the bag and names what is not", async () => {
    const placed = await place([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.goneVariant, quantity: 1 }]);
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, ids.goneVariant));
    const again = await changes.buyAgain(ids.shopper, placed.order.reference, null);
    expect(again.added).toBe(1);
    expect(again.skipped).toEqual([{ title: "Old Clock", reason: "soldOut" }]);
    const lines = await db.select().from(cartItems).where(eq(cartItems.cartId, again.cartId!));
    expect(lines.map(line => [line.variantId, line.quantity])).toEqual([[ids.lampVariant, 2]]);
    await expect(changes.buyAgain(ids.stranger, placed.order.reference, null)).rejects.toThrow("orders.detailMissing");
  });
});
