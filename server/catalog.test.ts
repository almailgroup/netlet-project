/**
 * The storefront's read side and the cart, against a real Postgres.
 *
 * The cart is where money and other people's data meet, so these tests care
 * about two things above all: that a total is exact in fils, and that holding
 * one cart's id gets you nothing from another's.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cartItems,
  carts,
  categories,
  productImages,
  products,
  productVariants,
  users,
  vendors,
} from "../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;
let catalog: typeof import("./catalog");

const ids = {
  acme: 0,
  suspended: 0,
  shopper: 0,
  lampProduct: 0,
  lampSmall: 0,
  lampLarge: 0,
  draftVariant: 0,
  hiddenVariant: 0,
  kettleVariant: 0,
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

  vi.doMock("./db", () => ({ getDb: async () => db }));
  catalog = await import("./catalog");

  const [shopper] = await db.insert(users).values({ email: "shopper@netlet.test" }).returning();
  ids.shopper = shopper.id;

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved" }).returning();
  const [suspended] = await db.insert(vendors).values({ slug: "gone", name: "Gone", status: "suspended" }).returning();
  ids.acme = acme.id; ids.suspended = suspended.id;

  const [home] = await db.insert(categories).values({ slug: "home-and-kitchen", name: "Home & Kitchen", nameAr: "المنزل والمطبخ" }).returning();
  await db.insert(categories).values({ slug: "electronics", name: "Electronics", nameAr: "إلكترونيات" });

  // Published, two variants, in a category, with an image.
  const [lamp] = await db.insert(products).values({
    vendorId: acme.id, categoryId: home.id, handle: "desk-lamp",
    title: "Desk Lamp", titleAr: "مصباح مكتب",
    description: "A lamp.", status: "published",
    attributes: [{ namespace: "reviews", key: "rating", label: "Rating", value: "4.5" }],
  }).returning();
  ids.lampProduct = lamp.id;
  const [small] = await db.insert(productVariants).values({
    productId: lamp.id, title: "Small", price: "24.375", stock: 5, options: { Size: "Small" }, position: 0,
  }).returning();
  const [large] = await db.insert(productVariants).values({
    productId: lamp.id, title: "Large", price: "31.500", stock: 0, options: { Size: "Large" }, position: 1,
  }).returning();
  ids.lampSmall = small.id; ids.lampLarge = large.id;
  await db.insert(productImages).values({ productId: lamp.id, url: "https://img/lamp.jpg", altText: null });

  // Draft: never visible to a shopper.
  const [draft] = await db.insert(products).values({
    vendorId: acme.id, handle: "secret-kettle", title: "Secret Kettle", status: "draft",
  }).returning();
  const [draftVariant] = await db.insert(productVariants).values({
    productId: draft.id, title: "Default", price: "10.000", stock: 3,
  }).returning();
  ids.draftVariant = draftVariant.id;

  // Published, but its vendor is suspended: also invisible.
  const [hidden] = await db.insert(products).values({
    vendorId: suspended.id, handle: "gone-mug", title: "Gone Mug", status: "published",
  }).returning();
  const [hiddenVariant] = await db.insert(productVariants).values({
    productId: hidden.id, title: "Default", price: "5.000", stock: 9,
  }).returning();
  ids.hiddenVariant = hiddenVariant.id;

  // A second published product, for cart totals across lines.
  const [kettle] = await db.insert(products).values({
    vendorId: acme.id, handle: "steel-kettle", title: "Steel Kettle", status: "published",
  }).returning();
  const [kettleVariant] = await db.insert(productVariants).values({
    productId: kettle.id, title: "Default", price: "12.250", stock: 4,
  }).returning();
  ids.kettleVariant = kettleVariant.id;
}, 60_000);

describe("the shelf", () => {
  it("shows published products of approved vendors, and nothing else", async () => {
    const shelf = await catalog.listProducts();
    expect(shelf.map(p => p.handle).sort()).toEqual(["desk-lamp", "steel-kettle"]);
  });

  it("hides a draft even though its variant is in stock", async () => {
    expect(await catalog.getProductByHandle("secret-kettle")).toBeNull();
  });

  it("hides a published product when its vendor is suspended", async () => {
    expect(await catalog.getProductByHandle("gone-mug")).toBeNull();
    const shelf = await catalog.listProducts();
    expect(shelf.some(p => p.handle === "gone-mug")).toBe(false);
  });

  it("carries the category through as productType and the vendor as vendor", async () => {
    const lamp = await catalog.getProductByHandle("desk-lamp");
    expect(lamp?.productType).toBe("Home & Kitchen");
    expect(lamp?.vendor).toBe("Acme");
  });

  it("answers in Arabic when asked, product and vendor alike", async () => {
    const lamp = await catalog.getProductByHandle("desk-lamp", "ar");
    expect(lamp?.title).toBe("مصباح مكتب");
    expect(lamp?.vendor).toBe("أكمي");
    /* The department stays the key the pages match on; its label is the dictionary's. */
    expect(lamp?.productType).toBe("Home & Kitchen");
  });

  it("keeps the third decimal, because the dinar has one", async () => {
    const lamp = await catalog.getProductByHandle("desk-lamp");
    expect(lamp?.variants.find(v => v.title === "Small")?.price.amount).toBe("24.375");
  });

  it("marks the out-of-stock variant unavailable without hiding the product", async () => {
    const lamp = await catalog.getProductByHandle("desk-lamp");
    expect(lamp?.variants.find(v => v.title === "Large")?.availableForSale).toBe(false);
    expect(lamp?.variants.find(v => v.title === "Small")?.availableForSale).toBe(true);
  });

  it("narrows to one department by slug", async () => {
    const shelf = await catalog.listProducts({ collectionHandle: "home-and-kitchen" });
    expect(shelf.map(p => p.handle)).toEqual(["desk-lamp"]);
  });

  it("falls back to the whole catalog for a slug nothing answers to", async () => {
    const shelf = await catalog.listProducts({ collectionHandle: "no-such-department" });
    expect(shelf.length).toBe(2);
  });

  it("lists categories as collections", async () => {
    const collections = await catalog.listCollections();
    expect(collections.map(c => c.handle).sort()).toEqual(["electronics", "home-and-kitchen"]);
  });
});

