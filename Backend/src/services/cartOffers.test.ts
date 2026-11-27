/**
 * A store told when its product goes in a cart, and a price it sends to that
 * cart, against a real Postgres (on the owner's word, migration 0094).
 *
 * What is held here: one notice per cart and product, never a guest's cart
 * or a store's own people; the store's list names nobody; a price sent is the
 * cart's agreed price, said as the store's; every refusal; a price that ran
 * out frees the slot (which, for a shopper's own request, it never did); and
 * before 0094 is pasted the shop goes on working with the door closed.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, getTableColumns } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItems, carts, customerNotificationPreferences, notifications, priceOffers, products, productVariants, users, vendorMembers, vendors,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let client: PGlite;
let cartOffers: typeof import("./cartOffers.js");
let offers: typeof import("./offers.js");
let catalog: typeof import("./catalog.js");
let starts: typeof import("./offerStarts.js");

const ids = { acmeOwner: 0, acmeHelper: 0, otherOwner: 0, shopper: 0, admin: 0, acme: 0, other: 0, sofa: 0, sofaVariant: 0, lampVariant: 0 };

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
  cartOffers = await import("./cartOffers.js");
  offers = await import("./offers.js");
  catalog = await import("./catalog.js");
  starts = await import("./offerStarts.js");

  const [acmeOwner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [acmeHelper] = await db.insert(users).values({ email: "helper@acme.test" }).returning();
  const [otherOwner] = await db.insert(users).values({ email: "owner@other.test" }).returning();
  const [shopper] = await db.insert(users).values({ email: "noura@example.test", name: "Noura Al-Sabah" }).returning();
  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: acmeOwner.id, role: "owner" },
    { vendorId: acme.id, userId: acmeHelper.id, role: "staff" },
    { vendorId: other.id, userId: otherOwner.id, role: "owner" },
  ]);
  const [sofa] = await db.insert(products).values({ vendorId: acme.id, handle: "sofa", title: "Velvet Sofa", titleAr: "كنبة مخملية", status: "published" }).returning();
  const [lamp] = await db.insert(products).values({ vendorId: other.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [sofaVariant] = await db.insert(productVariants).values({ productId: sofa.id, title: "Default", sku: "SOFA-1", price: "100.000", stock: 20 }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Default", sku: "LAMP-1", price: "30.000", stock: 5 }).returning();
  Object.assign(ids, {
    acmeOwner: acmeOwner.id, acmeHelper: acmeHelper.id, otherOwner: otherOwner.id, shopper: shopper.id, admin: admin.id,
    acme: acme.id, other: other.id, sofa: sofa.id, sofaVariant: sofaVariant.id, lampVariant: lampVariant.id,
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(priceOffers);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(customerNotificationPreferences);
});

const acmeManager = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "manager" });
const otherStore = (): Actor => ({ kind: "vendor", userId: ids.otherOwner, vendorId: ids.other, role: "owner" });

const noticesOf = (userId: number, kind: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)));

const sofaLine = async (cartId: string) => {
  const [line] = await db.select({ id: cartItems.id }).from(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, ids.sofaVariant)));
  return line!.id;
};

describe("a store is told when its product goes in a cart", () => {
  it("tells every member once per cart and product, naming nobody", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    await catalog.addCartLines(cart!.id, [{ variantId: String(ids.sofaVariant), quantity: 1 }]);
    for (const member of [ids.acmeOwner, ids.acmeHelper]) {
      const told = await noticesOf(member, "seller_cart_add");
      expect(told).toHaveLength(1);
      expect(told[0]!.params).toEqual({ product: "Velvet Sofa", productAr: "كنبة مخملية" });
      expect(told[0]!.link).toBe("/admin/offers?view=carts");
      /* The cart's id is the bag's only key: never written into another table. */
      expect(told[0]!.dedupeKey).not.toContain(cart!.id);
      expect(JSON.stringify(told[0])).not.toContain("Noura");
    }
    /* The other store sold nothing to this cart. */
    expect(await noticesOf(ids.otherOwner, "seller_cart_add")).toHaveLength(0);

    /* Another cart is another notice. */
    const second = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 2 }], ids.admin);
    expect(second).not.toBeNull();
    expect(await noticesOf(ids.acmeOwner, "seller_cart_add")).toHaveLength(2);
  });

  it("tells nobody about a guest's cart or a store's own people trying their product", async () => {
    await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], null);
    await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.acmeHelper);
    expect(await noticesOf(ids.acmeOwner, "seller_cart_add")).toHaveLength(0);
  });
});

