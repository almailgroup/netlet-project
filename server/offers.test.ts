/**
 * The special-price negotiation, against a real Postgres.
 *
 * The rules are proved pure in `shared/commerce/priceOffers.test.ts`. What is
 * here is everything that cannot be: that a second open request is refused by
 * the *index* rather than by a check two tabs can race past, that one shopper
 * cannot read or withdraw another's, that a vendor cannot answer a request
 * belonging to a different seller, and — the one that costs money — that the
 * agreed price is what the cart shows and what the order freezes.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems, carts, priceOffers, products, productVariants, users, vendors,
} from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let offers: typeof import("./offers.js");
let catalog: typeof import("./catalog.js");
let orders: typeof import("./orders.js");

const ids = {
  admin: 0, acmeOwner: 0, otherOwner: 0, shopper: 0, stranger: 0,
  acme: 0, other: 0, product: 0, variant: 0, plainVariant: 0, otherVariant: 0,
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
  offers = await import("./offers.js");
  catalog = await import("./catalog.js");
  orders = await import("./orders.js");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [acmeOwner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [otherOwner] = await db.insert(users).values({ email: "owner@other.test" }).returning();
  const [shopper] = await db.insert(users).values({ email: "shopper@example.test" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();

  const [acme] = await db.insert(vendors).values({
    slug: "acme", name: "Acme", status: "approved", acceptsOffers: true,
  }).returning();
  const [other] = await db.insert(vendors).values({
    slug: "other", name: "Other", status: "approved", acceptsOffers: false,
  }).returning();

  const [sofa] = await db.insert(products).values({
    vendorId: acme.id, handle: "sofa", title: "Velvet Sofa", status: "published",
  }).returning();
  /* Opted out at the product even though the vendor is in — the override this
     feature exists to make possible. */
  const [batteries] = await db.insert(products).values({
    vendorId: acme.id, handle: "batteries", title: "Batteries", status: "published", acceptsOffers: false,
  }).returning();
  const [lamp] = await db.insert(products).values({
    vendorId: other.id, handle: "lamp", title: "Lamp", status: "published", acceptsOffers: true,
  }).returning();

  const [sofaVariant] = await db.insert(productVariants).values({
    productId: sofa.id, title: "Default", sku: "SOFA-1", price: "100.000", stock: 20,
  }).returning();
  const [batteryVariant] = await db.insert(productVariants).values({
    productId: batteries.id, title: "Default", sku: "BAT-1", price: "2.000", stock: 50,
  }).returning();
  const [lampVariant] = await db.insert(productVariants).values({
    productId: lamp.id, title: "Default", sku: "LAMP-1", price: "30.000", stock: 5,
  }).returning();

  Object.assign(ids, {
    admin: admin.id, acmeOwner: acmeOwner.id, otherOwner: otherOwner.id,
    shopper: shopper.id, stranger: stranger.id, acme: acme.id, other: other.id,
    product: sofa.id, variant: sofaVariant.id,
    plainVariant: batteryVariant.id, otherVariant: lampVariant.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(priceOffers);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.update(productVariants).set({ price: "100.000" }).where(eq(productVariants.id, ids.variant));
});

const acmeManager = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "manager" });
const acmeStaff = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "staff" });
const otherOwner = (): Actor => ({ kind: "vendor", userId: ids.otherOwner, vendorId: ids.other, role: "owner" });
const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });

const ask = (over: Partial<Parameters<typeof offers.requestOffer>[0]> = {}) =>
  offers.requestOffer({ userId: ids.shopper, variantId: ids.variant, askedPrice: "80.000", quantity: 1, ...over });

describe("who may be asked", () => {
  it("takes a request on a product whose vendor opted in", async () => {
    const view = await ask();
    expect(view.state).toBe("pending");
    expect(view.listPrice).toBe("100.000");
  });

  /* The override the nullable column exists for: vendor in, product out. */
  it("refuses a product that opted out of its vendor's answer", async () => {
    await expect(ask({ variantId: ids.plainVariant, askedPrice: "1.000" })).rejects.toMatchObject({
      refusal: "NOT_NEGOTIABLE",
    });
  });

  it("takes a product that opted in over its vendor's no", async () => {
    const view = await ask({ variantId: ids.otherVariant, askedPrice: "20.000" });
    expect(view.state).toBe("pending");
  });

  it("reports which variants are open without being asked who is calling", async () => {
    const open = await offers.offersOpenOn([ids.variant, ids.plainVariant, ids.otherVariant]);
    expect([...open].sort()).toEqual([ids.variant, ids.otherVariant].sort());
  });
});