describe("the cart", () => {
  it("totals a single line exactly in fils", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 2 }]);
    // 24.375 × 2 = 48.750 — a float would give 48.75000000000001 here.
    expect(cart?.subtotal.amount).toBe("48.750");
    expect(cart?.itemCount).toBe(2);
  });

  it("totals across lines without drifting", async () => {
    const cart = await catalog.createCart([
      { variantId: String(ids.lampSmall), quantity: 3 },
      { variantId: String(ids.kettleVariant), quantity: 1 },
    ]);
    // 24.375 × 3 = 73.125, + 12.250 = 85.375
    expect(cart?.subtotal.amount).toBe("85.375");
  });

  it("adds to the existing line rather than growing a second one", async () => {
    const created = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    const after = await catalog.addCartLines(created!.id, [{ variantId: String(ids.lampSmall), quantity: 2 }]);
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0].quantity).toBe(3);
  });

  /* The stepper stops at 99; adding again used to add without limit. */
  it("stops a line at the ceiling however often it is added to", async () => {
    const created = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 90 }]);
    await catalog.addCartLines(created!.id, [{ variantId: String(ids.lampSmall), quantity: 90 }]);
    const after = await catalog.addCartLines(created!.id, [{ variantId: String(ids.lampSmall), quantity: 90 }]);
    expect(after?.items[0].quantity).toBe(99);
  });

  it("refuses a variant belonging to a draft product", async () => {
    const cart = await catalog.createCart([
      { variantId: String(ids.lampSmall), quantity: 1 },
      { variantId: String(ids.draftVariant), quantity: 1 },
    ]);
    expect(cart?.items.map(i => i.variantId)).toEqual([String(ids.lampSmall)]);
  });

  it("refuses a variant belonging to a suspended vendor", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.hiddenVariant), quantity: 1 }]);
    expect(cart?.items).toHaveLength(0);
  });

  it("carries the product's first image onto the line", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    expect(cart?.items[0].image?.url).toBe("https://img/lamp.jpg");
  });

  it("reflects a price change rather than quoting the price at the time of adding", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.kettleVariant), quantity: 1 }]);
    expect(cart?.subtotal.amount).toBe("12.250");
    await db.update(productVariants).set({ price: "13.000" }).where(eq(productVariants.id, ids.kettleVariant));
    const reread = await catalog.getCart(cart!.id);
    expect(reread?.subtotal.amount).toBe("13.000");
    await db.update(productVariants).set({ price: "12.250" }).where(eq(productVariants.id, ids.kettleVariant));
  });

  it("drops a line whose product has since been unpublished", async () => {
    const [temp] = await db.insert(products).values({
      vendorId: ids.acme, handle: "temp-fan", title: "Temp Fan", status: "published",
    }).returning();
    const [tempVariant] = await db.insert(productVariants).values({
      productId: temp.id, title: "Default", price: "8.000", stock: 2,
    }).returning();

    const cart = await catalog.createCart([{ variantId: String(tempVariant.id), quantity: 1 }]);
    expect(cart?.items).toHaveLength(1);

    await db.update(products).set({ status: "archived" }).where(eq(products.id, temp.id));
    const reread = await catalog.getCart(cart!.id);
    expect(reread?.items).toHaveLength(0);
    expect(reread?.subtotal.amount).toBe("0.000");
  });

  it("updates a quantity, and removes a line", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    const updated = await catalog.updateCartLines(cart!.id, [{ lineId: cart!.items[0].lineId, quantity: 4 }]);
    expect(updated?.items[0].quantity).toBe(4);
    const removed = await catalog.removeCartLines(cart!.id, [cart!.items[0].lineId]);
    expect(removed?.items).toHaveLength(0);
  });

  it("will not let one cart's id edit another cart's line", async () => {
    const mine = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    const theirs = await catalog.createCart([{ variantId: String(ids.kettleVariant), quantity: 1 }]);

    // The attacker holds their own cart id and guesses a line id from ours.
    await catalog.updateCartLines(theirs!.id, [{ lineId: mine!.items[0].lineId, quantity: 99 }]);
    await catalog.removeCartLines(theirs!.id, [mine!.items[0].lineId]);

    const reread = await catalog.getCart(mine!.id);
    expect(reread?.items).toHaveLength(1);
    expect(reread?.items[0].quantity).toBe(1);
  });

  it("returns null for a cart id nobody issued, rather than an empty cart", async () => {
    expect(await catalog.getCart("not-a-real-cart-id")).toBeNull();
    expect(await catalog.addCartLines("not-a-real-cart-id", [{ variantId: String(ids.lampSmall), quantity: 1 }])).toBeNull();
  });

  it("issues ids that are not guessable from another cart's", async () => {
    const a = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    const b = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    expect(a!.id).not.toBe(b!.id);
    expect(a!.id.length).toBeGreaterThanOrEqual(32);
  });

  it("checks out on NetLet, not somewhere else", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    expect(cart?.checkoutUrl).toBe("/checkout");
  });

  it("attaches a guest cart to the account that claims it, once", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }]);
    expect(await catalog.claimCart(cart!.id, ids.shopper)).toBe(ids.shopper);
    const [row] = await db.select().from(carts).where(eq(carts.id, cart!.id));
    expect(row.userId).toBe(ids.shopper);
  });

  it("leaves a bag that already belongs to an account with that account", async () => {
    const cart = await catalog.createCart([{ variantId: String(ids.lampSmall), quantity: 1 }], ids.shopper);
    expect(await catalog.claimCart(cart!.id, ids.shopper + 1000)).toBe(ids.shopper);
    expect(await catalog.claimCart("not-a-real-cart-id", ids.shopper)).toBeNull();
  });
});