describe("the store's list of its products in carts", () => {
  it("shows its own products in signed-in carts and nothing about who", async () => {
    await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 3 }, { variantId: String(ids.lampVariant), quantity: 1 }], ids.shopper);
    await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], null);
    await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.acmeHelper);
    const page = await cartOffers.listCartInterest(acmeManager());
    expect(page.ready).toBe(true);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ productTitle: "Velvet Sofa", quantity: 3, listPrice: "100.000", offer: null, action: "send" });
    const said = JSON.stringify(page);
    expect(said).not.toContain("noura");
    expect(said).not.toContain(String(ids.shopper) + ",");
    expect(Object.keys(page.rows[0]!)).not.toContain("userId");
    /* The other store sees its lamp, and not the sofa. */
    const lamp = await cartOffers.listCartInterest(otherStore());
    expect(lamp.rows.map(row => row.productTitle)).toEqual(["Lamp"]);
    expect(await cartOffers.countCartInterest(acmeManager())).toBe(1);
  });

  it("leaves out a line older than the window", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    await db.update(cartItems).set({ createdAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(cartItems.cartId, cart!.id));
    expect((await cartOffers.listCartInterest(acmeManager())).total).toBe(0);
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(cart!.id), price: "80.000" })).rejects.toMatchObject({ refusal: "LINE_GONE" });
  });
});

describe("a price sent to a cart", () => {
  it("is the cart's agreed price, said as the store's, and the shopper may hear of it", async () => {
    await db.insert(customerNotificationPreferences).values({ userId: ids.shopper, kind: "bag_reminder", enabled: true });
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    const sent = await cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(cart!.id), price: "85.000", actorUserId: ids.acmeOwner });
    expect(sent.offerId).toBeGreaterThan(0);

    const bag = await catalog.getCart(cart!.id);
    const line = bag!.items.find(item => item.variantId === String(ids.sofaVariant))!;
    expect(line.unitPrice.amount).toBe("85.000");
    expect(line.priceReason).toBe("agreed");
    expect(line.agreedByStore).toBe(true);

    const told = await noticesOf(ids.shopper, "offer_from_store");
    expect(told).toHaveLength(1);
    expect(told[0]!.params).toMatchObject({ product: "Velvet Sofa", store: "Acme", price: "85.000" });
    expect(told[0]!.link).toBe("/cart");

    /* The shopper's own list says whose it is; the store's says it sent it. */
    const mine = await offers.listOffersForShopper(ids.shopper);
    expect(mine[0]).toMatchObject({ state: "offered", startedBy: "store", offeredPrice: "85.000" });
    const list = await cartOffers.listCartInterest(acmeManager());
    expect(list.rows[0]).toMatchObject({ action: "held", offer: { state: "offered", startedBy: "store", price: "85.000" } });
  });

  it("is not told while the shopper's Personalised offers are off, and still applies", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    await cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(cart!.id), price: "85.000" });
    expect(await noticesOf(ids.shopper, "offer_from_store")).toHaveLength(0);
    const bag = await catalog.getCart(cart!.id);
    expect(bag!.items[0]!.unitPrice.amount).toBe("85.000");
  });

  it("refuses another store, a price at or above the shelf, a guest's cart and a second price", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    const lineId = await sofaLine(cart!.id);
    await expect(cartOffers.sendCartOffer(otherStore(), { lineId, price: "80.000" })).rejects.toThrow(/FORBIDDEN/);
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId, price: "100.000" })).rejects.toMatchObject({ refusal: "STORE_PRICE_OUT_OF_RANGE" });
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId, price: "0.000" })).rejects.toMatchObject({ refusal: "STORE_PRICE_OUT_OF_RANGE" });
    const guest = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], null);
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(guest!.id), price: "80.000" })).rejects.toMatchObject({ refusal: "LINE_GONE" });

    await cartOffers.sendCartOffer(acmeManager(), { lineId, price: "90.000" });
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId, price: "80.000" })).rejects.toMatchObject({ refusal: "ALREADY_OPEN" });
  });

  it("sends a shopper who is waiting on their own request to Price requests", async () => {
    await db.update(vendors).set({ acceptsOffers: true }).where(eq(vendors.id, ids.acme));
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    await offers.requestOffer({ userId: ids.shopper, variantId: ids.sofaVariant, askedPrice: "70.000", quantity: 1 });
    expect((await cartOffers.listCartInterest(acmeManager())).rows[0]!.action).toBe("answer");
    await expect(cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(cart!.id), price: "80.000" })).rejects.toMatchObject({ refusal: "ASKED_OPEN" });
    await db.update(vendors).set({ acceptsOffers: false }).where(eq(vendors.id, ids.acme));
  });
});

