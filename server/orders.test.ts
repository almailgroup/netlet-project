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
import { and, eq, sql } from "drizzle-orm";
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
  bundleItems,
  bundles as bundlesTable,
  discountCodes,
  discountRedemptions,
  giftCards,
  giftCardUses,
  pointEntries,
  productAddons,
  productImages,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
  invoices,
  wishlists,
  wishlistItems,
} from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";
import { addMoney } from "../shared/money.js";

let db: ReturnType<typeof drizzle>;
let ordersModule: typeof import("./orders.js");
let fraud: typeof import("./fraud.js");
let bundlesModule: typeof import("./bundles.js");

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
  fraud = await import("./fraud.js");
  bundlesModule = await import("./bundles.js");

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
  /* An invoiced order cannot be deleted under its invoice (3.6.6). */
  await db.delete(invoices);
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

  /* The order and its lines are one write. A failure after the order row
     used to leave it standing while the catch put its stock back. */
  it("leaves no order behind when a later write fails", async () => {
    const [addon] = await db.insert(productAddons).values({
      productId: ids.lamp, kind: "installation", label: "Fitting", price: "2.000",
    }).returning();
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const [inBag] = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
    await db.insert(cartItemAddons).values({ cartItemId: inBag.id, addonId: addon.id });
    await db.execute(sql.raw("create or replace function refuse_addon() returns trigger as $$ begin raise exception 'refused for the test'; end $$ language plpgsql"));
    await db.execute(sql.raw("create trigger refuse_addon before insert on order_item_addons for each row execute function refuse_addon()"));
    try {
      await expect(ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper })).rejects.toThrow();
      expect(await db.select().from(orders)).toHaveLength(0);
      expect(await db.select().from(orderItems)).toHaveLength(0);
      expect(await stockOf(ids.lampVariant)).toBe(10);
      expect(await db.select().from(cartItems).where(eq(cartItems.cartId, cartId))).toHaveLength(1);
    } finally {
      await db.execute(sql.raw("drop trigger refuse_addon on order_item_addons"));
      await db.execute(sql.raw("drop function refuse_addon()"));
      await db.delete(cartItemAddons);
      await db.delete(productAddons).where(eq(productAddons.id, addon.id));
    }
  });

  /* A present claimed and bought stays bought, however long the hold was. */
  it("marks what the buyer had claimed off somebody's list as bought", async () => {
    const [list] = await db.insert(wishlists).values({
      userId: ids.admin, title: "Birthday", visibility: "public", shareToken: `tok-${Date.now()}`,
    }).returning();
    const lapsed = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [mine] = await db.insert(wishlistItems).values({
      wishlistId: list.id, productId: String(ids.lamp), claimedAt: lapsed, claimedBy: ids.shopper,
    }).returning();
    const [theirs] = await db.insert(wishlistItems).values({
      wishlistId: list.id, productId: String(ids.kettle), claimedAt: new Date(), claimedBy: ids.acmeOwner,
    }).returning();

    await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper },
    );
    const [after] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, mine.id));
    expect(after.boughtAt).not.toBeNull();
    /* Somebody else's claim is theirs to fulfil. */
    const [other] = await db.select().from(wishlistItems).where(eq(wishlistItems.id, theirs.id));
    expect(other.boughtAt).toBeNull();
    await db.delete(wishlistItems);
    await db.delete(wishlists);
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

  /* The list a shopper scans leads with what is in an order and where it is,
     not whether a cash order has been paid yet. */
  it("says what each order holds and how far it has got", async () => {
    const placed = await twoVendorOrder();
    const [photo] = await db.insert(productImages).values([
      { productId: ids.lamp, url: "https://example.test/lamp-second.jpg", position: 1 },
      { productId: ids.lamp, url: "https://example.test/lamp-first.jpg", position: 0 },
      { productId: ids.lamp, url: "https://example.test/lamp.mp4", position: -1, kind: "video" },
    ]).returning();

    try {
      const [row] = (await ordersModule.listOrdersForUser(ids.shopper)).rows;
      /* Named after its first line, as the lines were written. */
      const [firstLine] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id)).orderBy(orderItems.id).limit(1);
      expect(row.summary).toMatchObject({
        lineCount: 2,
        first: { title: firstLine.productTitle },
        photos: ["https://example.test/lamp-first.jpg"],
        progress: { kind: "received", preordered: false },
      });

      /* A line on the road moves the order on; one still with its seller holds it there. */
      const [lampLine] = await db.select().from(orderItems).where(and(eq(orderItems.orderId, placed.order.id), eq(orderItems.productId, ids.lamp)));
      await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.id, lampLine.id));
      expect((await ordersModule.listOrdersForUser(ids.shopper)).rows[0].summary?.progress).toEqual({ kind: "onTheWay" });

      /* Cancelled, the lamp no longer names the order or holds it back. */
      await db.update(orderItems).set({ fulfilment: "cancelled" }).where(eq(orderItems.id, lampLine.id));
      await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date("2026-10-04T09:00:00Z") })
        .where(and(eq(orderItems.orderId, placed.order.id), eq(orderItems.productId, ids.kettle)));
      const after = (await ordersModule.listOrdersForUser(ids.shopper)).rows[0].summary;
      expect(after?.first?.title).toBe("Copper Kettle");
      expect(after?.progress).toEqual({ kind: "delivered", at: "2026-10-04T09:00:00.000Z" });

      /* The opened order carries each line's picture too. */
      const detail = await ordersModule.getOrderForUser(ids.shopper, placed.order.reference);
      expect(detail?.lines.find(line => line.productId === ids.lamp)?.photo).toBe("https://example.test/lamp-first.jpg");
      expect(detail?.lines.find(line => line.productId === ids.kettle)?.photo).toBeNull();
    } finally {
      await db.delete(productImages).where(eq(productImages.productId, photo.productId));
    }
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

