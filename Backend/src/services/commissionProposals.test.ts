/**
 * Commission proposals, the desk and single-permission grants (3.3.2, 3.3.9),
 * against a real Postgres.
 *
 * The figure's rules are proved pure in
 * `Shared/inventory/commissionProposals.test.ts`. What is here needs the
 * database: who may propose what, that one open proposal per store and product
 * is the index's, that accepting sets the rate through the audited door, and
 * that an employee granted only `vendor.setCommission` can decide one — with
 * the trail naming the administrator who granted it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, commissionProposals, products, staffGrants, users, vendorMembers, vendors } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let proposals: typeof import("./commissionProposals.js");
let grants: typeof import("./grants.js");
let inventory: typeof import("./inventory.js");

const ids = { admin: 0, owner: 0, manager: 0, clerk: 0, rival: 0, vendor: 0, rivalVendor: 0, lamp: 0 };

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
  proposals = await import("./commissionProposals.js");
  grants = await import("./grants.js");
  inventory = await import("./inventory.js");

  const made = async (email: string, role?: string) => (await db.insert(users).values({ email, ...(role ? { role } : {}) }).returning())[0].id;
  ids.admin = await made("admin@netlet.test", "admin");
  ids.owner = await made("owner@acme.test");
  ids.manager = await made("manager@acme.test");
  ids.clerk = await made("clerk@netlet.test");
  ids.rival = await made("owner@rival.test");
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", commissionPercent: "12.00" }).returning();
  const [rival] = await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning();
  ids.vendor = acme.id; ids.rivalVendor = rival.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: ids.owner, role: "owner" },
    { vendorId: acme.id, userId: ids.manager, role: "manager" },
    { vendorId: rival.id, userId: ids.rival, role: "owner" },
  ]);
  const [lamp] = await db.insert(products).values({ vendorId: acme.id, handle: "lamp", title: "Brass Lamp", status: "published" }).returning();
  ids.lamp = lamp.id;
}, 60_000);

beforeEach(async () => {
  await db.delete(commissionProposals);
  await db.delete(staffGrants);
  await db.update(vendors).set({ commissionPercent: "12.00", commissionFixed: null }).where(eq(vendors.id, ids.vendor));
  await db.update(products).set({ commissionPercent: null, commissionFixed: null }).where(eq(products.id, ids.lamp));
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.vendor, role: "owner" });
const manager = (): Actor => ({ kind: "vendor", userId: ids.manager, vendorId: ids.vendor, role: "manager" });
const rival = (): Actor => ({ kind: "vendor", userId: ids.rival, vendorId: ids.rivalVendor, role: "owner" });

describe("proposing", () => {
  it("is a manager's for one product and an owner's for the whole store, one open at a time", async () => {
    const product = await proposals.proposeCommission(manager(), { vendorId: ids.vendor, productId: ids.lamp, percent: "8", fixed: null, reason: "  thin margins  " });
    expect(product).toMatchObject({ percent: "8.00", fixed: null, status: "pending", reason: "thin margins", productTitle: "Brass Lamp", current: { percent: "12.00" } });
    await expect(proposals.proposeCommission(manager(), { vendorId: ids.vendor, productId: null, percent: "8", fixed: null })).rejects.toThrow("FORBIDDEN:vendor.editProfile");
    await expect(proposals.proposeCommission(manager(), { vendorId: ids.vendor, productId: ids.lamp, percent: "7", fixed: null })).rejects.toMatchObject({ reason: "commission.alreadyOpen" });
    const store = await proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: null, fixed: "0.5" });
    expect(store).toMatchObject({ fixed: "0.500", productId: null });
  });

  it("refuses two figures, none, a rival's product, and another store", async () => {
    await expect(proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: "8", fixed: "1" })).rejects.toMatchObject({ reason: "commission.oneFigure" });
    await expect(proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: null, fixed: null })).rejects.toMatchObject({ reason: "commission.oneFigure" });
    await expect(proposals.proposeCommission(rival(), { vendorId: ids.rivalVendor, productId: ids.lamp, percent: "5", fixed: null })).rejects.toMatchObject({ reason: "commission.notFound" });
    await expect(proposals.proposeCommission(rival(), { vendorId: ids.vendor, productId: null, percent: "5", fixed: null })).rejects.toThrow("FORBIDDEN");
  });

  it("shows a store its own proposals and nobody else's", async () => {
    await proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: "9", fixed: null });
    expect((await proposals.listProposals(owner())).total).toBe(1);
    expect((await proposals.listProposals(rival())).total).toBe(0);
    await expect(proposals.listProposals({ kind: "customer", userId: ids.clerk })).rejects.toThrow("FORBIDDEN");
    expect((await proposals.listProposals(admin(), { status: "pending" })).total).toBe(1);
  });
});

describe("deciding", () => {
  it("accepting sets the product's rate, audited with the chain; declining needs a note", async () => {
    const asked = await proposals.proposeCommission(manager(), { vendorId: ids.vendor, productId: ids.lamp, percent: "8", fixed: null });
    await expect(proposals.decideProposal(owner(), asked.id, { accept: true })).rejects.toThrow("FORBIDDEN:vendor.setCommission");
    await expect(proposals.decideProposal(admin(), asked.id, { accept: false, note: " " })).rejects.toMatchObject({ reason: "commission.needsNote" });
    const decided = await proposals.decideProposal(admin(), asked.id, { accept: true });
    expect(decided.status).toBe("accepted");
    const [lamp] = await db.select().from(products).where(eq(products.id, ids.lamp));
    expect(lamp).toMatchObject({ commissionPercent: "8.00", commissionFixed: null });
    await expect(proposals.decideProposal(admin(), asked.id, { accept: true })).rejects.toMatchObject({ reason: "commission.moved" });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "commission.decide"))).toHaveLength(1);
  });

  it("a store-wide fixed amount becomes the store's rate with no percentage beside it", async () => {
    const asked = await proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: null, fixed: "0.750" });
    await proposals.decideProposal(admin(), asked.id, { accept: true });
    const [acme] = await db.select().from(vendors).where(eq(vendors.id, ids.vendor));
    expect(acme).toMatchObject({ commissionPercent: "0.00", commissionFixed: "0.750" });
  });

  it("a withdrawn proposal frees the slot for another", async () => {
    const asked = await proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: "10", fixed: null });
    await expect(proposals.withdrawProposal(rival(), asked.id)).rejects.toThrow("FORBIDDEN");
    await proposals.withdrawProposal(owner(), asked.id);
    await expect(proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: "9", fixed: null })).resolves.toMatchObject({ status: "pending" });
  });
});

describe("one permission, granted (3.3.9)", () => {
  it("lets an employee decide and set rates, and the trail names who granted it", async () => {
    await expect(grants.setGrant(owner(), ids.clerk, "vendor.setCommission", true)).rejects.toThrow("FORBIDDEN:platform.manageUsers");
    await expect(grants.setGrant(admin(), ids.admin, "vendor.setCommission", true)).rejects.toMatchObject({ reason: "grants.isAdmin" });
    await expect(grants.setGrant(admin(), ids.clerk, "platform.viewAll", true)).rejects.toMatchObject({ reason: "grants.notGrantable" });

    const before = await inventory.resolveActor({ id: ids.clerk, role: "user" });
    expect(before).toEqual({ kind: "customer", userId: ids.clerk });
    await grants.setGrant(admin(), ids.clerk, "vendor.setCommission", true);
    const clerk = await inventory.resolveActor({ id: ids.clerk, role: "user" });
    expect(clerk).toEqual({ kind: "customer", userId: ids.clerk, grants: ["vendor.setCommission"] });

    const asked = await proposals.proposeCommission(owner(), { vendorId: ids.vendor, productId: null, percent: "10", fixed: null });
    await proposals.decideProposal(clerk, asked.id, { accept: true });
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.actorId, ids.clerk), eq(auditLog.action, "vendor.setCommission")));
    expect(rows).toEqual([expect.objectContaining({ authorisedById: ids.admin, authorisedByEmail: "admin@netlet.test" })]);
    /* The desk shows rates and nothing else about a store. */
    const desk = await proposals.commissionStores(clerk, { query: "acm" });
    expect(desk.rows).toEqual([{ id: ids.vendor, name: "Acme", nameAr: null, status: "approved", commissionPercent: "10.00", commissionFixed: null }]);
    /* Nothing else an administrator can do came with it. */
    await expect(inventory.listPeople(clerk)).rejects.toThrow("FORBIDDEN");

    await grants.setGrant(admin(), ids.clerk, "vendor.setCommission", false);
    expect(await inventory.resolveActor({ id: ids.clerk, role: "user" })).toEqual({ kind: "customer", userId: ids.clerk });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "user.revokeGrant")))).toHaveLength(1);
  });
});
