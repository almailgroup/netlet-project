/**
 * Rating a delivery (3.4.4) and claiming for damage (3.4.2), through the API
 * against a real Postgres.
 *
 * The windows and the arithmetic are proved pure in `Shared/commerce/`. What
 * needs a database is who may do what to whose parcel — and that is a rule
 * about *who is asking*, so every call here goes through the router as the
 * person it is about, the way the adoption bug taught this codebase to test.
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
  courierMembers,
  couriers,
  damageClaims,
  deliveryRatings,
  orderItems,
  orders,
  productVariants,
  products,
  users,
  vendorMembers,
  vendors,
  type User,
} from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";

let db: ReturnType<typeof drizzle>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appRouter: any;
let ordersModule: typeof import("./orders.js");

type Who = "shopper" | "stranger" | "admin" | "driver" | "rivalDriver" | "seller" | "rivalSeller";
const people = {} as Record<Who, User>;
const ids = { acme: 0, beta: 0, sofaVariant: 0, riceVariant: 0, mugVariant: 0, swift: 0, rival: 0 };

const contextFor = (user: User | null): TrpcContext => ({
  user,
  req: { protocol: "https", headers: {}, ip: "10.0.0.1" } as TrpcContext["req"],
  res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
});
const as = (who: Who) => appRouter.createCaller(contextFor(people[who]));

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
  appRouter = (await import("../routes/index.js")).appRouter;
  ordersModule = await import("./orders.js");

  for (const [who, extra] of [
    ["shopper", {}], ["stranger", {}], ["admin", { role: "admin" }], ["driver", {}],
    ["rivalDriver", {}], ["seller", {}], ["rivalSeller", {}],
  ] as const) {
    const [row] = await db.insert(users).values({ email: `${who.toLowerCase()}@netlet.test`, name: who, ...extra }).returning();
    people[who] = row;
  }

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta", status: "approved" }).returning();
  ids.acme = acme.id; ids.beta = beta.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: people.seller.id, role: "staff" },
    { vendorId: beta.id, userId: people.rivalSeller.id, role: "owner" },
  ]);

  const product = async (vendorId: number, handle: string, price: string) => {
    const [row] = await db.insert(products).values({ vendorId, handle, title: handle, status: "published" }).returning();
    const [variant] = await db.insert(productVariants).values({ productId: row.id, title: "Default", sku: handle, price, stock: 500 }).returning();
    return variant.id;
  };
  ids.sofaVariant = await product(acme.id, "sofa", "240.000");
  ids.riceVariant = await product(acme.id, "rice", "1.500");
  ids.mugVariant = await product(beta.id, "mug", "4.000");
}, 60_000);

beforeEach(async () => {
  await db.delete(damageClaims);
  await db.delete(deliveryRatings);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(carts);
  await db.delete(courierMembers);
  await db.delete(couriers);
  const [swift] = await db.insert(couriers).values({ name: "Swift Delivery" }).returning();
  const [rival] = await db.insert(couriers).values({ name: "Rival Logistics" }).returning();
  ids.swift = swift.id; ids.rival = rival.id;
  await db.insert(courierMembers).values([
    { courierId: swift.id, userId: people.driver.id },
    { courierId: rival.id, userId: people.rivalDriver.id },
  ]);
});

/** An order of Acme's sofa and rice plus Beta's mug: two parcels, two sellers. */
async function placed() {
  const [cart] = await db.insert(carts).values({ id: `cart-${Math.random().toString(36).slice(2)}`, userId: people.shopper.id }).returning();
  await db.insert(cartItems).values([
    { cartId: cart.id, variantId: ids.sofaVariant, quantity: 1 },
    { cartId: cart.id, variantId: ids.riceVariant, quantity: 2 },
    { cartId: cart.id, variantId: ids.mugVariant, quantity: 1 },
  ]);
  const result = await ordersModule.placeOrder(cart.id, {
    email: people.shopper.email, userId: people.shopper.id, contactName: "A Shopper",
    contactPhone: "+96550000000", deliveryZoneId: "hawalli", addressLine: "Block 4, Street 12",
  });
  await db.update(orderItems).set({ fulfilment: "preparing" }).where(eq(orderItems.orderId, result.order.id));
  return result.order;
}