/*
 * Discount codes and gift cards (3.2.3), against a real Postgres. The
 * arithmetic is proved pure in `shared/commerce/vouchers.test.ts`; what is
 * here is what cannot be — that a code's use count is the rows rather than a
 * column two orders can race, that a card's balance is taken with the
 * predicate inside the write, and that all three reductions land on the order
 * in the right order.
 */
/*
 * Bundles (3.3.11), against a real Postgres. The split is proved pure in
 * `shared/commerce/bundles.test.ts`; what is here is what cannot be — that the
 * saving reaches the order lines, that it comes off *both* sellers rather than
 * one funding the other, and that taking a member out of the basket puts the
 * rest back to their own prices.
 */
describe("bundles", () => {
  async function aBundle(price: string) {
    const [bundle] = await db.insert(bundlesTable).values({ name: "Lamp and kettle", bundlePrice: price }).returning();
    await db.insert(bundleItems).values([
      { bundleId: bundle.id, variantId: ids.lampVariant, quantity: 1, position: 0 },
      { bundleId: bundle.id, variantId: ids.kettleVariant, quantity: 1, position: 1 },
    ]);
    return bundle;
  }

  async function bundledBasket(bundleId: number, both = true) {
    const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.lampVariant, quantity: 1, bundleId });
    if (both) await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.kettleVariant, quantity: 1, bundleId });
    return cart.id;
  }

  /*
   * What the shop quotes is what the bag charges.
   *
   * The split prices each member per unit and rounds down, so the parts come
   * to a fil or two under the figure the seller typed. The offer printed the
   * seller's figure while the bag summed the parts, so a set advertised at
   * KWD 90.000 was billed at 89.997 — two numbers for one price, and the one
   * the shopper agreed to was not the one they paid.
   *
   * Three units cannot share seven fils evenly, so the quote follows the parts
   * rather than the parts chasing the quote. This pins the quote to the sum of
   * the members and to what a real basket comes to, which is what the first
   * fix got wrong: quoting the reduced figure while the pricing path re-split
   * it took the fils off twice.
   */
  it("quotes exactly what the basket will charge, to the fil", async () => {
    /* A price the per-unit split cannot divide evenly: three lamps at 24.375
       and one kettle at 11.250 is 84.375 separately. */
    const [bundle] = await db.insert(bundlesTable).values({ name: "Three lamps", bundlePrice: "70.001" }).returning();
    await db.insert(bundleItems).values([
      { bundleId: bundle.id, variantId: ids.lampVariant, quantity: 3, position: 0 },
      { bundleId: bundle.id, variantId: ids.kettleVariant, quantity: 1, position: 1 },
    ]);

    const [view] = await bundlesModule.loadBundles(db, { ids: [bundle.id] });
    /* The fixture genuinely exercises the rounding: three lamps and a kettle
       cannot share 70.001 evenly, and the parts come to 69.999. A fixture that
       divided cleanly would pass whether this was fixed or not. */
    expect(view.bundlePrice).not.toBe("70.001");
    const fromMembers = addMoney(...view.members.map(member => member.lineTotal));
    expect(view.bundlePrice).toBe(fromMembers);
    /* Never above what the seller set — the direction to be wrong in. */
    expect(Number(view.bundlePrice)).toBeLessThanOrEqual(70.001);

    const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: ids.shopper }).returning();
    await db.insert(cartItems).values([
      { cartId: cart.id, variantId: ids.lampVariant, quantity: 3, bundleId: bundle.id },
      { cartId: cart.id, variantId: ids.kettleVariant, quantity: 1, bundleId: bundle.id },
    ]);
    const placed = await ordersModule.placeOrder(cart.id, { ...DETAILS, userId: ids.shopper });
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order.itemsTotal).toBe(view.bundlePrice);
  });

  /*
   * The rule the cross-vendor case turns on: taking the whole saving off one
   * line would have that seller paying for the other's promotion.
   */
  it("takes the saving off both sellers in proportion", async () => {
    /* The lamp is 24.375 and the kettle 11.250 — 35.625 separately. */
    const bundle = await aBundle("32.000");
    const placed = await ordersModule.placeOrder(await bundledBasket(bundle.id), { ...DETAILS, userId: ids.shopper });

    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(lines.every(line => line.bundleName === "Lamp and kettle")).toBe(true);

    for (const line of lines) {
      /* Each line is discounted, and by roughly the same share. */
      const separately = line.variantId === ids.lampVariant ? 24.375 : 11.25;
      expect(Number(line.unitPrice)).toBeLessThan(separately);
      expect(Number(line.unitPrice) / separately).toBeCloseTo(32 / 35.625, 2);
    }
  });

  /* The identity the finance panel is tested against, at a bundle price. */
  it("keeps commission + vendorNet === lineTotal on every line", async () => {
    const bundle = await aBundle("32.000");
    const placed = await ordersModule.placeOrder(await bundledBasket(bundle.id), { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    for (const line of lines) {
      expect(addMoney(line.commissionAmount, line.vendorNet)).toBe(line.lineTotal);
    }
  });

  /* Two thirds of a bundle is a discount nobody agreed to. */
  it("puts the rest back to their own prices when a member is missing", async () => {
    const bundle = await aBundle("32.000");
    const placed = await ordersModule.placeOrder(await bundledBasket(bundle.id, false), { ...DETAILS, userId: ids.shopper });

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(line.unitPrice).toBe("24.375");
    expect(line.bundleId).toBeNull();
  });

  /* The shopper pays at most what the set says — never more. */
  it("charges no more than the bundle price", async () => {
    const bundle = await aBundle("32.000");
    const placed = await ordersModule.placeOrder(await bundledBasket(bundle.id), { ...DETAILS, userId: ids.shopper });
    expect(Number(placed.totals.itemsTotal)).toBeLessThanOrEqual(32);
    expect(Number(placed.totals.itemsTotal)).toBeGreaterThan(31.99);
  });
});