/* Requirement 3.2.5: the seller's band, resolved once on the read so no page
   has to know the override rule. */
describe("the shipping band", () => {
  it("takes the store's band when the product has no opinion", async () => {
    await db.update(vendors).set({ deliverySpeed: "two_to_four" }).where(eq(vendors.id, ids.acme));
    await db.update(products).set({ deliverySpeed: null }).where(eq(products.id, ids.lampProduct));
    const product = await catalog.getProductByHandle("desk-lamp");
    expect(product?.deliverySpeed).toBe("two_to_four");
  });

  it("lets the product override it in either direction", async () => {
    await db.update(vendors).set({ deliverySpeed: "up_to_week" }).where(eq(vendors.id, ids.acme));
    await db.update(products).set({ deliverySpeed: "same_day" }).where(eq(products.id, ids.lampProduct));
    expect((await catalog.getProductByHandle("desk-lamp"))?.deliverySpeed).toBe("same_day");
  });

  /* A default band would be NetLet promising on a seller's behalf. */
  it("is null when neither has said anything", async () => {
    await db.update(vendors).set({ deliverySpeed: null }).where(eq(vendors.id, ids.acme));
    await db.update(products).set({ deliverySpeed: null }).where(eq(products.id, ids.lampProduct));
    expect((await catalog.getProductByHandle("desk-lamp"))?.deliverySpeed).toBeNull();
  });
});

