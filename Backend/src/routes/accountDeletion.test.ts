/**
 * Deleting your own account, through the router, against a real Postgres.
 *
 * What it must do is what the schema says goes with an account — the
 * shopper's own rows go, an order stays with no account on it — and what it
 * must refuse is each thing the row is still holding up. Supabase is
 * unconfigured here, so the password is the local digest's.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  customerAddresses,
  mediaFiles,
  orderItems,
  orders,
  pointEntries,
  reviewPhotos,
  reviews,
  savedProducts,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import type { TrpcContext } from "../core/context.js";
import type { User } from "../../database/schema.js";

let db: ReturnType<typeof drizzle>;
let appRouter: any;
const PASSWORD = "a-long-enough-password";
let serial = 0;

function contextFor(user: User | null, cleared: string[] = []): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: (name: string) => { cleared.push(name); } } as unknown as TrpcContext["res"],
  };
}

const rowOf = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("../services/db", async importOriginal => {
    const actual = await importOriginal<typeof import("../services/db")>();
    return { ...actual, getDb: async () => db, touchLastSignedIn: async () => {} };
  });
  vi.stubEnv("JWT_SECRET", "a-test-secret-for-signing-sessions-0123456789");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost:5432/unused");
  ({ appRouter } = await import("./index.js"));
}, 60_000);

async function shopper(role: "user" | "admin" = "user") {
  const { hashPassword } = await import("../core/password.js");
  serial += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `leaver${serial}@example.com`, passwordHash: await hashPassword(PASSWORD), name: "Leaver", role })
    .returning();
  return row as User;
}

async function store() {
  serial += 1;
  const [row] = await db.insert(vendors).values({ slug: `store-${serial}`, name: `Store ${serial}`, status: "approved" }).returning();
  return row.id;
}

/** An order of `user`'s with one line at `fulfilment`. */
async function orderFor(user: User, fulfilment: "pending" | "shipped" | "delivered") {
  serial += 1;
  const vendorId = await store();
  const [order] = await db.insert(orders).values({
    reference: `NL-LEAVE-${serial}`, userId: user.id, email: user.email, status: "pending_payment",
    itemsTotal: "5.000", grandTotal: "5.000", currency: "KWD",
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, vendorId, vendorName: "Store", productTitle: "Lamp", unitPrice: "5.000", quantity: 1,
    lineTotal: "5.000", commissionPercent: "10.00", commissionAmount: "0.500", vendorNet: "4.500", fulfilment,
  });
  return order.id;
}

describe("deleting your account", () => {
  it("refuses without the right password, and keeps the account", async () => {
    const user = await shopper();
    const me = appRouter.createCaller(contextFor(user));
    await expect(me.auth.deleteAccount({ currentPassword: "not-the-password" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await rowOf(user.id)).toBeDefined();
  });

  it("deletes the account and what is only the shopper's, keeps an order with no account on it, and ends the session", async () => {
    const user = await shopper();
    await db.insert(customerAddresses).values({ userId: user.id, label: "Home", addressLine: "Block 1" });
    await db.insert(savedProducts).values({ userId: user.id, productId: "17" });
    await db.insert(pointEntries).values({ userId: user.id, points: 800, reason: "admin_adjustment" });
    const orderId = await orderFor(user, "delivered");
    /* A review with a photo on it: the review cascades, and the file goes with it. */
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const [review] = await db.insert(reviews).values({ orderItemId: line.id, userId: user.id, productTitle: "Lamp", rating: 4 }).returning();
    const photoId = `leaverphoto${serial}xxxxxx`;
    await db.insert(mediaFiles).values({ id: photoId, uploadedBy: user.id, contentType: "image/webp", bytes: new Uint8Array([1]), width: 400, height: 400, byteSize: 1 });
    await db.insert(reviewPhotos).values({ reviewId: review.id, mediaId: photoId });

    const cleared: string[] = [];
    const me = appRouter.createCaller(contextFor(user, cleared));
    // Said before the press: nothing in the way, and the points that go with it.
    expect(await me.auth.deletionCheck()).toEqual({ blockers: [], points: 800 });

    expect(await me.auth.deleteAccount({ currentPassword: PASSWORD })).toEqual({ deleted: true });
    expect(await rowOf(user.id)).toBeUndefined();
    expect(await db.select().from(customerAddresses).where(eq(customerAddresses.userId, user.id))).toEqual([]);
    expect(await db.select().from(savedProducts).where(eq(savedProducts.userId, user.id))).toEqual([]);
    expect(await db.select().from(pointEntries).where(eq(pointEntries.userId, user.id))).toEqual([]);
    expect(await db.select().from(reviews).where(eq(reviews.id, review.id))).toEqual([]);
    expect(await db.select().from(mediaFiles).where(eq(mediaFiles.id, photoId))).toEqual([]);
    // The order is a record of business: it stays, pointing at nobody.
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order).toMatchObject({ userId: null, grandTotal: "5.000" });
    expect(cleared).toHaveLength(1);

    // And the address is free to register again: a fresh account can take it.
    const guest = appRouter.createCaller(contextFor(null));
    await expect(guest.auth.login({ email: user.email, password: PASSWORD })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses while an order is still on its way, and says so before the press", async () => {
    const user = await shopper();
    await orderFor(user, "shipped");
    const me = appRouter.createCaller(contextFor(user));
    expect((await me.auth.deletionCheck()).blockers).toEqual(["orderOpen"]);
    await expect(me.auth.deleteAccount({ currentPassword: PASSWORD }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "account.deleteBlocked.orderOpen" });
    expect(await rowOf(user.id)).toBeDefined();
  });

  it("refuses an administrator, and a member of a store's team", async () => {
    const admin = await shopper("admin");
    await expect(appRouter.createCaller(contextFor(admin)).auth.deleteAccount({ currentPassword: PASSWORD }))
      .rejects.toMatchObject({ message: "account.deleteBlocked.admin" });
    expect(await rowOf(admin.id)).toBeDefined();

    const seller = await shopper();
    await db.insert(vendorMembers).values({ vendorId: await store(), userId: seller.id, role: "owner" });
    const me = appRouter.createCaller(contextFor(seller));
    expect((await me.auth.deletionCheck()).blockers).toEqual(["team"]);
    await expect(me.auth.deleteAccount({ currentPassword: PASSWORD }))
      .rejects.toMatchObject({ message: "account.deleteBlocked.team" });
    expect(await rowOf(seller.id)).toBeDefined();
  });

  it("refuses while NetLet still owes a points cash-out, which is the only record of it", async () => {
    const user = await shopper();
    await db.insert(pointEntries).values({ userId: user.id, points: -1500, reason: "cashed_out" });
    const me = appRouter.createCaller(contextFor(user));
    await expect(me.auth.deleteAccount({ currentPassword: PASSWORD }))
      .rejects.toMatchObject({ message: "account.deleteBlocked.cashOutOwed" });
    expect(await rowOf(user.id)).toBeDefined();
  });
});