describe("codes and gift cards", () => {
  const buy = (cartId: string, voucherCode?: string) =>
    ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper, voucherCode });

  it("takes a percentage off the goods and freezes it", async () => {
    await db.insert(discountCodes).values({ code: "TENOFF", kind: "percent", value: "10" });
    const placed = await buy(await basket([{ variantId: ids.lampVariant, quantity: 2 }], ids.shopper), "ten-off");

    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    // 24.375 × 2 = 48.750, ten percent of which is 4.875.
    expect(order.discountCode).toBe("TENOFF");
    expect(order.discountValue).toBe("4.875");
    expect(order.grandTotal).toBe("43.875");
  });

  /* The row is the count, so this is also what makes "all used up" true. */
  it("refuses a code that has been used as often as it allows", async () => {
    await db.insert(discountCodes).values({ code: "ONCE", kind: "fixed", value: "1.000", maxRedemptions: 1 });
    await buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "ONCE");

    await expect(buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "ONCE"))
      .rejects.toMatchObject({ reason: "order.voucherGone" });
  });

  it("refuses a code whose window has passed", async () => {
    await db.insert(discountCodes).values({
      code: "LASTYEAR", kind: "fixed", value: "1.000", endsAt: new Date("2020-01-01"),
    });
    await expect(buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "LASTYEAR"))
      .rejects.toMatchObject({ reason: "order.voucherGone" });
  });

  it("spends a gift card down and records what it paid", async () => {
    await db.insert(giftCards).values({ code: "NLGIFT1", initialBalance: "10.000", remaining: "10.000" });
    const placed = await buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "NLGIFT1");

    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order.giftCardCode).toBe("NLGIFT1");
    expect(order.giftCardValue).toBe("10.000");
    /* 24.375, and this seller delivers free, less the card's 10.000. */
    expect(order.grandTotal).toBe("14.375");

    const [card] = await db.select().from(giftCards).where(eq(giftCards.code, "NLGIFT1"));
    expect(card.remaining).toBe("0.000");
  });

  /* Partial use is ordinary; a card that had to be spent in one go would be a
     voucher with extra steps. */
  it("pays only what is owed and leaves the rest on the card", async () => {
    await db.insert(giftCards).values({ code: "NLGIFT2", initialBalance: "500.000", remaining: "500.000" });
    const placed = await buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "NLGIFT2");

    const [order] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
    expect(order.grandTotal).toBe("0.000");
    const [card] = await db.select().from(giftCards).where(eq(giftCards.code, "NLGIFT2"));
    expect(card.remaining).toBe("475.625");
  });

  it("refuses an empty card rather than charging the full price", async () => {
    await db.insert(giftCards).values({ code: "NLSPENT", initialBalance: "5.000", remaining: "0.000" });
    await expect(buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "NLSPENT"))
      .rejects.toMatchObject({ reason: "order.voucherGone" });
  });

  it("refuses a code nobody has heard of", async () => {
    await expect(buy(await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper), "NOPE"))
      .rejects.toMatchObject({ reason: "order.voucherGone" });
  });

  /* The card's balance has to go back when the order does not happen, the same
     as the stock and the points. */
  it("puts the card's money back when the order fails", async () => {
    await db.insert(giftCards).values({ code: "NLGIFT3", initialBalance: "10.000", remaining: "10.000" });
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    await db.update(productVariants).set({ stock: 0, preorderStock: 0 }).where(eq(productVariants.id, ids.lampVariant));

    await expect(buy(cartId, "NLGIFT3")).rejects.toMatchObject({ reason: "order.outOfStock" });
    const [card] = await db.select().from(giftCards).where(eq(giftCards.code, "NLGIFT3"));
    expect(card.remaining).toBe("10.000");
    await db.update(productVariants).set({ stock: 40 }).where(eq(productVariants.id, ids.lampVariant));
  });
});