describe("what may be asked", () => {
  it("refuses an ask at or above the shelf price", async () => {
    await expect(ask({ askedPrice: "100.000" })).rejects.toMatchObject({ refusal: "ASK_OUT_OF_RANGE" });
    await expect(ask({ askedPrice: "120.000" })).rejects.toMatchObject({ refusal: "ASK_OUT_OF_RANGE" });
  });

  /* A free product must not arrive by negotiation either. */
  it("refuses an ask of nothing", async () => {
    await expect(ask({ askedPrice: "0.000" })).rejects.toMatchObject({ refusal: "ASK_OUT_OF_RANGE" });
  });

  /*
   * The partial unique index is what stops this, not a read-then-insert check
   * — two tabs are enough to race one of those.
   */
  it("refuses a second open request on the same variant", async () => {
    await ask();
    await expect(ask({ askedPrice: "70.000" })).rejects.toMatchObject({ refusal: "ALREADY_OPEN" });
  });

  it("lets the shopper ask again once the first was answered and spent, or refused", async () => {
    const first = await ask();
    await offers.declineOffer(acmeManager(), { offerId: first.id });
    await expect(ask({ askedPrice: "70.000" })).resolves.toMatchObject({ state: "pending" });
  });

  it("freezes the shelf price the seller is being asked about", async () => {
    const view = await ask();
    await db.update(productVariants).set({ price: "250.000" }).where(eq(productVariants.id, ids.variant));
    const [row] = await db.select().from(priceOffers).where(eq(priceOffers.id, view.id));
    expect(row.listPrice).toBe("100.000");
  });
});

describe("who may answer", () => {
  it("refuses a staff member — a special price is a pricing decision", async () => {
    const view = await ask();
    await expect(offers.answerOffer(acmeStaff(), { offerId: view.id, offeredPrice: "85.000" }))
      .rejects.toThrow(/FORBIDDEN/);
  });

  /* Scope is checked against the request's own vendor, so another seller's id
     is a refusal rather than a leak. */
  it("refuses a different seller entirely", async () => {
    const view = await ask();
    await expect(offers.answerOffer(otherOwner(), { offerId: view.id, offeredPrice: "85.000" }))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it("allows the product's own vendor, and an admin", async () => {
    const one = await ask();
    await expect(offers.answerOffer(acmeManager(), { offerId: one.id, offeredPrice: "85.000" })).resolves.toBeUndefined();
    await offers.markOffersUsed(db, [one.id], 0).catch(() => undefined);

    await db.delete(priceOffers);
    const two = await ask();
    await expect(offers.answerOffer(adminActor(), { offerId: two.id, offeredPrice: "85.000" })).resolves.toBeUndefined();
  });

  it("refuses an answer above the price the seller was asked about", async () => {
    const view = await ask();
    await expect(offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "110.000" }))
      .rejects.toMatchObject({ refusal: "OFFER_OUT_OF_RANGE" });
  });

  it("refuses to answer the same request twice", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });
    await expect(offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "70.000" }))
      .rejects.toMatchObject({ refusal: "NOT_OPEN" });
  });
});

describe("the inbox", () => {
  it("shows a seller their own requests and nobody else's", async () => {
    await ask();
    await offers.requestOffer({ userId: ids.stranger, variantId: ids.otherVariant, askedPrice: "20.000", quantity: 1 });

    const mine = await offers.listOffersForVendor(acmeManager(), {});
    expect(mine.rows.map(row => row.productTitle)).toEqual(["Velvet Sofa"]);

    const all = await offers.listOffersForVendor(adminActor(), {});
    expect(all.total).toBe(2);
  });

  it("counts only what is actually waiting", async () => {
    const one = await ask();
    await offers.requestOffer({ userId: ids.stranger, variantId: ids.variant, askedPrice: "70.000", quantity: 1 });
    expect(await offers.countOpenOffers(acmeManager())).toBe(2);

    await offers.declineOffer(acmeManager(), { offerId: one.id });
    expect(await offers.countOpenOffers(acmeManager())).toBe(1);
  });

  /* `open` is worked out in SQL, not over the page that happened to load. */
  it("narrows to open requests on the server", async () => {
    const one = await ask();
    await offers.requestOffer({ userId: ids.stranger, variantId: ids.variant, askedPrice: "70.000", quantity: 1 });
    await offers.answerOffer(acmeManager(), { offerId: one.id, offeredPrice: "85.000" });

    const open = await offers.listOffersForVendor(acmeManager(), { open: true });
    expect(open.total).toBe(1);
    expect(open.rows[0].state).toBe("pending");
  });
});

