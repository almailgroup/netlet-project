/**
 * Data-layer tests against a real Postgres.
 *
 * PGlite runs Postgres in-process, so these exercise the actual SQL — enum
 * types, unique indexes and ON CONFLICT arbiters all behave as they will on
 * Supabase. That matters more than usual here: the layer was ported from MySQL,
 * where `onDuplicateKeyUpdate` infers its conflict target and Postgres does not.
 * A wrong arbiter type-checks perfectly and fails only at runtime.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isDuplicateKeyError } from "./db.js";
import {
  customerNotificationPreferences,
  customerPreferences,
  followedProducts,
  savedProducts,
  users,
} from "../drizzle/schema.js";

let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);

  // Apply every generated migration verbatim, in order: if they cannot build
  // the schema, what ships to production is wrong, and this fails loudly.
  // All of them, not just the first — a later migration is exactly where a
  // schema change lands, and testing only 0000 would test the schema as it was.
  const dir = path.resolve(import.meta.dirname, "../drizzle");
  const files = readdirSync(dir).filter(name => name.endsWith(".sql")).sort();
  if (!files.length) throw new Error("No migration found in drizzle/");
  for (const file of files) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}, 60_000);

async function makeUser(email: string) {
  const [row] = await db.insert(users).values({ email, passwordHash: "scrypt$1$1$1$a$b" }).returning();
  return row;
}

describe("schema", () => {
  it("rejects a duplicate email, with the SQLSTATE on the wrapped cause", async () => {
    await makeUser("dupe@example.com");

    // Pinned deliberately. Drizzle wraps driver errors, so the code sits on
    // `cause` rather than the error — `isDuplicateKeyError` in db.ts depends on
    // that. If a drizzle upgrade changes the wrapping, this fails and points
    // straight at the helper instead of letting duplicate signups 500 silently.
    // Only the SQLSTATE is asserted: the constraint field is named differently
    // across drivers, but 23505 is the standard and is what the helper matches.
    await expect(makeUser("dupe@example.com")).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  it("defaults role to user and stamps the timestamps", async () => {
    const user = await makeUser("defaults@example.com");
    expect(user.role).toBe("user");
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.lastSignedIn).toBeInstanceOf(Date);
  });

  it("cascades deletes to a shopper's rows", async () => {
    const user = await makeUser("cascade@example.com");
    await db.insert(savedProducts).values({ userId: user.id, productId: "p1" });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(savedProducts).where(eq(savedProducts.userId, user.id))).toHaveLength(0);
  });
});

describe("upserts", () => {
  it("updates the preference row rather than inserting a second", async () => {
    const user = await makeUser("prefs@example.com");
    const patch = { locale: "ar" as const, deliveryZoneId: "hawalli" };

    await db.insert(customerPreferences).values({ userId: user.id, locale: "en" }).onConflictDoUpdate({ target: customerPreferences.userId, set: { locale: "en" } });
    await db.insert(customerPreferences).values({ userId: user.id, ...patch }).onConflictDoUpdate({ target: customerPreferences.userId, set: patch });

    const rows = await db.select().from(customerPreferences).where(eq(customerPreferences.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe("ar");
    expect(rows[0].deliveryZoneId).toBe("hawalli");
  });

  it("keeps saving a product idempotent", async () => {
    const user = await makeUser("saved@example.com");
    for (let i = 0; i < 3; i++) {
      await db
        .insert(savedProducts)
        .values({ userId: user.id, productId: "aurora-desk-lamp" })
        .onConflictDoNothing({ target: [savedProducts.userId, savedProducts.productId] });
    }
    expect(await db.select().from(savedProducts).where(eq(savedProducts.userId, user.id))).toHaveLength(1);
  });

  it("flips a notification preference in place", async () => {
    const user = await makeUser("notify@example.com");
    const target = [customerNotificationPreferences.userId, customerNotificationPreferences.kind];

    for (const enabled of [true, false]) {
      await db
        .insert(customerNotificationPreferences)
        .values({ userId: user.id, kind: "price_drop", enabled })
        .onConflictDoUpdate({ target, set: { enabled } });
    }

    const rows = await db.select().from(customerNotificationPreferences).where(eq(customerNotificationPreferences.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });

  it("rejects a value outside the notification enum", async () => {
    const user = await makeUser("enum@example.com");
    await expect(
      // @ts-expect-error - the point is that the database refuses it too.
      db.insert(customerNotificationPreferences).values({ userId: user.id, kind: "not_a_kind", enabled: true })
    ).rejects.toThrow();
  });
});

describe("followed products", () => {
  it("keeps one follow per shopper per product", async () => {
    const user = await makeUser("follower@example.com");
    await db.insert(followedProducts).values({ userId: user.id, productId: "lamp" });
    await expect(
      db.insert(followedProducts).values({ userId: user.id, productId: "lamp" }),
    ).rejects.toThrow();
  });

  // The upsert the follow toggle relies on: without the composite unique as the
  // arbiter, ON CONFLICT has nothing to catch and a second tap throws.
  it("upserts on the composite key rather than inserting a duplicate", async () => {
    const user = await makeUser("upsert-follow@example.com");
    await db.insert(followedProducts).values({ userId: user.id, productId: "kettle", priceDrop: true, backInStock: true });
    await db
      .insert(followedProducts)
      .values({ userId: user.id, productId: "kettle", priceDrop: false, backInStock: true })
      .onConflictDoUpdate({
        target: [followedProducts.userId, followedProducts.productId],
        set: { priceDrop: false },
      });
    const rows = await db.select().from(followedProducts).where(eq(followedProducts.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].priceDrop).toBe(false);
  });

  it("defaults both alerts on, since following means tell me either way", async () => {
    const user = await makeUser("defaults-follow@example.com");
    const [row] = await db.insert(followedProducts).values({ userId: user.id, productId: "tv" }).returning();
    expect({ priceDrop: row.priceDrop, backInStock: row.backInStock }).toEqual({ priceDrop: true, backInStock: true });
    expect(row.lastNotifiedPrice).toBeNull();
  });

  it("goes away with the shopper", async () => {
    const user = await makeUser("cascade-follow@example.com");
    await db.insert(followedProducts).values({ userId: user.id, productId: "gone" });
    await db.delete(users).where(eq(users.id, user.id));
    const rows = await db.select().from(followedProducts).where(eq(followedProducts.userId, user.id));
    expect(rows).toEqual([]);
  });
});

describe("firebase-backed accounts", () => {
  // The partial index is what lets Firebase and local accounts share the table:
  // without the WHERE clause, the second local account collides on null.
  it("allows many accounts with no firebase uid, but only one per uid", async () => {
    await db.insert(users).values([
      { email: "local-one@example.com", passwordHash: "scrypt$1$1$1$a$b" },
      { email: "local-two@example.com", passwordHash: "scrypt$1$1$1$a$b" },
    ]);
    await db.insert(users).values({ email: "fb-one@example.com", firebaseUid: "uid-shared" });

    await expect(
      db.insert(users).values({ email: "fb-two@example.com", firebaseUid: "uid-shared" }),
    ).rejects.toThrow();
  });

  // A Firebase account has no local digest, which is the whole point of the
  // column becoming nullable.
  it("stores an account with no password hash", async () => {
    const [row] = await db
      .insert(users)
      .values({ email: "no-digest@example.com", firebaseUid: "uid-no-digest" })
      .returning();
    expect(row.passwordHash).toBeNull();
    expect(row.firebaseUid).toBe("uid-no-digest");
  });
});

describe("isDuplicateKeyError", () => {
  it("finds the SQLSTATE however deeply drizzle wraps it", () => {
    expect(isDuplicateKeyError({ code: "23505" })).toBe(true);
    expect(isDuplicateKeyError({ cause: { code: "23505" } })).toBe(true);
    expect(isDuplicateKeyError({ cause: { cause: { code: "23505" } } })).toBe(true);
  });

  it("does not treat other failures as duplicates", () => {
    // A connection error must not be swallowed as "email already registered".
    expect(isDuplicateKeyError({ cause: { code: "08006" } })).toBe(false);
    expect(isDuplicateKeyError(new Error("boom"))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });

  it("terminates on a self-referencing cause", () => {
    const loop: Record<string, unknown> = {};
    loop.cause = loop;
    expect(isDuplicateKeyError(loop)).toBe(false);
  });
});