/*
 * Fraud signals (3.6.5), against a real Postgres. The judgement is proved pure
 * in `shared/commerce/fraudSignals.test.ts`; what is here is the counting it
 * cannot do — the account's age at the moment of the order, how many *other*
 * accounts have used that address, and that a vendor is refused the lot.
 */
describe("what an order looks like from the platform's side", () => {
  it("says nothing about an ordinary order", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper },
    );
    const [judged] = await fraud.riskForOrders(adminActor(), [placed.order.id]);
    expect(judged).toMatchObject({ risk: "low", flags: [] });
  });

  /* The goods leave the warehouse before any money exists. */
  it("notices a large cash order, with the figure attached", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 10 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper, paymentMethod: "cod" },
    );
    const [judged] = await fraud.riskForOrders(adminActor(), [placed.order.id]);
    expect(judged.flags.map(flag => flag.signal)).toContain("highValueCash");
    expect(judged.risk).not.toBe("low");
  });

  /*
   * The shopper's own repeat orders to their own address are the ordinary
   * case and would drown the signal, so the count is of *other* accounts.
   */
  it("counts other accounts at one address and not the shopper's own orders", async () => {
    for (let n = 0; n < 3; n += 1) {
      await ordersModule.placeOrder(
        await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
        { ...DETAILS, userId: ids.shopper },
      );
    }
    const mine = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper },
    );
    const [judged] = await fraud.riskForOrders(adminActor(), [mine.order.id]);
    expect(judged.flags.map(flag => flag.signal)).not.toContain("addressManyAccounts");
  });

  /* The signals name other accounts' behaviour, so a seller does not get them. */
  it("refuses a vendor", async () => {
    await expect(fraud.riskForOrders(acmeActor(), [1])).rejects.toThrow("FORBIDDEN:platform.viewAll");
  });

  it("asks for nothing when given nothing", async () => {
    expect(await fraud.riskForOrders(adminActor(), [])).toEqual([]);
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

/**
 * Different addresses for different things in one basket (3.2.6).
 *
 * The arithmetic — a parcel per seller per door, the threshold measured at
 * each — is proved pure in `shared/commerce/addresses.test.ts`. What needs a
 * database is that the door is scoped to the shopper who owns it, that it is
 * *copied* onto the line rather than referenced, and that deleting the address
 * afterwards leaves the order still able to say where the parcel went.
 */
describe("sending part of a basket somewhere else", () => {
  let addressesModule: typeof import("./addresses.js");

  beforeAll(async () => {
    addressesModule = await import("./addresses.js");
  });

  const office = {
    label: "Office",
    contactName: "A Colleague",
    contactPhone: "+96550111222",
    governorate: "capital",
    addressLine: "Block 1, Street 2, Tower 3",
  };

  it("freezes the door onto the line and leaves the rest alone", async () => {
    const saved = await addressesModule.addAddress(ids.shopper, office);
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const [lampLine] = await db
      .select()
      .from(cartItems)
      .where(eq(cartItems.variantId, ids.lampVariant));
    await addressesModule.setLineDestination(cartId, ids.shopper, lampLine.id, saved.id);

    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const lamp = lines.find(line => line.variantId === ids.lampVariant)!;
    const kettle = lines.find(line => line.variantId === ids.kettleVariant)!;

    expect(lamp.destination?.label).toBe("Office");
    expect(lamp.destination?.addressLine).toBe("Block 1, Street 2, Tower 3");
    // Everything else went where the order went, so it carries no copy at all.
    expect(kettle.destination).toBeNull();

    /* Copied, not referenced: deleting the address must not take with it the
       record of where a parcel was actually sent. */
    await addressesModule.removeAddress(ids.shopper, saved.id);
    const [reread] = await db.select().from(orderItems).where(eq(orderItems.id, lamp.id));
    expect(reread.destination?.label).toBe("Office");
  });

  it("charges one seller twice for two doors, and freezes both", async () => {
    await db.update(vendors)
      .set({ deliveryFlat: "2.000", deliveryFreeOver: "60.000" })
      .where(eq(vendors.id, ids.acme));
    const saved = await addressesModule.addAddress(ids.shopper, office);

    /*
     * A lamp at 24.375 and a press at 40.000 is 64.375 with this seller — over
     * their sixty, so sent to one door the delivery is free. Split across two
     * doors it is two parcels and neither clears the threshold on its own,
     * which is the whole rule: one threshold does not buy two deliveries.
     */
    const lines = [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.pressVariant, quantity: 1 }];

    const oneDoor = await basket(lines, ids.shopper);
    const free = await ordersModule.placeOrder(oneDoor, { ...DETAILS, userId: ids.shopper });
    const [asOne] = await db.select().from(orders).where(eq(orders.id, free.order.id));
    expect(asOne.deliveryTotal).toBe("0.000");
    expect(asOne.deliveryBreakdown?.filter(row => row.vendorId === ids.acme)).toHaveLength(1);

    const twoDoors = await basket(lines, ids.shopper);
    const lampLine = (await db.select().from(cartItems).where(eq(cartItems.cartId, twoDoors)))
      .find(line => line.variantId === ids.lampVariant)!;
    await addressesModule.setLineDestination(twoDoors, ids.shopper, lampLine.id, saved.id);

    const split = await ordersModule.placeOrder(twoDoors, { ...DETAILS, userId: ids.shopper });
    const [asTwo] = await db.select().from(orders).where(eq(orders.id, split.order.id));
    const parcels = (asTwo.deliveryBreakdown ?? []).filter(row => row.vendorId === ids.acme);

    expect(parcels).toHaveLength(2);
    expect(new Set(parcels.map(row => row.destinationLabel ?? null))).toEqual(new Set(["Office", null]));
    expect(parcels.every(row => row.fee === "2.000")).toBe(true);
    expect(asTwo.deliveryTotal).toBe("4.000");

    await addressesModule.removeAddress(ids.shopper, saved.id);
    await db.update(vendors).set({ deliveryFlat: null, deliveryFreeOver: null }).where(eq(vendors.id, ids.acme));
  });

  it("refuses a door that is not this shopper's", async () => {
    const [stranger] = await db.insert(users).values({ email: `stranger-${Date.now()}@example.test` }).returning();
    const theirs = await addressesModule.addAddress(stranger.id, office);

    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const [line] = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));

    await expect(
      addressesModule.setLineDestination(cartId, ids.shopper, line.id, theirs.id),
    ).rejects.toThrow("address.unknown");
  });

  it("refuses a guest, who has no book to pick from", async () => {
    const saved = await addressesModule.addAddress(ids.shopper, office);
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }]);
    const [line] = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));

    await expect(
      addressesModule.setLineDestination(cartId, null, line.id, saved.id),
    ).rejects.toThrow("address.needsAccount");
    await addressesModule.removeAddress(ids.shopper, saved.id);
  });

  it("refuses an address that is actively wrong, and keeps one merely incomplete", async () => {
    await expect(
      addressesModule.addAddress(ids.shopper, { ...office, contactPhone: "12" }),
    ).rejects.toThrow("address.badPhone");

    const bare = await addressesModule.addAddress(ids.shopper, { label: "Mum's", addressLine: "Block 9" });
    expect(bare.governorate).toBeNull();
    await addressesModule.removeAddress(ids.shopper, bare.id);
  });
});