describe("the shopper's own view", () => {
  it("refuses to withdraw somebody else's request", async () => {
    const view = await ask();
    await expect(offers.withdrawOffer(ids.stranger, view.id)).rejects.toMatchObject({ refusal: "NOT_OPEN" });
    const [row] = await db.select().from(priceOffers).where(eq(priceOffers.id, view.id));
    expect(row.status).toBe("pending");
  });

  it("withdraws the shopper's own", async () => {
    const view = await ask();
    await offers.withdrawOffer(ids.shopper, view.id);
    expect((await offers.offerForVariant(ids.shopper, ids.variant))?.state).toBe("withdrawn");
  });

  it("lists only this shopper's requests", async () => {
    await ask();
    await offers.requestOffer({ userId: ids.stranger, variantId: ids.otherVariant, askedPrice: "20.000", quantity: 1 });
    expect((await offers.listOffersForShopper(ids.shopper)).length).toBe(1);
  });
});

/* ------------------------------------------ what the shopper actually pays --- */

async function bagFor(userId: number | null, variantId = ids.variant, quantity = 1) {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId }).returning();
  await db.insert(cartItems).values({ cartId: cart.id, variantId, quantity });
  return cart.id;
}

describe("the agreed price", () => {
  it("is what the bag charges, with the shelf price shown beside it", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });

    const cart = await catalog.getCart(await bagFor(ids.shopper, ids.variant, 2));
    expect(cart?.items[0].unitPrice.amount).toBe("85.000");
    expect(cart?.items[0].agreedFrom?.amount).toBe("100.000");
    expect(cart?.subtotal.amount).toBe("170.000");
  });

  /* The rule that matters most: an agreed price is a ceiling, never a floor. */
  it("never charges more than the shelf once the shelf is cheaper", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });
    await db.update(productVariants).set({ price: "60.000" }).where(eq(productVariants.id, ids.variant));

    const cart = await catalog.getCart(await bagFor(ids.shopper));
    expect(cart?.items[0].unitPrice.amount).toBe("60.000");
    expect(cart?.items[0].agreedFrom).toBeNull();
  });

  /* A grant belongs to an account. An anonymous bag has no owner and no grants. */
  it("does not follow the cart to a signed-out browser", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });

    const cart = await catalog.getCart(await bagFor(null));
    expect(cart?.items[0].unitPrice.amount).toBe("100.000");
  });

  it("is not applied to somebody else's bag", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });

    const cart = await catalog.getCart(await bagFor(ids.stranger));
    expect(cart?.items[0].unitPrice.amount).toBe("100.000");
  });

  it("stops applying once it has run out", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });
    await db.update(priceOffers).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(priceOffers.id, view.id));

    const cart = await catalog.getCart(await bagFor(ids.shopper));
    expect(cart?.items[0].unitPrice.amount).toBe("100.000");
  });

  it("is frozen onto the order and spent exactly once", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });

    const placed = await orders.placeOrder(await bagFor(ids.shopper, ids.variant, 2), {
      email: "shopper@example.test", userId: ids.shopper, deliveryTotal: "0.000", addressLine: "Block 4, Salmiya",
    });
    expect(placed.lines[0].unitPrice).toBe("85.000");
    expect(placed.lines[0].lineTotal).toBe("170.000");

    const [row] = await db.select().from(priceOffers).where(eq(priceOffers.id, view.id));
    expect(row.usedOnOrderId).toBe(placed.order.id);

    // Spent. A second basket pays the shelf price.
    const second = await catalog.getCart(await bagFor(ids.shopper));
    expect(second?.items[0].unitPrice.amount).toBe("100.000");
  });

  /*
   * An agreement the shelf has undercut is not consumed: the shopper paid the
   * lower catalog price, so they never used what the seller gave them.
   */
  it("is not spent by an order that did not use it", async () => {
    const view = await ask();
    await offers.answerOffer(acmeManager(), { offerId: view.id, offeredPrice: "85.000" });
    await db.update(productVariants).set({ price: "60.000" }).where(eq(productVariants.id, ids.variant));

    const placed = await orders.placeOrder(await bagFor(ids.shopper), {
      email: "shopper@example.test", userId: ids.shopper, deliveryTotal: "0.000", addressLine: "Block 4, Salmiya",
    });
    expect(placed.lines[0].unitPrice).toBe("60.000");

    const [row] = await db.select().from(priceOffers).where(eq(priceOffers.id, view.id));
    expect(row.usedOnOrderId).toBeNull();
  });
});
