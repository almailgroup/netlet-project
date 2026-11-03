/**
 * Warranty claims (migration 0072) against a real Postgres: only on something
 * delivered, one open at a time, a store sees only its own, a refusal says
 * why, a repair is the store's to finish, and a replacement or refund becomes
 * an approved return request the returns desk takes from there.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mediaFiles,
  orderItems,
  orders,
  productVariants,
  products,
  returnRequests,
  users,
  vendorMembers,
  vendors,
  warrantyClaims,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let warranty: typeof import("./warranty.js");

const ids = { shopper: 0, stranger: 0, acmeOwner: 0, otherOwner: 0, acme: 0, other: 0, lamp: 0, lampVariant: 0, order: 0, line: 0, second: 0 };
const REFERENCE = "NL-20261103-WRNTY";

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
  warranty = await import("./warranty.js");

  const [shopper] = await db.insert(users).values({ email: "shopper@example.test", name: "Noura Al-Sabah" }).returning();
  const [stranger] = await db.insert(users).values({ email: "stranger@example.test" }).returning();
  const [acmeOwner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [otherOwner] = await db.insert(users).values({ email: "owner@other.test" }).returning();
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: acmeOwner.id, role: "owner" },
    { vendorId: other.id, userId: otherOwner.id, role: "owner" },
  ]);
  const [lamp] = await db.insert(products).values({
    vendorId: acme.id, handle: "lamp", title: "Desk Lamp", status: "published",
    attributes: [{ namespace: "spec", key: "warranty", label: "Warranty", value: "12 months" }],
  }).returning();
  const [lampVariant] = await db.insert(productVariants).values({ productId: lamp.id, title: "Black", price: "20.000", stock: 5 }).returning();
  Object.assign(ids, { shopper: shopper.id, stranger: stranger.id, acmeOwner: acmeOwner.id, otherOwner: otherOwner.id, acme: acme.id, other: other.id, lamp: lamp.id, lampVariant: lampVariant.id });
}, 60_000);

beforeEach(async () => {
  await db.delete(warrantyClaims);
  await db.delete(returnRequests);
  await db.delete(orderItems);
  await db.delete(orders);
  const [order] = await db.insert(orders).values({
    reference: REFERENCE, userId: ids.shopper, email: "shopper@example.test", status: "paid",
    itemsTotal: "40.000", grandTotal: "40.000",
  }).returning();
  const line = (fulfilment: "delivered" | "pending") => ({
    orderId: order.id, vendorId: ids.acme, productId: ids.lamp, variantId: ids.lampVariant, vendorName: "Acme",
    productTitle: "Desk Lamp", unitPrice: "20.000", quantity: 1, lineTotal: "20.000",
    fulfilment, deliveredAt: fulfilment === "delivered" ? new Date() : null,
  });
  const [delivered] = await db.insert(orderItems).values(line("delivered")).returning();
  const [coming] = await db.insert(orderItems).values(line("pending")).returning();
  Object.assign(ids, { order: order.id, line: delivered.id, second: coming.id });
});

const acme = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "owner" });
const other = (): Actor => ({ kind: "vendor", userId: ids.otherOwner, vendorId: ids.other, role: "owner" });
const file = (over: Partial<{ orderItemId: number; problem: string; photos: string[] }> = {}, userId = ids.shopper) =>
  warranty.fileClaim(userId, { reference: REFERENCE, orderItemId: ids.line, problem: "The lamp stopped turning on after a week.", photos: [], ...over });

describe("filing", () => {
  it("files on something delivered, once, and says the store's own warranty beside it", async () => {
    const claim = await file();
    expect(claim.id).toBeGreaterThan(0);
    await expect(file()).rejects.toThrow("warranty.openClaim");
    await expect(file({ orderItemId: ids.second })).rejects.toThrow("warranty.notDelivered");
    await expect(file({}, ids.stranger)).rejects.toThrow("warranty.notFound");
    const states = await warranty.warrantyStateForLines([{ id: ids.line, fulfilment: "delivered", deliveredAt: new Date(), productId: ids.lamp }]);
    expect(states.get(ids.line)).toEqual({ eligibility: { allowed: false, reason: "warranty.openClaim" }, terms: "12 months" });
  });

  it("refuses words too short, contact details, and a photo that is somebody else's", async () => {
    await expect(file({ problem: "broken" })).rejects.toThrow("warranty.tooShort");
    await expect(file({ problem: "Broken — call me on 99887766 please" })).rejects.toThrow("warranty.contactDetails");
    await db.insert(mediaFiles).values({ id: "abcdefghijklmnopqrst", uploadedBy: ids.stranger, contentType: "image/jpeg", bytes: new Uint8Array([1]), width: 1, height: 1, byteSize: 1 });
    await expect(file({ photos: ["/media/abcdefghijklmnopqrst.jpg"] })).rejects.toThrow("warranty.badPhoto");
  });

  it("lets the shopper withdraw it while nobody has answered", async () => {
    const claim = await file();
    await warranty.withdrawClaim(ids.shopper, claim.id);
    const [row] = await db.select().from(warrantyClaims).where(eq(warrantyClaims.id, claim.id));
    expect(row.status).toBe("withdrawn");
    /* A new one may be filed once the last is withdrawn. */
    await expect(file()).resolves.toMatchObject({ id: expect.any(Number) });
  });
});