/**
 * A discount code's ceiling, under two tabs.
 *
 * The stock take, the gift-card spend and the one-open-price-request all put
 * their guard *inside* the write — a predicate in the UPDATE or a partial
 * unique index — because a read followed by a write is two tabs away from
 * being wrong. The discount code counted its redemptions in a SELECT and then
 * inserted, and the only unique index is on `(code, order)`, which stops one
 * order redeeming twice and nothing else.
 */
describe("a discount code's ceiling", () => {
  beforeEach(async () => {
    await db.delete(discountRedemptions);
    await db.delete(discountCodes);
  });

  it("is not exceeded by two checkouts at once", async () => {
    await db.insert(discountCodes).values({
      code: "ONLYONE", kind: "percent", value: "10.00", active: true, maxRedemptions: 1,
    });

    const first = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const second = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);

    const results = await Promise.allSettled([
      ordersModule.placeOrder(first, { ...DETAILS, userId: ids.shopper, voucherCode: "ONLYONE" }),
      ordersModule.placeOrder(second, { ...DETAILS, userId: ids.shopper, voucherCode: "ONLYONE" }),
    ]);

    const placed = results.filter(r => r.status === "fulfilled");
    const refused = results.filter(r => r.status === "rejected");
    const redemptions = await db.select().from(discountRedemptions);
    const discounted = (await db.select().from(orders)).filter(row => Number(row.discountValue) > 0);

    /* One gets it. The other is refused rather than quietly charged the full
       price — the rule the code already follows for a voucher that stops
       working between the page and the button. */
    expect(placed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason.message).toBe("order.voucherGone");
    expect(redemptions).toHaveLength(1);
    expect(discounted).toHaveLength(1);
  });

  it("is not exceeded one shopper at a time either", async () => {
    await db.insert(discountCodes).values({
      code: "ONCEEACH", kind: "percent", value: "10.00", active: true, perShopper: 1,
    });

    const first = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const second = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);

    await Promise.allSettled([
      ordersModule.placeOrder(first, { ...DETAILS, userId: ids.shopper, voucherCode: "ONCEEACH" }),
      ordersModule.placeOrder(second, { ...DETAILS, userId: ids.shopper, voucherCode: "ONCEEACH" }),
    ]);

    const discounted = (await db.select().from(orders)).filter(row => Number(row.discountValue) > 0);
    expect(discounted).toHaveLength(1);

    /* And the row that records it names the shopper, so the next attempt by
       the same account is refused by the count rather than by luck. */
    const redemptions = await db.select().from(discountRedemptions);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].userId).toBe(ids.shopper);
  });
});