/** Acme's parcel, handed to Swift and carried as far as `to`. */
async function carried(to: "shipped" | "delivered" = "delivered") {
  const order = await placed();
  const board = await as("admin").dispatch.board({});
  const acmeParcel = board.parcels.find((parcel: { vendorId: number }) => parcel.vendorId === ids.acme);
  await as("admin").dispatch.assign({ orderId: order.id, key: acmeParcel.key, courierId: ids.swift });
  await as("driver").dispatch.move({ orderId: order.id, key: acmeParcel.key, to: "shipped" });
  if (to === "delivered") await as("driver").dispatch.move({ orderId: order.id, key: acmeParcel.key, to: "delivered" });
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return {
    order,
    key: acmeParcel.key as string,
    sofa: lines.find(line => line.productTitle === "sofa")!,
    rice: lines.find(line => line.productTitle === "rice")!,
    mug: lines.find(line => line.productTitle === "mug")!,
  };
}

const parcelsOf = async (reference: string) => (await as("shopper").orders.get({ reference })).parcels;

describe("rating a delivery", () => {
  it("is offered on the order once the parcel has arrived, and not before", async () => {
    const { order, key } = await carried("shipped");
    const before = (await parcelsOf(order.reference)).find((parcel: { key: string }) => parcel.key === key);
    expect(before.ratingState).toEqual({ allowed: false, reason: "delivery.notArrived" });
    await expect(as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 5 }))
      .rejects.toMatchObject({ message: "delivery.notArrived" });

    await as("driver").dispatch.move({ orderId: order.id, key, to: "delivered" });
    const after = (await parcelsOf(order.reference)).find((parcel: { key: string }) => parcel.key === key);
    expect(after.ratingState.allowed).toBe(true);
  });

  it("is one rating per parcel that changes, frozen against the company that carried it", async () => {
    const { order, key } = await carried();
    await as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 2, comment: " late \n and rude " });
    await as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 4, comment: "fine, on reflection" });

    const rows = await db.select().from(deliveryRatings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 4, comment: "fine, on reflection", courierId: ids.swift, vendorId: ids.acme });
    const mine = (await parcelsOf(order.reference)).find((parcel: { key: string }) => parcel.key === key);
    expect(mine.rating).toEqual({ rating: 4, comment: "fine, on reflection" });
  });

  /* Not "not yours": an answer that differs would confirm the order exists. */
  it("does not find another shopper's order", async () => {
    const { order, key } = await carried();
    await expect(as("stranger").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 1 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as("stranger").orders.claimDamage({ reference: order.reference, lineIds: [1], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* Whoever sent the sofa back may be exactly who saw how it was handed over. */
  it("still counts a parcel whose line was returned afterwards", async () => {
    const { order, key, sofa } = await carried();
    await db.update(orderItems).set({ fulfilment: "returned" }).where(eq(orderItems.id, sofa.id));
    await as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 3 });
    expect(await db.select().from(deliveryRatings)).toHaveLength(1);
  });

  it("refuses a rating outside one to five whole stars", async () => {
    const { order, key } = await carried();
    for (const rating of [0, 6, 2.5]) {
      await expect(as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating }))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("closes after the window", async () => {
    const { order, key } = await carried();
    await db.update(orderItems).set({ deliveredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) }).where(eq(orderItems.orderId, order.id));
    await expect(as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 5 }))
      .rejects.toMatchObject({ message: "delivery.ratingClosed" });
  });
});