describe("the store's desk", () => {
  it("shows a store only its own claims, by the shopper's first name", async () => {
    await file();
    const rows = await warranty.listClaims(acme());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shopper: "Noura", terms: "12 months", stage: "waiting", actions: ["accept", "decline"] });
    expect(await warranty.listClaims(other())).toEqual([]);
    expect(await warranty.countOpenClaims(acme())).toBe(1);
    expect(await warranty.countOpenClaims(other())).toBe(0);
  });

  it("needs a reason to decline, and another store's claim is not found", async () => {
    const claim = await file();
    await expect(warranty.decideClaim(acme(), claim.id, { accept: false, response: "" })).rejects.toThrow("warranty.needsReason");
    await expect(warranty.decideClaim(other(), claim.id, { accept: false, response: "Not ours" })).rejects.toThrow("warranty.notFound");
    await warranty.decideClaim(acme(), claim.id, { accept: false, response: "Water damage is not covered." });
    const [row] = await warranty.claimsForShopperOrder(ids.shopper, ids.order);
    expect(row).toMatchObject({ status: "declined", stage: "declined", response: "Water damage is not covered." });
    await expect(warranty.decideClaim(acme(), claim.id, { accept: true, remedy: "repair", response: "" })).rejects.toThrow("warranty.alreadyAnswered");
  });

  it("finishes a repair when the store says so", async () => {
    const claim = await file();
    await warranty.decideClaim(acme(), claim.id, { accept: true, remedy: "repair", response: "Send it in with the driver; we will fix the switch." });
    expect((await warranty.claimsForShopperOrder(ids.shopper, ids.order))[0]).toMatchObject({ stage: "repairing" });
    await warranty.completeClaim(acme(), claim.id, "Switch replaced.");
    expect((await warranty.claimsForShopperOrder(ids.shopper, ids.order))[0]).toMatchObject({ status: "completed", stage: "done", response: "Switch replaced." });
  });

  it("hands a replacement to the returns desk as an approved exchange", async () => {
    const claim = await file();
    await warranty.decideClaim(acme(), claim.id, { accept: true, remedy: "replace", response: "We will swap it." });
    const [request] = await db.select().from(returnRequests);
    expect(request).toMatchObject({ orderItemId: ids.line, kind: "exchange", reason: "defective", status: "approved", decidedBy: "seller" });
    expect((await warranty.claimsForShopperOrder(ids.shopper, ids.order))[0]).toMatchObject({ stage: "returning", remedy: "replace" });
    /* The swap going out finishes the claim. */
    await db.update(returnRequests).set({ status: "exchanged" }).where(eq(returnRequests.id, request.id));
    expect((await warranty.claimsForShopperOrder(ids.shopper, ids.order))[0]).toMatchObject({ stage: "done" });
  });
});

describe("before migration 0072 is pasted", () => {
  /*
   * The code deploys before the owner pastes the bootstrap, and every order a
   * shopper opens reads the claims — so a missing table has to read as "no
   * claims" rather than failing the order page.
   */
  it("reads as no claims, offers no warranty, and says so when one is filed", async () => {
    await db.execute("alter table warranty_claims rename to warranty_claims_away");
    try {
      const states = await warranty.warrantyStateForLines([{ id: ids.line, fulfilment: "delivered", deliveredAt: new Date(), productId: ids.lamp }]);
      expect(states.get(ids.line)).toEqual({ eligibility: { allowed: false, reason: "warranty.unavailable" }, terms: "12 months" });
      expect(await warranty.claimsForShopperOrder(ids.shopper, ids.order)).toEqual([]);
      expect(await warranty.listClaims(acme())).toEqual([]);
      expect(await warranty.countOpenClaims(acme())).toBe(0);
      await expect(file()).rejects.toThrow("warranty.unavailable");
      const { deletionCheck } = await import("./accountDeletion.js");
      const check = await deletionCheck({ id: ids.shopper, role: "user" });
      expect(check.blockers).not.toContain("warrantyOpen");
    } finally {
      await db.execute("alter table warranty_claims_away rename to warranty_claims");
    }
  });
});
