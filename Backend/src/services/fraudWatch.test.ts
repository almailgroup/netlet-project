/**
 * The fraud page's two reads (3.6.5), against real Postgres (PGlite): reviews
 * judged for fakes, referrals for one person inviting themselves. The
 * judgements are proved pure in `Shared/commerce/fraudSignals.test.ts`; this
 * is the counting — whose store, whose door, whose phone — and the guard.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cartItems, carts, orderItems, orders, productVariants, products, referrals, reviews, users, vendorMembers, vendors, type User } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let fraud: typeof import("./fraud.js");
let ordersModule: typeof import("./orders.js");
const admin: Actor = { kind: "admin", userId: 1 };
const people: Record<string, User> = {};
const ids = { vendor: 0, variant: 0, product: 0 };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  fraud = await import("./fraud.js");
  ordersModule = await import("./orders.js");

  for (const who of ["owner", "noura", "fahad", "sister"]) {
    const [row] = await db.insert(users).values({ email: `${who}@example.com`, name: who }).returning();
    people[who] = row;
  }
  const [store] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  ids.vendor = store.id;
  await db.insert(vendorMembers).values({ vendorId: store.id, userId: people.owner.id, role: "owner" });
  const [product] = await db.insert(products).values({ vendorId: store.id, handle: "lamp", title: "Lamp", status: "published" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: product.id, title: "Default", sku: "LAMP", price: "20.000", stock: 50 }).returning();
  ids.product = product.id;
  ids.variant = variant.id;
}, 60_000);

/** A delivered lamp for somebody, to an address and a phone, and its line. */
async function deliveredTo(who: string, addressLine: string, phone: string) {
  const [cart] = await db.insert(carts).values({ id: `cart-${who}-${Math.random().toString(36).slice(2)}`, userId: people[who].id }).returning();
  await db.insert(cartItems).values({ cartId: cart.id, variantId: ids.variant, quantity: 1 });
  const placed = await ordersModule.placeOrder(cart.id, {
    email: people[who].email, userId: people[who].id, contactName: who,
    contactPhone: phone, deliveryZoneId: "hawalli", addressLine, paymentMethod: "cod",
  });
  await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.orderId, placed.order.id));
  const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.order.id));
  return { orderId: placed.order.id, lineId: line.id };
}

describe("the review watch", () => {
  it("flags the store's own people and reviewers who share a door, and is an administrator's alone", async () => {
    const own = await deliveredTo("owner", "Block 1, Street 2, House 3", "+96550000001");
    const noura = await deliveredTo("noura", "Block 4, Street 5, House 6", "+96550000002");
    const sister = await deliveredTo("sister", "block 4 street 5 house 6", "+96550000003");
    const fahad = await deliveredTo("fahad", "Block 9, Street 9, House 9", "+96550000004");
    for (const [who, line] of [["owner", own], ["noura", noura], ["sister", sister], ["fahad", fahad]] as const) {
      await db.insert(reviews).values({ orderItemId: line.lineId, userId: people[who].id, productId: ids.product, vendorId: ids.vendor, productTitle: "Lamp", rating: who === "fahad" ? 4 : 5 });
    }

    const watched = await fraud.reviewWatch(admin);
    const signalsOf = (who: string) => watched.find(row => row.reviewerEmail === `${who}@example.com`)!.flags.map(flag => flag.signal);
    expect(signalsOf("owner")).toContain("reviewerIsSeller");
    /* One door, typed two ways. */
    expect(signalsOf("noura")).toContain("reviewersShareAddress");
    expect(signalsOf("sister")).toContain("reviewersShareAddress");
    expect(signalsOf("fahad")).not.toContain("reviewersShareAddress");
    expect(watched.find(row => row.reviewerEmail === "owner@example.com")!.risk).toBe("high");

    await expect(fraud.reviewWatch({ kind: "vendor", userId: people.owner.id, vendorId: ids.vendor, role: "owner" })).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("the referral watch", () => {
  it("flags a referral between two accounts on one phone, and leaves a stranger's alone", async () => {
    await deliveredTo("noura", "Block 4, Street 5, House 6", "+965 5000 0002");
    await deliveredTo("fahad", "Block 9, Street 9, House 9", "+96550000004");
    /* The same phone as Noura's, written differently. */
    const sister = await deliveredTo("sister", "Elsewhere", "50000002");
    await db.insert(referrals).values([
      { referrerId: people.noura.id, referredId: people.sister.id, qualifiedOrderId: sister.orderId, qualifiedAt: new Date() },
      { referrerId: people.noura.id, referredId: people.fahad.id },
    ]);
    await db.update(orders).set({ status: "refunded" }).where(eq(orders.id, sister.orderId));

    const watched = await fraud.referralWatch(admin);
    const sisterRow = watched.find(row => row.referredEmail === "sister@example.com")!;
    /* The review case above sent her a lamp at Noura's door, too. */
    expect(sisterRow.flags.map(flag => flag.signal)).toEqual(["sharedAddress", "sharedPhone", "qualifyingRefunded"]);
    expect(sisterRow.risk).toBe("high");
    expect(watched.find(row => row.referredEmail === "fahad@example.com")!.flags).toEqual([]);
  });
});
