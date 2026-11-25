/**
 * The ways a store lets its shoppers pay (migration 0093) against a real
 * Postgres: who may choose them, at least one, what the shop then says on a
 * product, a store's page and a cart, the store a basket cannot share a way
 * with — and that it is closed, not broken, before 0093 is pasted.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, productVariants, products, users, vendorMembers, vendorPaymentMethods, vendors } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let payments: typeof import("./storePayments.js");
let catalog: typeof import("./catalog.js");
const ids = { admin: 0, owner: 0, manager: 0, staff: 0, rival: 0, acme: 0, other: 0, lamp: 0, kettle: 0 };

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, name), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db.js")>()), getDb: async () => db }));
  payments = await import("./storePayments.js");
  catalog = await import("./catalog.js");
  ids.admin = (await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning())[0].id;
  ids.owner = (await db.insert(users).values({ email: "owner@acme.test" }).returning())[0].id;
  ids.manager = (await db.insert(users).values({ email: "manager@acme.test" }).returning())[0].id;
  ids.staff = (await db.insert(users).values({ email: "staff@acme.test" }).returning())[0].id;
  ids.rival = (await db.insert(users).values({ email: "owner@rival.test" }).returning())[0].id;
  ids.acme = (await db.insert(vendors).values({ slug: "acme", name: "Acme", nameAr: "أكمي", status: "approved" }).returning())[0].id;
  ids.other = (await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning())[0].id;
  await db.insert(vendorMembers).values([
    { vendorId: ids.acme, userId: ids.owner, role: "owner" },
    { vendorId: ids.acme, userId: ids.manager, role: "manager" },
    { vendorId: ids.acme, userId: ids.staff, role: "staff" },
    { vendorId: ids.other, userId: ids.rival, role: "owner" },
  ]);
  const [lamp] = await db.insert(products).values({ vendorId: ids.acme, handle: "acme-lamp", title: "Desk lamp", status: "published" }).returning();
  ids.lamp = (await db.insert(productVariants).values({ productId: lamp.id, title: "Default", sku: "LAMP", price: "24.375", stock: 10 }).returning())[0].id;
  const [kettle] = await db.insert(products).values({ vendorId: ids.other, handle: "rival-kettle", title: "Kettle", status: "published" }).returning();
  ids.kettle = (await db.insert(productVariants).values({ productId: kettle.id, title: "Default", sku: "KETTLE", price: "11.250", stock: 4 }).returning())[0].id;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.delete(vendorPaymentMethods);
  await db.delete(auditLog);
  await db.update(vendors).set({ acceptsCod: true, codCeiling: null });
  payments.forgetPaymentTableReadiness();
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.acme, role: "manager" });
const staff = (): Actor => ({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });
const rival = (): Actor => ({ kind: "vendor", userId: ids.rival, vendorId: ids.other, role: "owner" });
const shopper = (): Actor => ({ kind: "customer", userId: ids.staff });

describe("a store's ways to pay", () => {
  it("are all four until the store chooses", async () => {
    expect(await payments.getStorePayments(owner(), ids.acme)).toMatchObject({
      vendorId: ids.acme,
      ready: true,
      cod: true,
      codCeiling: null,
      online: ["knet", "card", "apple_pay"],
      methods: ["cod", "knet", "card", "apple_pay"],
      live: false,
    });
  });

  it("are chosen by the store's owner and managers, and by NetLet, and nobody else", async () => {
    const saved = await payments.setStorePayments(manager(), ids.acme, { cod: true, codCeiling: "250.000", online: ["apple_pay", "knet", "knet", "paypal"] });
    expect(saved).toMatchObject({ cod: true, codCeiling: "250.000", online: ["knet", "apple_pay"], methods: ["cod", "knet", "apple_pay"] });
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: null, online: ["card"] });
    await payments.setStorePayments(admin(), ids.other, { cod: true, codCeiling: null, online: [] });
    expect((await payments.getStorePayments(admin(), ids.other)).methods).toEqual(["cod"]);

    await expect(payments.setStorePayments(staff(), ids.acme, { cod: true, codCeiling: null, online: [] })).rejects.toThrow("FORBIDDEN:vendor.payments");
    await expect(payments.setStorePayments(rival(), ids.acme, { cod: true, codCeiling: null, online: [] })).rejects.toThrow("FORBIDDEN:vendor.payments");
    await expect(payments.setStorePayments(shopper(), ids.acme, { cod: true, codCeiling: null, online: [] })).rejects.toThrow("FORBIDDEN:vendor.payments");
    await expect(payments.getStorePayments(staff(), ids.acme)).rejects.toThrow("FORBIDDEN:vendor.payments");
    expect((await payments.getStorePayments(owner(), ids.acme)).methods).toEqual(["cod", "card"]);
  });

  it("keep one at least, and turning cash off keeps its limit for when it comes back", async () => {
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: "100.000", online: ["knet"] });
    await expect(payments.setStorePayments(owner(), ids.acme, { cod: false, codCeiling: null, online: [] })).rejects.toThrow("storePay.needOne");
    expect((await payments.getStorePayments(owner(), ids.acme)).methods).toEqual(["cod", "knet"]);

    const off = await payments.setStorePayments(owner(), ids.acme, { cod: false, codCeiling: null, online: ["knet"] });
    expect(off).toMatchObject({ cod: false, codCeiling: "100.000", methods: ["knet"] });
    /* NetLet's older store save turning cash off must not leave nothing either. */
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: null, online: [] });
    expect(await payments.cashOffLeavesNothing(db, ids.acme)).toBe(true);
    expect(await payments.cashOffLeavesNothing(db, ids.other)).toBe(false);
  });

  it("go on the trail with what they were and what they became", async () => {
    await payments.setStorePayments(manager(), ids.acme, { cod: true, codCeiling: "75.500", online: ["knet"] });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "vendor.setPayments"));
    expect(row).toMatchObject({ vendorId: ids.acme, subjectLabel: "Acme", actorRole: "manager" });
    expect(row.before).toEqual({ methods: ["cod", "knet", "card", "apple_pay"], codCeiling: null });
    expect(row.after).toEqual({ methods: ["cod", "knet"], codCeiling: "75.500" });
  });

  it("are said on a product, on the store's page and in the cart", async () => {
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: null, online: ["knet"] });
    const lamp = await catalog.getProductByHandle("acme-lamp");
    expect(lamp?.payments).toEqual(["cod", "knet"]);
    const kettle = await catalog.getProductByHandle("rival-kettle");
    expect(kettle?.payments).toEqual(["cod", "knet", "card", "apple_pay"]);
    expect((await catalog.getStorePage("acme"))?.store.payments).toEqual(["cod", "knet"]);

    const cart = await catalog.createCart([
      { variantId: String(ids.lamp), quantity: 1 },
      { variantId: String(ids.kettle), quantity: 1 },
    ]);
    expect(cart?.payments).toEqual({
      stores: [
        { vendorId: ids.acme, methods: ["cod", "knet"] },
        { vendorId: ids.other, methods: ["cod", "knet", "card", "apple_pay"] },
      ],
      shared: ["cod", "knet"],
      differs: null,
    });
  });

  it("name the store a basket shares no way with, and leave cash refused where it is off", async () => {
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: null, online: [] });
    await payments.setStorePayments(rival(), ids.other, { cod: false, codCeiling: null, online: ["apple_pay"] });
    const cart = (await catalog.createCart([
      { variantId: String(ids.lamp), quantity: 1 },
      { variantId: String(ids.kettle), quantity: 1 },
    ]))!;
    expect(cart.payments).toMatchObject({ shared: [], differs: { vendorId: ids.other, vendorName: "Rival", vendorNameAr: null } });
    expect(cart.cod).toEqual({ available: false, because: { kind: "seller", vendorName: "Rival" } });
    /* Checked out on its own, the rival store's goods share what it takes. */
    const lampLine = cart.items.find(item => item.variantId === String(ids.lamp))!;
    const alone = (await catalog.getCart(cart.id, [lampLine.lineId]))!;
    expect(alone.payments).toMatchObject({ shared: ["apple_pay"], differs: null });
  });

  it("are closed, not broken, before 0093 is pasted", async () => {
    await payments.setStorePayments(owner(), ids.acme, { cod: true, codCeiling: null, online: ["knet"] });
    await db.execute(sql`alter table vendor_payment_methods rename to vendor_payment_methods_away`);
    payments.forgetPaymentTableReadiness();
    try {
      const view = await payments.getStorePayments(owner(), ids.acme);
      expect(view).toMatchObject({ ready: false, online: ["knet", "card", "apple_pay"], methods: ["cod", "knet", "card", "apple_pay"] });
      /* The cash is still written; the online three wait, and stay on. */
      const saved = await payments.setStorePayments(owner(), ids.acme, { cod: false, codCeiling: null, online: [] });
      expect(saved).toMatchObject({ ready: false, cod: false, methods: ["knet", "card", "apple_pay"] });
      expect((await catalog.getProductByHandle("acme-lamp"))?.payments).toEqual(["knet", "card", "apple_pay"]);
      expect(await payments.cashOffLeavesNothing(db, ids.acme)).toBe(false);
    } finally {
      await db.execute(sql`alter table vendor_payment_methods_away rename to vendor_payment_methods`);
      payments.forgetPaymentTableReadiness();
    }
  });
});
