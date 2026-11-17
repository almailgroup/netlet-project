/**
 * Tax added at checkout (migration 0087) against a real Postgres: off by
 * default and nothing changes; on, the bag's Tax line is the figure the order
 * freezes line by line; NetLet's marks win over the shop's default and are
 * NetLet's alone; a line no longer coming takes its tax off what the driver
 * collects; a lowered line's tax is split; the invoice says it; and with 0087
 * missing the shop sells as it did.
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
  featureSwitches,
  invoiceCounters,
  invoices,
  orderItemTaxes,
  orderItems,
  orders,
  platformSettings,
  productTax,
  productVariants,
  products,
  users,
  vendors,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let ordersModule: typeof import("./orders.js");
let catalog: typeof import("./catalog.js");
let tax: typeof import("./tax.js");
let owed: typeof import("./owed.js");
let changes: typeof import("./orderChanges.js");
let invoicing: typeof import("./invoices.js");

const ids = { admin: 0, shopper: 0, seller: 0, acme: 0, lamp: 0, lampVariant: 0, mug: 0, mugVariant: 0 };

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
  ordersModule = await import("./orders.js");
  catalog = await import("./catalog.js");
  tax = await import("./tax.js");
  owed = await import("./owed.js");
  changes = await import("./orderChanges.js");
  invoicing = await import("./invoices.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [seller] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  Object.assign(ids, { admin: admin.id, shopper: shopper.id, seller: seller.id });
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", deliveryFlat: "2.000", commissionPercent: "10.00" }).returning();
  ids.acme = acme.id;
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published" }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "12.000", stock: 50 }).returning();
  const [mug] = await db.insert(products).values({ vendorId: acme.id, handle: "mug", title: "Mug", status: "published" }).returning();
  const [mugVariant] = await db.insert(productVariants).values({ productId: mug.id, title: "Default", price: "4.000", stock: 50 }).returning();
  Object.assign(ids, { lamp: lamp.id, lampVariant: lampVariant.id, mug: mug.id, mugVariant: mugVariant.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(invoiceCounters);
  await db.delete(orderItemTaxes);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(productTax);
  await db.delete(featureSwitches);
  await db.delete(platformSettings);
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.seller, vendorId: ids.acme, role: "owner" } as Actor);

const switchOn = async (key: string, enabled = true) => {
  await db.insert(featureSwitches).values({ key, enabled }).onConflictDoUpdate({ target: featureSwitches.key, set: { enabled } });
};

async function bag(lines: { variantId: number; quantity: number }[]) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
  for (const line of lines) await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  return cart.id;
}

async function place(cartId: string) {
  return ordersModule.placeOrder(cartId, {
    email: "shopper@example.test",
    contactName: "A Shopper",
    contactPhone: "+96550000000",
    deliveryZoneId: "hawalli",
    addressLine: "Block 4, Street 12, House 7",
    paymentMethod: "cod",
    userId: ids.shopper,
  } as never);
}

const lampAndMug = () => bag([{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.mugVariant, quantity: 1 }]); // 24 + 4, delivery 2

describe("tax at checkout", () => {
  it("adds nothing while the switch is off, which is how a shop starts", async () => {
    const cartId = await lampAndMug();
    const cart = await catalog.getCart(cartId);
    expect(cart?.tax).toBeNull();
    expect(cart?.total.amount).toBe("30.000");
    const placed = await place(cartId);
    expect(placed.order.grandTotal).toBe("30.000");
    expect(await db.select().from(orderItemTaxes)).toHaveLength(0);
  });

  it("is the bag's Tax line and the order freezes it line by line", async () => {
    await switchOn("tax");
    const cartId = await lampAndMug();
    const cart = await catalog.getCart(cartId);
    expect(cart?.tax).toEqual({ amount: expect.objectContaining({ amount: "1.400" }), ratePercent: "5.00" });
    expect(cart?.total.amount).toBe("31.400");

    const placed = await place(cartId);
    expect(placed.order.grandTotal).toBe("31.400");
    // The line's own total, commission and net are untouched: tax is outside them.
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    for (const line of lines) expect(Number(line.commissionAmount) + Number(line.vendorNet)).toBeCloseTo(Number(line.lineTotal), 3);
    const frozen = await db.select().from(orderItemTaxes).where(eq(orderItemTaxes.orderId, placed.order.id)).orderBy(orderItemTaxes.orderItemId);
    expect(frozen.map(row => [row.orderItemId, row.amount, row.rate, row.included])).toEqual([
      [lines[0].id, "1.200", "5.00", false],
      [lines[1].id, "0.200", "5.00", false],
    ]);
    const [stillOwed] = (await owed.stillOwedFor(db as never, [placed.order])).values();
    expect(stillOwed.owed).toBe("31.400");
  });

  it("charges the administrator's rate, and the order keeps the rate it was charged at", async () => {
    await switchOn("tax");
    await db.insert(platformSettings).values({ key: "tax.ratePercent", value: "15.00" });
    const placed = await place(await bag([{ variantId: ids.mugVariant, quantity: 1 }]));
    expect(placed.order.grandTotal).toBe("6.600"); // 4 + 0.6 + 2
    await db.update(platformSettings).set({ value: "5.00" }).where(eq(platformSettings.key, "tax.ratePercent"));
    const [frozen] = await db.select().from(orderItemTaxes).where(eq(orderItemTaxes.orderId, placed.order.id));
    expect(frozen.rate).toBe("15.00");
    expect(frozen.amount).toBe("0.600");
  });

  it("follows NetLet's marks over the shop's default, and the marks are NetLet's alone", async () => {
    await switchOn("tax");
    await expect(tax.setProductTax(owner(), ids.mug, "exempt")).rejects.toThrow(/FORBIDDEN/);
    await tax.setProductTax(admin(), ids.mug, "exempt");
    let cart = await catalog.getCart(await lampAndMug());
    expect(cart?.tax?.amount.amount).toBe("1.200"); // the lamps alone

    // Only the marked products: the mug is marked not taxed, the lamp follows — so nothing.
    await switchOn("taxAllProducts", false);
    cart = await catalog.getCart(await lampAndMug());
    expect(cart?.tax).toBeNull();
    await tax.setProductTax(admin(), ids.lamp, "taxed");
    cart = await catalog.getCart(await lampAndMug());
    expect(cart?.tax?.amount.amount).toBe("1.200");

    // Back on the default, the mark goes.
    await tax.setProductTax(admin(), ids.lamp, "follow");
    expect(await db.select().from(productTax).where(eq(productTax.productId, ids.lamp))).toHaveLength(0);

    const status = await tax.productTaxStatus(owner(), ids.mug);
    expect(status).toMatchObject({ ready: true, on: true, choice: "exempt", taxed: false, mayChange: false });
  });

  it("takes a cancelled line's tax off what the driver collects", async () => {
    await switchOn("tax");
    const placed = await place(await lampAndMug());
    const [, mugLine] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    await db.update(orderItems).set({ fulfilment: "cancelled" }).where(eq(orderItems.id, mugLine.id));
    const [after] = (await owed.stillOwedFor(db as never, [placed.order])).values();
    expect(after.owed).toBe("27.200"); // 31.400 − 4.000 − 0.200
  });

  it("splits a lowered line's tax between what stays and what is cancelled", async () => {
    await switchOn("tax");
    const placed = await place(await lampAndMug());
    const [lampLine] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id);
    const quote = await changes.quoteOrderChange(ids.shopper, placed.order.reference, [{ lineId: lampLine.id, quantity: 1 }]);
    expect(quote.owedAfter).toBe("18.800"); // 12 + 4 + 0.6 + 0.2 + 2
    await changes.applyOrderChange(ids.shopper, placed.order.reference, [{ lineId: lampLine.id, quantity: 1 }], quote.owedAfter);
    const frozen = await db.select().from(orderItemTaxes).where(eq(orderItemTaxes.orderId, placed.order.id)).orderBy(orderItemTaxes.orderItemId);
    const byLine = new Map(frozen.map(row => [row.orderItemId, row.amount]));
    expect(byLine.get(lampLine.id)).toBe("0.600");
    const total = frozen.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(total).toBeCloseTo(1.4, 3); // nothing lost to the split
    const [after] = (await owed.stillOwedFor(db as never, [await ordersModule.getOrderForUser(ids.shopper, placed.order.reference).then(found => found!.order)])).values();
    expect(after.owed).toBe("18.800");
  });

  it("is on the invoice beside each taxed line and in its total", async () => {
    await switchOn("tax");
    const placed = await place(await lampAndMug());
    await db.update(orders).set({ status: "paid", paymentCollectedAt: new Date() }).where(eq(orders.id, placed.order.id));
    await invoicing.issueInvoice(placed.order.id);
    const [document] = await db.select().from(invoices).where(eq(invoices.orderId, placed.order.id));
    const body = document.document as { tax?: string; total: string; sellers: { lines: { tax?: { amount: string } }[] }[] };
    expect(body.tax).toBe("1.400");
    expect(body.total).toBe("31.400");
    expect(body.sellers[0].lines.map(line => line.tax?.amount)).toEqual(["1.200", "0.200"]);
  });

  it("sells as it always did while 0087 is not there, and refuses a mark", async () => {
    await switchOn("tax");
    await client.exec(`ALTER TABLE "product_tax" RENAME TO "product_tax_away"`);
    try {
      const standing = await tax.taxRules();
      expect(standing).toMatchObject({ on: false, ready: false, switchedOn: true });
      const placed = await place(await lampAndMug());
      expect(placed.order.grandTotal).toBe("30.000");
      await expect(tax.setProductTax(admin(), ids.mug, "taxed")).rejects.toThrow("tax.unavailable");
      // Reading an order's tax inside nothing but a missing table answers nothing.
      expect((await tax.orderTaxes(db as never, [placed.order.id])).size).toBe(0);
    } finally {
      await client.exec(`ALTER TABLE "product_tax_away" RENAME TO "product_tax"`);
    }
  });
});