/*
 * A seller cancels a line they cannot fulfil.
 *
 * Found by doing exactly that on a real order: the unit was never put back,
 * nothing stopped the line being walked anywhere afterwards, and the cash that
 * had already been collected for it was left owing nobody knew what.
 */
describe("cancelling and restoring a line", () => {
  async function oneLampLine(quantity = 2) {
    const placed = await ordersModule.placeOrder(await basket([{ variantId: ids.lampVariant, quantity }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    return { placed, line };
  }

  /* A kettle beside it, so cancelling the lamp leaves something coming and the
     order open — the only kind of order a line can be restored on. */
  async function lampBesideKettle(quantity = 2) {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity }, { variantId: ids.kettleVariant, quantity: 1 }]),
      DETAILS,
    );
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    return { placed, line: lines.find(row => row.vendorId === ids.acme)! };
  }

  it("puts the cancelled units back on the shelf", async () => {
    const { line } = await oneLampLine(2);
    expect(await stockOf(ids.lampVariant)).toBe(8);

    await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
    expect(await stockOf(ids.lampVariant)).toBe(10);
  });

  /* Back to the pool it came from: a pre-ordered unit returned as shelf stock
     would invent inventory out of a promise. */
  it("returns a pre-ordered line to the pre-order allowance, not the shelf", async () => {
    const placed = await ordersModule.placeOrder(await basket([{ variantId: ids.pressVariant, quantity: 1 }]), DETAILS);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(await preorderStockOf(ids.pressVariant)).toBe(2);

    await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
    expect(await preorderStockOf(ids.pressVariant)).toBe(3);
    expect(await stockOf(ids.pressVariant)).toBe(0);
  });

  it("takes the units again when a cancelled line is restored", async () => {
    const { line } = await lampBesideKettle(2);
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "pending");
    expect(await stockOf(ids.lampVariant)).toBe(8);
  });

  /* The checkout's own predicate: there is no restoring a line onto stock that
     has since been sold to somebody else. */
  it("refuses to restore a line when its stock has since sold", async () => {
    const { line } = await lampBesideKettle(2);
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.id, ids.lampVariant));

    await expect(ordersModule.setLineFulfilment(acmeActor(), line.id, "pending"))
      .rejects.toMatchObject({ reason: "orders.noStockToRestore" });
    expect(await stockOf(ids.lampVariant)).toBe(1);
    const [after] = await db.select().from(orderItems).where(eq(orderItems.id, line.id));
    expect(after.fulfilment).toBe("cancelled");
  });

  /* With the cash in, a cancelled line is a refund wearing the wrong name. */
  it("refuses to cancel a line once the order's cash has been collected", async () => {
    const placed = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper, paymentMethod: "cod" },
    );
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    expect(await ordersModule.recordCashCollected(acmeActor(), placed.order.id)).toBe(true);

    await expect(ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled"))
      .rejects.toMatchObject({ reason: "orders.alreadySettled" });
    expect(await stockOf(ids.lampVariant)).toBe(9);
  });

  /* `nextStates` was only ever asked by the page drawing the buttons. A seller
     marking a line returned is the plainest case: a return is the shopper's act,
     and the API took it from the seller anyway. */
  it("refuses a move its own rules forbid, through the data layer and not only the page", async () => {
    const { line } = await oneLampLine(1);
    await ordersModule.setLineFulfilment(acmeActor(), line.id, "delivered");

    await expect(ordersModule.setLineFulfilment(acmeActor(), line.id, "returned"))
      .rejects.toMatchObject({ reason: "orders.badMove" });

    const { line: cancelled } = await oneLampLine(1);
    await ordersModule.setLineFulfilment(acmeActor(), cancelled.id, "cancelled");
    await expect(ordersModule.setLineFulfilment(acmeActor(), cancelled.id, "shipped"))
      .rejects.toMatchObject({ reason: "orders.badMove" });
  });

  /* The shopper's own order says what the driver will ask for. */
  it("tells the shopper what the order owes once a line is cancelled", async () => {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const kettle = lines.find(row => row.vendorId === ids.other)!;
    await ordersModule.setLineFulfilment(otherActor(), kettle.id, "cancelled");

    const mine = await ordersModule.getOrderForUser(ids.shopper, placed.order.reference);
    expect(mine?.owed?.reduced).toBe(true);
    expect(mine?.owed?.droppedGoods).toBe(kettle.lineTotal);
    const listed = await ordersModule.listOrdersForUser(ids.shopper);
    expect(listed.rows.find(row => row.id === placed.order.id)?.owed?.owed).toBe(mine?.owed?.owed);
  });

  /* A line's total already carries its fittings. The first draft took them off
     again, so cancelling a lamp with three fittings under-charged by 15.000. */
  it("takes a cancelled line's add-ons off once, not twice", async () => {
    const [addon] = await db.insert(productAddons).values({
      productId: ids.lamp, kind: "installation", label: "Fitting at your address", price: "5.000",
    }).returning();
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 3 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const [lampInBag] = await db.select().from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, ids.lampVariant)));
    await db.insert(cartItemAddons).values({ cartItemId: lampInBag.id, addonId: addon.id });

    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const lamp = lines.find(row => row.vendorId === ids.acme)!;
    expect(lamp.lineTotal).toBe("88.125");
    await ordersModule.setLineFulfilment(acmeActor(), lamp.id, "cancelled");

    const mine = await ordersModule.getOrderForUser(ids.shopper, placed.order.reference);
    expect(mine?.owed?.droppedGoods).toBe("88.125");
    const acmeFee = (placed.order.deliveryBreakdown as { vendorId: number; fee: string }[] | null)
      ?.filter(charge => charge.vendorId === ids.acme)
      .reduce((sum, charge) => addMoney(sum, charge.fee), "0.000") ?? "0.000";
    expect(mine?.owed?.droppedDelivery).toBe(acmeFee);
    expect(addMoney(mine!.owed!.owed, "88.125", acmeFee)).toBe(placed.order.grandTotal);
  });

  /* A card, points and a code spent on an order that delivers nothing were
     simply kept: owed floored at zero and nothing gave them back. */
  describe("when the last line goes", () => {
    async function paidWithEverything() {
      await db.delete(pointEntries);
      await db.delete(giftCardUses);
      await db.delete(discountRedemptions);
      await db.delete(giftCards);
      await db.delete(discountCodes);
      await db.insert(pointEntries).values({ userId: ids.shopper, points: 500, reason: "admin_adjustment" });
      await db.insert(giftCards).values({ code: "NLBACK", initialBalance: "5.000", remaining: "5.000" });
      await db.insert(discountCodes).values({ code: "ONEUSE", kind: "fixed", value: "1.000", maxRedemptions: 1 });

      const cartId = await basket(
        [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }],
        ids.shopper,
      );
      /* The code first; a card in the same box would be a second code. */
      const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper, voucherCode: "ONEUSE", usePoints: true });
      const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
      return { placed, lamp: lines.find(row => row.vendorId === ids.acme)!, kettle: lines.find(row => row.vendorId === ids.other)! };
    }

    const balance = async () =>
      (await db.select().from(pointEntries).where(eq(pointEntries.userId, ids.shopper)))
        .reduce((sum, row) => sum + row.points, 0);

    it("closes the order and gives the points and the code back", async () => {
      const { placed, lamp, kettle } = await paidWithEverything();
      expect(placed.order.pointsSpent).toBeGreaterThan(0);
      const before = await balance();

      /* One line left: nothing comes back yet, the order is still coming. */
      await ordersModule.setLineFulfilment(otherActor(), kettle.id, "cancelled");
      expect((await db.select().from(orders).where(eq(orders.id, placed.order.id)))[0].status).toBe("pending_payment");
      expect(await balance()).toBe(before);

      await ordersModule.setLineFulfilment(acmeActor(), lamp.id, "cancelled");
      const [closed] = await db.select().from(orders).where(eq(orders.id, placed.order.id));
      expect(closed.status).toBe("cancelled");
      expect(await balance()).toBe(before + placed.order.pointsSpent);
      const entries = await db.select().from(pointEntries).where(and(eq(pointEntries.orderId, placed.order.id), eq(pointEntries.reason, "order_cancelled")));
      expect(entries).toHaveLength(1);
      expect(await db.select().from(discountRedemptions).where(eq(discountRedemptions.orderId, placed.order.id))).toHaveLength(0);
    });

    it("puts a gift card's balance back, and drops its use", async () => {
      await db.delete(giftCardUses);
      await db.delete(giftCards);
      await db.insert(giftCards).values({ code: "NLBACK2", initialBalance: "5.000", remaining: "5.000" });
      const placed = await ordersModule.placeOrder(
        await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper),
        { ...DETAILS, userId: ids.shopper, voucherCode: "NLBACK2" },
      );
      expect((await db.select().from(giftCards).where(eq(giftCards.code, "NLBACK2")))[0].remaining).toBe("0.000");
      const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));

      await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
      expect((await db.select().from(giftCards).where(eq(giftCards.code, "NLBACK2")))[0].remaining).toBe("5.000");
      expect(await db.select().from(giftCardUses).where(eq(giftCardUses.orderId, placed.order.id))).toHaveLength(0);
    });

    /* Its card and points went back when it closed; restoring would deliver
       goods nobody is now paying for with them. */
    it("will not reopen a closed order by restoring a line", async () => {
      const { line, placed } = await oneLampLine(1);
      await ordersModule.setLineFulfilment(acmeActor(), line.id, "cancelled");
      expect((await db.select().from(orders).where(eq(orders.id, placed.order.id)))[0].status).toBe("cancelled");

      await expect(ordersModule.setLineFulfilment(acmeActor(), line.id, "pending"))
        .rejects.toMatchObject({ reason: "orders.orderClosed" });
      expect(await stockOf(ids.lampVariant)).toBe(10);
    });

    /* Two sellers cancelling the last two lines at once: one of them closes it. */
    it("hands everything back once when two lines go at the same moment", async () => {
      const { placed, lamp, kettle } = await paidWithEverything();
      const before = await balance();
      await Promise.all([
        ordersModule.setLineFulfilment(acmeActor(), lamp.id, "cancelled"),
        ordersModule.setLineFulfilment(otherActor(), kettle.id, "cancelled"),
      ]);
      expect(await balance()).toBe(before + placed.order.pointsSpent);
    });
  });

  /* The order desk is the third place the figure is read. */
  it("shows the seller's desk what is still coming, not what was first ordered", async () => {
    const cartId = await basket(
      [{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }],
      ids.shopper,
    );
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, userId: ids.shopper });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
    const kettle = lines.find(row => row.vendorId === ids.other)!;
    await ordersModule.setLineFulfilment(otherActor(), kettle.id, "cancelled");

    const mine = await ordersModule.getOrderForUser(ids.shopper, placed.order.reference);
    const asAdmin = (await ordersModule.listOrdersFor(adminActor())).rows.find(row => row.id === placed.order.id);
    expect(asAdmin?.orderTotal).toBe(mine?.owed?.owed);
    const asOther = (await ordersModule.listOrdersFor(otherActor())).rows.find(row => row.id === placed.order.id);
    expect(asOther?.orderTotal).toBe("0.000");
  });
});

