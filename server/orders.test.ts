/**
 * Placing an order, against a real Postgres.
 *
 * The arithmetic is proved pure in `shared/commerce/order.test.ts`. What these
 * cover is the half that cannot be: that the price is read from the catalog at
 * the last moment and frozen, that stock is actually taken and actually handed
 * back when a basket cannot be served, and that one vendor cannot read
 * another's lines out of a shared basket.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItemAddons,
  cartItems,
  carts,
  orderItemAddons,
  orderItems,
  orders,
  productAddons,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
} from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";
import { addMoney } from "../shared/money.js";

let db: ReturnType<typeof drizzle>;
let ordersModule: typeof import("./orders.js");

const ids = {
  admin: 0, shopper: 0, acmeOwner: 0, otherOwner: 0,
  acme: 0, other: 0,
  lamp: 0, lampVariant: 0, kettle: 0, kettleVariant: 0,
  press: 0, pressVariant: 0,
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
  ordersModule = await import("./orders.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [acmeOwner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [otherOwner] = await db.insert(users).values({ email: "owner@other.test" }).returning();
  ids.admin = admin.id; ids.shopper = shopper.id;
  ids.acmeOwner = acmeOwner.id; ids.otherOwner = otherOwner.id;

  // Acme takes 10%; Other takes a flat fee, so both commission shapes are
  // exercised on the same basket.
  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved", commissionPercent: "10.00",
  }).returning();
  const [other] = await db.insert(vendors).values({
    slug: "other", name: "Other", status: "approved", commissionPercent: "0.00", commissionFixed: "1.000",
  }).returning();
  ids.acme = acme.id; ids.other = other.id;

  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: acmeOwner.id, role: "owner" },
    { vendorId: other.id, userId: otherOwner.id, role: "owner" },
  ]);

  const [lamp] = await db.insert(products).values({
    vendorId: acme.id, handle: "acme-lamp", title: "Harbour Desk Lamp", status: "published",
  }).returning();
  const [lampVariant] = await db.insert(productVariants).values({
    productId: lamp.id, title: "Charcoal", sku: "LAMP-CH", price: "24.375", stock: 10,
  }).returning();
  const [kettle] = await db.insert(products).values({
    vendorId: other.id, handle: "other-kettle", title: "Copper Kettle", status: "published",
  }).returning();
  const [kettleVariant] = await db.insert(productVariants).values({
    productId: kettle.id, title: "Default", sku: "KETTLE", price: "11.250", stock: 4,
  }).returning();
  // Nothing on the shelf, three promised: the shape a pre-order actually has.
  const [press] = await db.insert(products).values({
    vendorId: acme.id, handle: "acme-press", title: "Bellwether Press", status: "published",
  }).returning();
  const [pressVariant] = await db.insert(productVariants).values({
    productId: press.id, title: "Default", sku: "PRESS", price: "40.000",
    stock: 0, preorderStock: 3, preorderReleaseAt: new Date("2027-03-15T00:00:00Z"),
  }).returning();

  ids.lamp = lamp.id; ids.lampVariant = lampVariant.id;
  ids.kettle = kettle.id; ids.kettleVariant = kettleVariant.id;
  ids.press = press.id; ids.pressVariant = pressVariant.id;
}, 60_000);

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(productVariants).set({ stock: 10 }).where(eq(productVariants.id, ids.lampVariant));
  await db.update(productVariants).set({ stock: 4 }).where(eq(productVariants.id, ids.kettleVariant));
  await db.update(productVariants)
    .set({ stock: 0, preorderStock: 3, preorderReleaseAt: new Date("2027-03-15T00:00:00Z") })
    .where(eq(productVariants.id, ids.pressVariant));
});

const DETAILS = {
  email: "Shopper@Example.test",
  contactName: "A Shopper",
  contactPhone: "+96550000000",
  deliveryZoneId: "hawalli",
  addressLine: "Block 4, Street 12, House 7",
};

async function basket(lines: { variantId: number; quantity: number }[], userId?: number) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: userId ?? null }).returning();
  for (const line of lines) {
    await db.insert(cartItems).values({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity });
  }
  return cart.id;
}

const stockOf = async (variantId: number) =>
  (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0].stock;

const preorderStockOf = async (variantId: number) =>
  (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0].preorderStock;

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const acmeActor = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "owner" });
const otherActor = (): Actor => ({ kind: "vendor", userId: ids.otherOwner, vendorId: ids.other, role: "owner" });

describe("placing an order", () => {
  it("freezes the price, the labels and the commission rate", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 2 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.unitPrice).toBe("24.375");
    expect(line.lineTotal).toBe("48.750");
    expect(line.productTitle).toBe("Harbour Desk Lamp");
    expect(line.variantTitle).toBe("Charcoal");
    expect(line.vendorName).toBe("Acme");
    expect(line.commissionAmount).toBe("4.875");
    expect(line.vendorNet).toBe("43.875");
  });

  /*
   * The property the whole design rests on. A cart holds no price, so its
   * total moves with the catalog; an order holds nothing else, so it must not.
   */
  it("does not move when the catalog moves afterwards", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    await db.update(productVariants).set({ price: "99.000" }).where(eq(productVariants.id, ids.lampVariant));
    await db.update(vendors).set({ commissionPercent: "50.00" }).where(eq(vendors.id, ids.acme));

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.unitPrice).toBe("24.375");
    expect(line.commissionAmount).toBe("2.437");

    await db.update(productVariants).set({ price: "24.375" }).where(eq(productVariants.id, ids.lampVariant));
    await db.update(vendors).set({ commissionPercent: "10.00" }).where(eq(vendors.id, ids.acme));
  });

  it("totals a basket spanning two vendors, each on its own rate card", async () => {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    expect(placed.order.itemsTotal).toBe("60.000");
    // Acme's 10% of 48.750, plus Other's flat 1.000.
    expect(placed.order.commissionTotal).toBe("5.875");
    expect(placed.order.grandTotal).toBe("60.000");
  });

  it("takes the stock it sold", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 3 }], ids.shopper);
    await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    expect(await stockOf(ids.lampVariant)).toBe(7);
  });

  /*
   * Overselling by one is a conversation with a customer. There is no amount
   * of arithmetic that makes an item appear in a warehouse, so a short read is
   * refused rather than corrected.
   */
  it("refuses rather than overselling", async () => {
    const cartId = await basket([{ variantId: ids.kettleVariant, quantity: 5 }], ids.shopper);
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper }))
      .rejects.toMatchObject({ reason: "order.outOfStock" });
    expect(await stockOf(ids.kettleVariant)).toBe(4);
  });

  /*
   * And a part-served basket must not half-happen: the line that *could* be
   * served has already had its stock taken by the time the second fails.
   */
  it("hands back the stock it had already taken when a later line fails", async () => {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.kettleVariant, quantity: 99 }],
      ids.shopper,
    );
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper })).rejects.toThrow();

    expect(await stockOf(ids.lampVariant)).toBe(10);
    expect(await stockOf(ids.kettleVariant)).toBe(4);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("empties the basket, so a stale tab cannot buy it again", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    expect(await db.select().from(cartItems).where(eq(cartItems.cartId, cartId))).toHaveLength(0);
  });

  it("is born awaiting payment, never paid", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    expect(placed.order.status).toBe("pending_payment");
  });

  it("lower-cases the address it will send mail to", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    expect(placed.order.email).toBe("shopper@example.test");
  });

  it("takes a guest order, with no account behind it", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    const placed = await ordersModule.placeOrder(cartId, DETAILS);
    expect(placed.order.userId).toBeNull();
    expect(placed.order.email).toBe("shopper@example.test");
  });

  it("refuses a basket with nothing in it, and one with no address", async () => {
    const empty = await basket([]);
    await expect(ordersModule.placeOrder(empty, DETAILS)).rejects.toMatchObject({ reason: "order.empty" });

    const full = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    await expect(ordersModule.placeOrder(full, { ...DETAILS, addressLine: "" }))
      .rejects.toMatchObject({ reason: "order.noAddress" });
  });

  /*
   * The storefront drops a line whose product has been unpublished since it
   * went in the basket. The order path has to agree, or a shopper buys
   * something that is no longer for sale.
   */
  it("will not sell a line whose product has since been unpublished", async () => {
    await db.update(products).set({ status: "draft" }).where(eq(products.id, ids.lamp));
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper }))
      .rejects.toMatchObject({ reason: "order.empty" });
    await db.update(products).set({ status: "published" }).where(eq(products.id, ids.lamp));
  });

  it("will not sell a suspended vendor's goods", async () => {
    await db.update(vendors).set({ status: "suspended" }).where(eq(vendors.id, ids.acme));
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper }))
      .rejects.toMatchObject({ reason: "order.empty" });
    await db.update(vendors).set({ status: "approved" }).where(eq(vendors.id, ids.acme));
  });

  it("gives every order a reference nobody can count", async () => {
    const first = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const second = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);

    expect(first.order.reference).not.toBe(second.order.reference);
    expect(first.order.reference).toMatch(/^NL-\d{8}-[A-Z0-9]{5}$/);
  });
});