/* Requirements 3.4.13 and 3.4.14: the carrier the seller named, and the size
   class that decides the vehicle. */
describe("who ships it and in what", () => {
  it("shows the carrier the store named, as they typed it", async () => {
    await db.update(vendors).set({ deliveryProvider: "  Shiplee  " }).where(eq(vendors.id, ids.acme));
    expect((await catalog.getProductByHandle("desk-lamp"))?.deliveryProvider).toBe("Shiplee");
  });

  /* A blank is nobody, not an empty name a page would then render. */
  it("is null when the store named nobody", async () => {
    await db.update(vendors).set({ deliveryProvider: "   " }).where(eq(vendors.id, ids.acme));
    expect((await catalog.getProductByHandle("desk-lamp"))?.deliveryProvider).toBeNull();
    await db.update(vendors).set({ deliveryProvider: null }).where(eq(vendors.id, ids.acme));
    expect((await catalog.getProductByHandle("desk-lamp"))?.deliveryProvider).toBeNull();
  });

});

/* Requirement 3.1.17: the basket somebody forgot, resolved on the read. */
describe("a forgotten basket", () => {
  it("says nothing while they are probably still shopping", async () => {
    const [cart] = await db.insert(carts).values({ id: "recovery-fresh" }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.lampSmall, quantity: 1 });
    expect((await catalog.getCart(cart.id))?.recovery).toEqual({ remind: false });
  });

  it("says so once the basket is old enough", async () => {
    const [cart] = await db.insert(carts).values({ id: "recovery-old" }).returning();
    await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.lampSmall, quantity: 2 });
    /* Set after the insert: `updatedAt` has an `$onUpdate`, so writing the
       items first and the date second is the only order that sticks. */
    await db.update(carts).set({ updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }).where(eq(carts.id, cart.id));

    const recovery = (await catalog.getCart(cart.id))?.recovery;
    expect(recovery).toMatchObject({ remind: true, itemCount: 2 });
  });

  it("says nothing about an empty basket, which is empty rather than forgotten", async () => {
    const [cart] = await db.insert(carts).values({ id: "recovery-empty" }).returning();
    await db.update(carts).set({ updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }).where(eq(carts.id, cart.id));
    expect((await catalog.getCart(cart.id))?.recovery).toEqual({ remind: false });
  });
});

describe("which departments have something on sale", () => {
  it("counts published products of approved stores, and leaves out drafts and suspended stores", async () => {
    const inventory = await import("./inventory");
    const [electronics] = await db.select().from(categories).where(eq(categories.slug, "electronics"));
    /* Two products in Electronics that a shopper cannot see: a draft, and a
       published one from the suspended store. Neither may light the link. */
    await db.insert(products).values([
      { vendorId: ids.acme, categoryId: electronics.id, handle: "draft-radio", title: "Draft radio", status: "draft" },
      { vendorId: ids.suspended, categoryId: electronics.id, handle: "gone-radio", title: "Gone radio", status: "published" },
    ]);
    const counts = await inventory.publishedDepartmentCounts();
    expect(counts).toEqual({ "home-and-kitchen": 1 });
  });
});
