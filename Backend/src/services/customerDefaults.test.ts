/**
 * An account's defaults (migration 0088) against a real Postgres: the default
 * address is only ever one of the account's own and comes back with its
 * governorate; deleting it leaves no default; the way to pay is only one the
 * shop offers, and cash switched off is read as none; and before the
 * migration is pasted a read is "not ready" and a write answers `saved: false`
 * rather than failing.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { customerAddresses, customerDefaults, featureSwitches, users } from "../../database/schema.js";
import { eq } from "drizzle-orm";

let db: ReturnType<typeof drizzle>;
let defaults: typeof import("./customerDefaults.js");

const ids = { shopper: 0, stranger: 0, home: 0, office: 0, theirs: 0 };

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
  defaults = await import("./customerDefaults.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test", name: "Noura" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();
  const [home] = await db.insert(customerAddresses).values({ userId: shopper.id, label: "Home", governorate: "hawalli", addressLine: "Salmiya, Block 5" }).returning();
  const [office] = await db.insert(customerAddresses).values({ userId: shopper.id, label: "Office", governorate: "capital", addressLine: "Sharq, Block 2" }).returning();
  const [theirs] = await db.insert(customerAddresses).values({ userId: stranger.id, label: "Theirs", governorate: "ahmadi", addressLine: "Fahaheel" }).returning();
  Object.assign(ids, { shopper: shopper.id, stranger: stranger.id, home: home.id, office: office.id, theirs: theirs.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(customerDefaults);
  await db.delete(featureSwitches);
});

describe("the default address", () => {
  it("is none to start with, then the one chosen, with its governorate", async () => {
    expect(await defaults.defaultsFor(ids.shopper)).toEqual({ ready: true, addressId: null, governorate: null, payment: "cod", choosable: ["cod"] });
    expect(await defaults.setDefaultAddress(ids.shopper, ids.office)).toEqual({ saved: true });
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: ids.office, governorate: "capital" });
    /* Changing it changes the one row. */
    await defaults.setDefaultAddress(ids.shopper, ids.home);
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: ids.home, governorate: "hawalli" });
    expect(await db.select().from(customerDefaults)).toHaveLength(1);
  });

  it("refuses somebody else's address as one that does not exist", async () => {
    await expect(defaults.setDefaultAddress(ids.shopper, ids.theirs)).rejects.toMatchObject({ reason: "defaults.noSuchAddress" });
    await expect(defaults.setDefaultAddress(ids.shopper, 999_999)).rejects.toMatchObject({ reason: "defaults.noSuchAddress" });
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: null });
  });

  it("is cleared by null, and by the address being deleted", async () => {
    await defaults.setDefaultAddress(ids.shopper, ids.home);
    await defaults.setDefaultAddress(ids.shopper, null);
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: null });

    const [spare] = await db.insert(customerAddresses).values({ userId: ids.shopper, label: "Spare", governorate: "jahra", addressLine: "Jahra" }).returning();
    await defaults.setDefaultAddress(ids.shopper, spare.id);
    await db.delete(customerAddresses).where(eq(customerAddresses.id, spare.id));
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: null, governorate: null });
  });

  it("keeps the way to pay when the address changes, and the address when the way to pay does", async () => {
    await defaults.setDefaultAddress(ids.shopper, ids.home);
    await defaults.setDefaultPayment(ids.shopper, "cod");
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ addressId: ids.home, payment: "cod" });
  });
});

describe("the way to pay", () => {
  it("takes only what the shop offers, which today is cash", async () => {
    await expect(defaults.setDefaultPayment(ids.shopper, "knet")).rejects.toMatchObject({ reason: "defaults.paymentNotOffered" });
    await expect(defaults.setDefaultPayment(ids.shopper, "apple_pay")).rejects.toMatchObject({ reason: "defaults.paymentNotOffered" });
    expect(await defaults.setDefaultPayment(ids.shopper, "cod")).toEqual({ saved: true });
  });

  it("is none, and refuses cash, while the shop takes no cash", async () => {
    await db.insert(featureSwitches).values({ key: "cashOnDelivery", enabled: false });
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ payment: null, choosable: [] });
    await expect(defaults.setDefaultPayment(ids.shopper, "cod")).rejects.toMatchObject({ reason: "defaults.paymentNotOffered" });
  });

  it("reads a stored way the shop no longer offers as the first it does", async () => {
    await db.insert(customerDefaults).values({ userId: ids.shopper, paymentMethod: "card" });
    expect(await defaults.defaultsFor(ids.shopper)).toMatchObject({ payment: "cod" });
  });
});

describe("before 0088 is pasted", () => {
  it("reads as not ready and writes nothing, without failing", async () => {
    await db.execute("alter table customer_defaults rename to customer_defaults_away");
    try {
      expect(await defaults.defaultsFor(ids.shopper)).toEqual({ ready: false, addressId: null, governorate: null, payment: "cod", choosable: ["cod"] });
      expect(await defaults.setDefaultAddress(ids.shopper, ids.home)).toEqual({ saved: false });
      expect(await defaults.setDefaultPayment(ids.shopper, "cod")).toEqual({ saved: false });
      /* Somebody else's address is still refused, before the table is asked. */
      await expect(defaults.setDefaultAddress(ids.shopper, ids.theirs)).rejects.toMatchObject({ reason: "defaults.noSuchAddress" });
    } finally {
      await db.execute("alter table customer_defaults_away rename to customer_defaults");
    }
  });
});