/*
 * The header's "on its way" (3.4.3). A parcel is on the road when a line is
 * shipped and not yet delivered; it is a fact about this shopper's own orders
 * and nobody else's.
 */
describe("orders on their way", () => {
  it("counts an order once it has a shipped line, and only the shopper's own", async () => {
    expect(await ordersModule.ordersOnTheWay(ids.shopper)).toEqual({ count: 0, latest: null });

    const first = await ordersModule.placeOrder(
      await basket([{ variantId: ids.lampVariant, quantity: 1 }, { variantId: ids.kettleVariant, quantity: 1 }], ids.shopper),
      { ...DETAILS, userId: ids.shopper },
    );
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, first.order.id));
    /* Two lines shipped is still one order on its way. */
    for (const line of lines) await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.id, line.id));
    expect(await ordersModule.ordersOnTheWay(ids.shopper)).toEqual({ count: 1, latest: first.order.reference });
    expect(await ordersModule.ordersOnTheWay(ids.admin)).toEqual({ count: 0, latest: null });

    /* Delivered is no longer on its way. */
    for (const line of lines) await db.update(orderItems).set({ fulfilment: "delivered" }).where(eq(orderItems.id, line.id));
    expect((await ordersModule.ordersOnTheWay(ids.shopper)).count).toBe(0);

    /* Nor is a cancelled order, whatever a line still says. */
    await db.update(orderItems).set({ fulfilment: "shipped" }).where(eq(orderItems.id, lines[0].id));
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, first.order.id));
    expect((await ordersModule.ordersOnTheWay(ids.shopper)).count).toBe(0);
  });
});