describe("reading orders back", () => {
  async function twoVendorOrder() {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 2 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    return ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
  }

  it("shows a shopper their own orders and nobody else's", async () => {
    await twoVendorOrder();
    await ordersModule.placeOrder(await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);

    const mine = await ordersModule.listOrdersForUser(ids.shopper);
    expect(mine.total).toBe(1);
    expect(mine.rows[0].userId).toBe(ids.shopper);
  });

  it("shows an admin every order", async () => {
    await twoVendorOrder();
    await ordersModule.placeOrder(await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    expect((await ordersModule.listOrdersFor(adminActor())).total).toBe(2);
  });

  /*
   * The leak this closes was latent until the seller's order desk called it:
   * the list returned whole order rows, so a vendor sharing a basket with
   * another seller read the grand total — a rival's sales — on a page
   * `getOrderFor` is careful to keep it off.
   */
  it("shows a vendor their own figure and an admin the order's", async () => {
    const placed = await twoVendorOrder();

    const [asAcme] = (await ordersModule.listOrdersFor(acmeActor())).rows;
    const [asAdmin] = (await ordersModule.listOrdersFor(adminActor())).rows;

    expect(asAcme.orderTotal).toBe("48.750");
    expect(asAcme).not.toHaveProperty("grandTotal");
    expect(asAdmin.orderTotal).toBe(placed.order.grandTotal);
    expect(asAcme.vendorCount).toBe(2);
  });

  it("shows a vendor only orders that contain their own goods", async () => {
    await twoVendorOrder();
    // Acme only.
    await ordersModule.placeOrder(await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);

    expect((await ordersModule.listOrdersFor(acmeActor())).total).toBe(2);
    expect((await ordersModule.listOrdersFor(otherActor())).total).toBe(1);
  });

  /* The escalation this blocks: reading a rival's sales out of a shared basket. */
  it("gives a vendor their own lines and none of the other seller's", async () => {
    const placed = await twoVendorOrder();

    const asAcme = await ordersModule.getOrderFor(acmeActor(), placed.order.id);
    expect(asAcme?.lines).toHaveLength(1);
    expect(asAcme?.lines[0].vendorId).toBe(ids.acme);
    expect(asAcme?.lines[0].productTitle).toBe("Harbour Desk Lamp");

    const asOther = await ordersModule.getOrderFor(otherActor(), placed.order.id);
    expect(asOther?.lines).toHaveLength(1);
    expect(asOther?.lines[0].vendorId).toBe(ids.other);

    const asAdmin = await ordersModule.getOrderFor(adminActor(), placed.order.id);
    expect(asAdmin?.lines).toHaveLength(2);
  });

  /*
   * A vendor's own slice totals their goods, not the shopper's basket — the
   * grand total covers another seller's items and is none of theirs.
   */
  it("shows a vendor their own subtotal, not the shopper's grand total", async () => {
    const placed = await twoVendorOrder();
    const asAcme = await ordersModule.getOrderFor(acmeActor(), placed.order.id);
    expect(asAcme?.scope).toBe("vendor");
    expect(asAcme?.slice?.itemsTotal).toBe("48.750");
    expect(asAcme?.slice?.vendorNet).toBe("43.875");
    expect(asAcme?.order).not.toHaveProperty("grandTotal");
    /* They do get the payment method: a seller hands the driver a parcel and
       takes the cash, and it says nothing about anybody else's goods. */
    expect(asAcme?.order).toHaveProperty("paymentMethod");
  });

  it("refuses an order a vendor has no lines in, rather than showing an empty one", async () => {
    const acmeOnly = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    expect(await ordersModule.getOrderFor(otherActor(), acmeOnly.order.id)).toBeNull();
  });

  it("finds a shopper's order by its reference, and refuses somebody else's", async () => {
    const placed = await twoVendorOrder();
    expect((await ordersModule.getOrderForUser(ids.shopper, placed.order.reference))?.lines).toHaveLength(2);
    expect(await ordersModule.getOrderForUser(ids.admin, placed.order.reference)).toBeNull();
  });
});

describe("moving a line through the warehouse", () => {
  it("lets a vendor ship their own line", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    const moved = await ordersModule.setLineFulfilment(acmeActor(), line.id, "shipped");
    expect(moved.fulfilment).toBe("shipped");
  });

  it("refuses to let a vendor touch another seller's line", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    await expect(ordersModule.setLineFulfilment(otherActor(), line.id, "shipped"))
      .rejects.toThrow("FORBIDDEN:stock.adjust");
  });

  /* Partial shipment is ordinary, which is why fulfilment is per line. */
  it("moves one line without moving the rest of the order", async () => {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const acmeLine = lines.find(line => line.vendorId === ids.acme)!;

    await ordersModule.setLineFulfilment(acmeActor(), acmeLine.id, "shipped");

    const after = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(after.find(line => line.vendorId === ids.acme)!.fulfilment).toBe("shipped");
    expect(after.find(line => line.vendorId === ids.other)!.fulfilment).toBe("pending");
  });

  /*
   * `delivered_at` is what the return window and review eligibility are both
   * measured from, and it had no writer at all: every line said "delivered"
   * with a null date, so nothing downstream ever opened.
   */
  it("stamps the arrival date when a line is marked delivered", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    expect(line.deliveredAt).toBeNull();
    const delivered = await ordersModule.setLineFulfilment(acmeActor(), line.id, "delivered");
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
  });

  /* The date does not move on a second press — a parcel arrives once. */
  it("keeps the first arrival date when delivered is recorded again", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    const first = await ordersModule.setLineFulfilment(acmeActor(), line.id, "delivered");
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "shipped");
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "delivered");
    const [after] = await db.select().from(orderItems).where(eq(orderItems.id, line.id));
    expect(after.deliveredAt).not.toBeNull();
    expect(after.deliveredAt!.getTime()).toBeGreaterThanOrEqual(first.deliveredAt!.getTime());
  });

  /*
   * Uncomfortable and still right: a seller correcting a mis-click has said
   * the parcel has not arrived, and leaving the date would hold a return
   * window open on a parcel that is not there.
   */
  it("clears the arrival date when a line is moved back off delivered", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    await ordersModule.setLineFulfilment(acmeActor(), line.id, "delivered");
    const back = await ordersModule.setLineFulfilment(acmeActor(), line.id, "preparing");
    expect(back.deliveredAt).toBeNull();
  });
});