describe("the score", () => {
  it("shows a company its own score and comments, without the shopper's identity, and nothing of a rival's", async () => {
    const { order, key } = await carried();
    await as("shopper").orders.rateDelivery({ reference: order.reference, parcelKey: key, rating: 5, comment: "careful with the sofa" });

    const own = await as("driver").dispatch.scores();
    expect(own.scores).toEqual([expect.objectContaining({ courierId: ids.swift, courierName: "Swift Delivery", count: 1, average: 5 })]);
    expect(own.recent[0].comment).toBe("careful with the sofa");
    expect(JSON.stringify(own)).not.toContain(people.shopper.email);

    const rival = await as("rivalDriver").dispatch.scores();
    expect(rival).toEqual({ scores: [], recent: [] });

    const admin = await as("admin").dispatch.scores();
    expect(admin.scores).toHaveLength(1);
  });

  it("is not something a seller or a shopper can read", async () => {
    await expect(as("seller").dispatch.scores()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").dispatch.scores()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("claiming for damage", () => {
  it("lets the shopper claim for damaged lines, capped by what they were sold for", async () => {
    const { order, sofa } = await carried();
    await expect(as("shopper").orders.claimDamage({
      reference: order.reference, lineIds: [sofa.id], amount: "240.001", description: "leg snapped",
    })).rejects.toMatchObject({ message: "claims.overValue" });

    await as("shopper").orders.claimDamage({
      reference: order.reference, lineIds: [sofa.id], amount: "240.000", description: "leg snapped",
      evidenceUrl: "https://photos.example/leg.jpg",
    });
    const [claim] = await db.select().from(damageClaims);
    expect(claim).toMatchObject({ courierId: ids.swift, vendorId: ids.acme, filedAs: "shopper", status: "open", claimedAmount: "240.000" });

    const parcel = (await parcelsOf(order.reference)).find((one: { vendorName: string }) => one.vendorName === "Acme");
    expect(parcel.claim).toMatchObject({ status: "open" });
    expect(parcel.claimRefusal).toBe("claims.alreadyOpen");
  });

  /* Two tabs, or the shopper and the seller at once. */
  it("allows one open claim per parcel, enforced by the database", async () => {
    const { order, sofa, rice } = await carried();
    const file = (lineIds: number[]) => as("shopper").orders.claimDamage({
      reference: order.reference, lineIds, amount: "1.000", description: "dented",
    });
    const results = await Promise.allSettled([file([sofa.id]), file([rice.id])]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { message: "claims.alreadyOpen" } });
  });

  it("refuses a parcel the seller carried themselves, and lines from two parcels in one claim", async () => {
    const { order, sofa, mug } = await carried();
    await db.update(orderItems).set({ fulfilment: "delivered", deliveredAt: new Date() }).where(eq(orderItems.id, mug.id));
    await expect(as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [mug.id], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ message: "claims.noCourier" });
    await expect(as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [sofa.id, mug.id], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ message: "claims.notInParcel" });
  });

  it("refuses a link that is not https, and a claim with nothing said", async () => {
    const { order, sofa } = await carried();
    await expect(as("shopper").orders.claimDamage({
      reference: order.reference, lineIds: [sofa.id], amount: "1.000", description: "x", evidenceUrl: "http://photos.example/a.jpg",
    })).rejects.toMatchObject({ message: "claims.badEvidence" });
    await expect(as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [sofa.id], amount: "1.000", description: "   " }))
      .rejects.toMatchObject({ message: "claims.needsDescription" });
  });

  /* The van was in an accident: the seller hears first. */
  it("lets a seller claim on their own goods while still out, and not on another seller's", async () => {
    const { order, sofa, mug } = await carried("shipped");
    await as("seller").dispatch.claims.file({ orderId: order.id, lineIds: [sofa.id], amount: "100.000", description: "van accident" });
    const [claim] = await db.select().from(damageClaims);
    expect(claim.filedAs).toBe("seller");

    await expect(as("rivalSeller").dispatch.claims.file({ orderId: order.id, lineIds: [sofa.id], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("seller").dispatch.claims.file({ orderId: order.id, lineIds: [mug.id], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("shopper").dispatch.claims.file({ orderId: order.id, lineIds: [sofa.id], amount: "1.000", description: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("answering and deciding a claim", () => {
  async function opened() {
    const parcel = await carried();
    await as("shopper").orders.claimDamage({
      reference: parcel.order.reference, lineIds: [parcel.sofa.id], amount: "240.000", description: "leg snapped",
    });
    const [claim] = await db.select().from(damageClaims);
    return { ...parcel, claimId: claim.id };
  }

  it("shows each party only its own claims", async () => {
    await opened();
    expect(await as("driver").dispatch.claims.list()).toHaveLength(1);
    expect(await as("rivalDriver").dispatch.claims.list()).toHaveLength(0);
    expect(await as("seller").dispatch.claims.list()).toHaveLength(1);
    expect(await as("rivalSeller").dispatch.claims.list()).toHaveLength(0);
    const [row] = await as("admin").dispatch.claims.list();
    expect(row.lines).toEqual([expect.objectContaining({ productTitle: "sofa", lineTotal: "240.000" })]);
    await expect(as("shopper").dispatch.claims.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the company that carried it answer, and nobody else", async () => {
    const { claimId } = await opened();
    await expect(as("rivalDriver").dispatch.claims.respond({ claimId, response: "not us" }))
      .rejects.toMatchObject({ message: "claims.notOpen" });
    await expect(as("seller").dispatch.claims.respond({ claimId, response: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await as("driver").dispatch.claims.respond({ claimId, response: "It was packed without corners." });
    const [claim] = await db.select().from(damageClaims);
    expect(claim.courierResponse).toBe("It was packed without corners.");
  });

  it("is decided by NetLet alone, once, for at most what was claimed — and recorded", async () => {
    const { claimId } = await opened();
    await expect(as("driver").dispatch.claims.decide({ claimId, outcome: "rejected" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("seller").dispatch.claims.decide({ claimId, outcome: "accepted" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("admin").dispatch.claims.decide({ claimId, outcome: "accepted", awardedAmount: "300.000" }))
      .rejects.toMatchObject({ message: "claims.overValue" });

    /* A scratched leg is not a whole sofa. */
    await as("admin").dispatch.claims.decide({ claimId, outcome: "accepted", awardedAmount: "60.000", note: "one leg" });
    await expect(as("admin").dispatch.claims.decide({ claimId, outcome: "rejected" })).rejects.toMatchObject({ message: "claims.notOpen" });
    await expect(as("driver").dispatch.claims.respond({ claimId, response: "late" })).rejects.toMatchObject({ message: "claims.notOpen" });

    const ledger = await as("driver").dispatch.claims.ledger();
    expect(ledger).toEqual([expect.objectContaining({ courierId: ids.swift, owed: "60.000", accepted: 1, open: 0 })]);
    expect(await as("rivalDriver").dispatch.claims.ledger()).toEqual([]);

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "delivery.decideClaim"));
    expect(entry).toMatchObject({ subjectType: "claim", subjectId: claimId, actorId: people.admin.id });
  });

  /* Found on the shopper's page after an award: "Report damage" was still on
     offer, so the same cushion could be compensated twice. */
  it("does not let a line be claimed again once a claim on it was paid, but does after a rejection", async () => {
    const { claimId, order, sofa, rice } = await opened();
    await as("admin").dispatch.claims.decide({ claimId, outcome: "accepted" });

    await expect(as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [sofa.id], amount: "1.000", description: "again" }))
      .rejects.toMatchObject({ message: "claims.alreadyPaid" });
    await expect(as("seller").dispatch.claims.file({ orderId: order.id, lineIds: [sofa.id], amount: "1.000", description: "again" }))
      .rejects.toMatchObject({ message: "claims.alreadyPaid" });
    const parcel = (await parcelsOf(order.reference)).find((one: { vendorName: string }) => one.vendorName === "Acme");
    expect(parcel.lines.map((line: { lineId: number }) => line.lineId)).toEqual([rice.id]);

    /* The rice was never part of it, and a rejection is answered with new evidence. */
    await as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [rice.id], amount: "1.000", description: "bag split" });
    const [riceClaim] = await db.select().from(damageClaims).where(eq(damageClaims.status, "open"));
    await as("admin").dispatch.claims.decide({ claimId: riceClaim.id, outcome: "rejected" });
    await as("shopper").orders.claimDamage({ reference: order.reference, lineIds: [rice.id], amount: "1.000", description: "here is a photo", evidenceUrl: "https://photos.example/rice.jpg" });

    const after = (await parcelsOf(order.reference)).find((one: { vendorName: string }) => one.vendorName === "Acme");
    expect(after.claimRefusal).toBe("claims.alreadyOpen");
  });

  /* Two administrators pressing at once cannot both be told they decided. */
  it("cannot be decided twice by two people at once", async () => {
    const { claimId } = await opened();
    const results = await Promise.allSettled([
      as("admin").dispatch.claims.decide({ claimId, outcome: "accepted" }),
      as("admin").dispatch.claims.decide({ claimId, outcome: "rejected" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });

  it("counts what is waiting on each party: every open claim for NetLet, the unanswered ones for the company", async () => {
    const { claimId } = await opened();
    expect(await as("admin").dispatch.claims.openCount()).toBe(1);
    expect(await as("driver").dispatch.claims.openCount()).toBe(1);
    expect(await as("rivalDriver").dispatch.claims.openCount()).toBe(0);
    expect(await as("seller").dispatch.claims.openCount()).toBe(0);

    await as("driver").dispatch.claims.respond({ claimId, response: "Handed over intact; signed for." });
    expect(await as("driver").dispatch.claims.openCount()).toBe(0);
    expect(await as("admin").dispatch.claims.openCount()).toBe(1);
  });
});