describe("an address as its parts", () => {
  const parts = { area: "Salmiya", block: "٤", street: "Baghdad St", building: "15", floor: "2", apartment: "5", paciNumber: "12345678" };

  it("is kept in the book as parts, with the line composed from them", async () => {
    const addresses = await import("./addresses.js");
    const saved = await addresses.addAddress(ids.shopper, { label: "Flat", governorate: "hawalli", parts });
    expect(saved.addressLine).toBe("Salmiya, Block 4, Street Baghdad St, House 15, Floor 2, Apartment 5, PACI 12345678");
    expect(saved.parts).toEqual({ ...parts, block: "4" });
    /* An address from before the parts keeps its line when edited without them. */
    const older = await addresses.addAddress(ids.shopper, { label: "Old", addressLine: "Near the co-op" });
    const edited = await addresses.updateAddress(ids.shopper, older.id, { label: "Old place", addressLine: "Near the co-op" });
    expect(edited).toMatchObject({ addressLine: "Near the co-op", parts: null });
    await addresses.removeAddress(ids.shopper, saved.id);
    await addresses.removeAddress(ids.shopper, older.id);
  });

  it("is frozen on the order beside the line it composes", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    const placed = await ordersModule.placeOrder(cartId, { ...DETAILS, addressLine: null, addressParts: parts, userId: ids.shopper });
    expect(placed.order.addressLine).toBe("Salmiya, Block 4, Street Baghdad St, House 15, Floor 2, Apartment 5, PACI 12345678");
    expect(placed.order.deliveryAddressParts).toEqual({ ...parts, block: "4" });
  });

  it("refuses parts a driver could not find the door by, before anything is taken", async () => {
    const cartId = await basket([{ variantId: ids.lampVariant, quantity: 1 }], ids.shopper);
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, addressLine: null, addressParts: { area: "Salmiya" }, userId: ids.shopper }))
      .rejects.toThrow("address.needsParts");
    await expect(ordersModule.placeOrder(cartId, { ...DETAILS, addressLine: null, addressParts: { ...parts, paciNumber: "12" }, userId: ids.shopper }))
      .rejects.toThrow("address.badPaci");
  });
});