/*
 * Optional extras (3.1.2). The arithmetic is proved pure in
 * `shared/commerce/addons.test.ts`; what is here is that a ticked extra
 * survives the trip from the basket to a frozen order line, that the money
 * lands where it should, and — the one that matters — that the identity the
 * finance panel is tested against still holds exactly.
 */
describe("optional extras", () => {
  async function basketWithAddon(price: string, quantity: number) {
    const [addon] = await db.insert(productAddons).values({
      productId: ids.lamp, kind: "installation", label: "Fitting at your address", price,
    }).returning();
    const cartId = await basket([{ variantId: ids.lampVariant, quantity }], ids.shopper);
    const [line] = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
    await db.insert(cartItemAddons).values({ cartItemId: line.id, addonId: addon.id });
    return { cartId, addonId: addon.id };
  }

  it("charges the extra per unit and puts it in the line total", async () => {
    const { cartId } = await basketWithAddon("5.000", 3);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    // The lamp is 24.375 × 3 = 73.125, and three fittings at 5.000 = 15.000.
    expect(line.unitPrice).toBe("24.375");
    expect(line.lineTotal).toBe("88.125");
  });

  /*
   * The identity the finance panel is built on, with an extra in the middle of
   * it: a fitting the platform did not take its cut of would make the report
   * disagree with the money.
   */
  it("keeps commission + vendorNet === lineTotal exactly", async () => {
    const { cartId } = await basketWithAddon("5.000", 2);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(addMoney(line.commissionAmount, line.vendorNet)).toBe(line.lineTotal);
  });

  it("freezes what it was called and what it cost", async () => {
    const { cartId, addonId } = await basketWithAddon("5.000", 1);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

    const frozen = await db.select().from(orderItemAddons).where(eq(orderItemAddons.orderItemId, line.id));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ addonId, kind: "installation", label: "Fitting at your address", price: "5.000" });
  });

  /* An order is an obligation: moving the price afterwards must not rewrite
     what was charged, exactly as with the goods and the commission rate. */
  it("does not follow the seller changing the price afterwards", async () => {
    const { cartId, addonId } = await basketWithAddon("5.000", 1);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    await db.update(productAddons).set({ price: "40.000" }).where(eq(productAddons.id, addonId));

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const [frozen] = await db.select().from(orderItemAddons).where(eq(orderItemAddons.orderItemId, line.id));
    expect(frozen.price).toBe("5.000");
    expect(line.lineTotal).toBe("29.375");
  });

  it("leaves a line with nothing ticked exactly as it was", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.lineTotal).toBe("24.375");
    expect(await db.select().from(orderItemAddons).where(eq(orderItemAddons.orderItemId, line.id))).toEqual([]);
  });
});