describe("a price that ran out frees the slot", () => {
  it("lets the store send another once its price has lapsed", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
    const lineId = await sofaLine(cart!.id);
    await cartOffers.sendCartOffer(acmeManager(), { lineId, price: "90.000" });
    await db.update(priceOffers).set({ expiresAt: new Date(Date.now() - 60_000) });
    expect((await cartOffers.listCartInterest(acmeManager())).rows[0]!.action).toBe("send");
    await cartOffers.sendCartOffer(acmeManager(), { lineId, price: "88.000" });
    const rows = await db.select({ status: priceOffers.status }).from(priceOffers).orderBy(priceOffers.id);
    expect(rows.map(row => row.status)).toEqual(["expired", "offered"]);
  });

  /* It never did for a shopper: an answered price past its three days held
     the open-price index, and asking again was "already open" for good. */
  it("lets a shopper ask again once an answered price has run out", async () => {
    await db.update(vendors).set({ acceptsOffers: true }).where(eq(vendors.id, ids.acme));
    const first = await offers.requestOffer({ userId: ids.shopper, variantId: ids.sofaVariant, askedPrice: "70.000", quantity: 1 });
    await offers.answerOffer(acmeManager(), { offerId: first.id, offeredPrice: "80.000" });
    await db.update(priceOffers).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(priceOffers.id, first.id));
    const again = await offers.requestOffer({ userId: ids.shopper, variantId: ids.sofaVariant, askedPrice: "75.000", quantity: 1 });
    expect(again.state).toBe("pending");
    expect((await offers.listOffersForShopper(ids.shopper)).map(offer => offer.state)).toEqual(["pending", "expired"]);
    await db.update(vendors).set({ acceptsOffers: false }).where(eq(vendors.id, ids.acme));
  });
});

describe("before 0094 is pasted", () => {
  it("keeps the shop working and the door closed", async () => {
    await client.exec(`alter table price_offers drop column started_by`);
    starts.forgetOfferStarts();
    try {
      await db.update(vendors).set({ acceptsOffers: true }).where(eq(vendors.id, ids.acme));
      const cart = await catalog.createCart([{ variantId: String(ids.sofaVariant), quantity: 1 }], ids.shopper);
      /* A shopper's own request, its answer and the bag all still work. */
      const asked = await offers.requestOffer({ userId: ids.shopper, variantId: ids.sofaVariant, askedPrice: "70.000", quantity: 1 });
      expect(asked.startedBy).toBe("shopper");
      await offers.answerOffer(acmeManager(), { offerId: asked.id, offeredPrice: "80.000" });
      expect((await offers.listOffersForShopper(ids.shopper))[0]).toMatchObject({ state: "offered", startedBy: "shopper" });
      expect((await offers.listOffersForVendor(acmeManager())).rows).toHaveLength(1);
      const bag = await catalog.getCart(cart!.id);
      expect(bag!.items[0]).toMatchObject({ priceReason: "agreed", agreedByStore: false });
      /* The store's list says so, and sending refuses. */
      expect((await cartOffers.listCartInterest(acmeManager())).ready).toBe(false);
      await db.delete(priceOffers);
      await expect(cartOffers.sendCartOffer(acmeManager(), { lineId: await sofaLine(cart!.id), price: "85.000" })).rejects.toMatchObject({ refusal: "CLOSED" });
      /* And the store is still told of the cart. */
      expect(await noticesOf(ids.acmeOwner, "seller_cart_add")).toHaveLength(1);
    } finally {
      await client.exec(`alter table price_offers add column started_by varchar(8) default 'shopper' not null`);
      starts.forgetOfferStarts();
      await db.update(vendors).set({ acceptsOffers: false }).where(eq(vendors.id, ids.acme));
    }
  });

  /* The table a shopper's request is written through until 0094 is pasted
     must be the real one less the new column, or a column added later would
     be left out of every request. */
  it("knows the table before 0094 column for column", () => {
    const names = (table: Parameters<typeof getTableColumns>[0]) => Object.values(getTableColumns(table)).map(column => column.name).sort();
    expect(names(starts.priceOffersBefore0094)).toEqual(names(priceOffers).filter(name => name !== "started_by"));
  });
});