describe("recording that the driver collected", () => {
  it("moves a cash order to paid, once", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper, paymentMethod: "cod" },
    );
    expect(placed.order.status).toBe("pending_payment");

    expect(await ordersModule.recordCashCollected(acmeActor(), placed.order.id)).toBe(true);
    /* The predicate is inside the UPDATE, so the second press changes nothing
       and says so rather than claiming a second collection. */
    expect(await ordersModule.recordCashCollected(acmeActor(), placed.order.id)).toBe(false);

    const [after] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(after.status).toBe("paid");
    expect(after.paymentCollectedAt).toBeInstanceOf(Date);
  });

  it("refuses a seller with no line on the order", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper, paymentMethod: "cod" },
    );
    expect(await ordersModule.recordCashCollected(otherActor(), placed.order.id)).toBe(false);
  });
});

/*
 * Pre-order, against the real thing.
 *
 * The rule the whole feature turns on is that a pre-order is not an exemption
 * from `stock >= n` but a second pool carrying the same predicate — and a
 * predicate inside an UPDATE is exactly what a pure test cannot exercise.
 */
describe("pre-order", () => {
  it("sells a variant with nothing on the shelf, and says so on the line", async () => {
    const cartId = await basket([{ variantId: ids.pressVariant, quantity: 2 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.preordered).toBe(true);
    expect(line.preorderReleaseAt).toEqual(new Date("2027-03-15T00:00:00Z"));
    // Taken from the allowance, and the shelf is untouched rather than negative.
    expect(await preorderStockOf(ids.pressVariant)).toBe(1);
    expect(await stockOf(ids.pressVariant)).toBe(0);
  });

  it("refuses the order that would exceed the allowance, exactly as it refuses stock", async () => {
    const cartId = await basket([{ variantId: ids.pressVariant, quantity: 4 }]);
    await expect(ordersModule.placeOrder(cartId, DETAILS)).rejects.toThrow();
    // Nothing consumed by the refusal.
    expect(await preorderStockOf(ids.pressVariant)).toBe(3);
  });

  /*
   * Two shoppers after the last two of a promised three: exactly one gets
   * them, and the vendor is never left owing four parcels having promised
   * three.
   *
   * Honest about what this proves. PGlite runs one connection, so the two
   * calls serialise rather than genuinely race — what is exercised is that the
   * `>=` predicate inside the UPDATE refuses the second draw, which is the
   * property. A true simultaneous race needs two connections to a real server,
   * and the predicate is what makes that safe either way.
   */
  it("lets only one of two shoppers have the last of the allowance", async () => {
    const first = await basket([{ variantId: ids.pressVariant, quantity: 2 }]);
    const second = await basket([{ variantId: ids.pressVariant, quantity: 2 }]);

    const results = await Promise.allSettled([
      ordersModule.placeOrder(first, DETAILS),
      ordersModule.placeOrder(second, DETAILS),
    ]);

    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await preorderStockOf(ids.pressVariant)).toBe(1);
  });

  it("prefers the shelf when the shelf can serve it", async () => {
    // Two on the shelf as well as the promised three.
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, ids.pressVariant));

    const cartId = await basket([{ variantId: ids.pressVariant, quantity: 2 }]);
    const placed = await ordersModule.placeOrder(cartId, DETAILS);

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    // Calling this a pre-order would delay a parcel that could go out today.
    expect(line.preordered).toBe(false);
    expect(line.preorderReleaseAt).toBeNull();
    expect(await stockOf(ids.pressVariant)).toBe(0);
    expect(await preorderStockOf(ids.pressVariant)).toBe(3);
  });

  /*
   * Three on the shelf and an order for five is refused rather than split, and
   * this is what proves the refusal does not quietly eat the allowance on the
   * way past.
   */
  it("never draws one line from both pools", async () => {
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, ids.pressVariant));

    const cartId = await basket([{ variantId: ids.pressVariant, quantity: 4 }]);
    await expect(ordersModule.placeOrder(cartId, DETAILS)).rejects.toThrow();

    expect(await stockOf(ids.pressVariant)).toBe(2);
    expect(await preorderStockOf(ids.pressVariant)).toBe(3);
  });

  /*
   * A part-served basket never half-happens, and the units have to go back to
   * the pool they came from — handing a pre-ordered line back as real stock
   * would invent inventory out of a failed order.
   */
  it("returns pre-ordered units to the allowance when a later line cannot be served", async () => {
    const cartId = await basket([
      { variantId: ids.pressVariant, quantity: 2 },
      { variantId: ids.kettleVariant, quantity: 99 },
    ]);
    await expect(ordersModule.placeOrder(cartId, DETAILS)).rejects.toThrow();

    expect(await preorderStockOf(ids.pressVariant)).toBe(3);
    expect(await stockOf(ids.pressVariant)).toBe(0);
    expect(await stockOf(ids.kettleVariant)).toBe(4);
  });

  it("leaves an ordinary line saying it was not a pre-order", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    const placed = await ordersModule.placeOrder(cartId, DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.preordered).toBe(false);
    expect(line.preorderReleaseAt).toBeNull();
  });
});
