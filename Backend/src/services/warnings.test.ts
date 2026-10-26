/**
 * Store warnings against a real Postgres (3.3.18): the third standing one
 * suspends, a store's people are told, withdrawing takes one out of the count,
 * reinstating restarts it, and a rejection is no longer a strike.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, notifications, products, users, vendorMembers, vendors, vendorWarnings } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let warnings: typeof import("./warnings.js");
let inventory: typeof import("./inventory.js");
const ids = { admin: 0, owner: 0, vendor: 0, other: 0, lamp: 0, rivalLamp: 0 };

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
  warnings = await import("./warnings.js");
  inventory = await import("./inventory.js");
  ids.admin = (await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning())[0].id;
  ids.owner = (await db.insert(users).values({ email: "owner@acme.test" }).returning())[0].id;
  ids.vendor = (await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning())[0].id;
  ids.other = (await db.insert(vendors).values({ slug: "rival", name: "Rival", status: "approved" }).returning())[0].id;
  await db.insert(vendorMembers).values({ vendorId: ids.vendor, userId: ids.owner, role: "owner" });
  ids.lamp = (await db.insert(products).values({ vendorId: ids.vendor, handle: "lamp", title: "Lamp", status: "published" }).returning())[0].id;
  ids.rivalLamp = (await db.insert(products).values({ vendorId: ids.other, handle: "rival-lamp", title: "Rival lamp", status: "published" }).returning())[0].id;
}, 60_000);

beforeEach(async () => {
  await db.delete(vendorWarnings);
  await db.delete(notifications);
  await db.update(vendors).set({ status: "approved", warningsSince: null }).where(eq(vendors.id, ids.vendor));
});

const admin = (): Actor => ({ kind: "admin", userId: ids.admin });
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.vendor, role: "owner" });
const status = async () => (await db.select({ status: vendors.status }).from(vendors).where(eq(vendors.id, ids.vendor)))[0].status;

describe("warnings (3.3.18)", () => {
  it("are an administrator's to issue, with a reason, about the store's own product", async () => {
    await expect(warnings.issueWarning(owner(), { vendorId: ids.vendor, reason: "x" })).rejects.toThrow("FORBIDDEN:vendor.approve");
    await expect(warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "  " })).rejects.toMatchObject({ reason: "warnings.needsReason" });
    await expect(warnings.issueWarning(admin(), { vendorId: ids.vendor, productId: ids.rivalLamp, reason: "Fake" })).rejects.toMatchObject({ reason: "warnings.notTheirs" });
    const first = await warnings.issueWarning(admin(), { vendorId: ids.vendor, productId: ids.lamp, reason: "Counterfeit photos" });
    expect(first).toMatchObject({ standing: 1, suspended: false });
    const told = await db.select().from(notifications).where(eq(notifications.userId, ids.owner));
    expect(told).toEqual([expect.objectContaining({ kind: "seller_warning", link: "/admin" })]);
    /* The store reads its own, without who issued it; another store reads none of them. */
    const mine = await warnings.listWarnings(owner());
    expect(mine).toMatchObject({ standing: 1, suspendAt: 3 });
    expect(mine.rows[0]).toMatchObject({ reason: "Counterfeit photos", productTitle: "Lamp", state: "standing", issuedBy: null });
    expect((await warnings.listWarnings(admin(), ids.vendor)).rows[0].issuedBy).toBe("admin@netlet.test");
    await expect(warnings.listWarnings({ kind: "vendor", userId: ids.owner, vendorId: ids.other, role: "owner" }, ids.vendor)).resolves.toMatchObject({ rows: [] });
  });

  it("suspends at the third standing, and a withdrawn or lapsed one does not count", async () => {
    const one = await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "One" });
    await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "Two" });
    await warnings.withdrawWarning(admin(), one.id);
    await expect(warnings.withdrawWarning(admin(), one.id)).rejects.toMatchObject({ reason: "warnings.alreadyWithdrawn" });
    /* A year-old warning has lapsed. */
    await db.insert(vendorWarnings).values({ vendorId: ids.vendor, reason: "Old", createdAt: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() - 35 * 86_400_000) });
    expect(await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "Three" })).toMatchObject({ standing: 2, suspended: false });
    expect(await status()).toBe("approved");
    expect(await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "Four" })).toMatchObject({ standing: 3, suspended: true });
    expect(await status()).toBe("suspended");
    const told = await db.select({ kind: notifications.kind }).from(notifications).where(eq(notifications.userId, ids.owner));
    expect(told.map(row => row.kind)).toContain("seller_suspended");
    const automatic = await db.select().from(auditLog).where(and(eq(auditLog.action, "vendor.setStatus"), eq(auditLog.subjectId, ids.vendor)));
    expect(automatic.at(-1)?.after).toMatchObject({ status: "suspended", automatic: true, reason: "three-warnings" });
  });

  it("reinstating restarts the count, so the next warning does not suspend again", async () => {
    for (const reason of ["A", "B", "C"]) await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason });
    expect(await status()).toBe("suspended");
    await inventory.setVendorStatus(admin(), ids.vendor, "approved");
    expect((await warnings.listWarnings(admin(), ids.vendor)).standing).toBe(0);
    expect(await warnings.issueWarning(admin(), { vendorId: ids.vendor, reason: "D" })).toMatchObject({ standing: 1, suspended: false });
    expect(await status()).toBe("approved");
    expect((await warnings.listWarnings(admin(), ids.vendor)).rows.map(row => row.state)).toEqual(["standing", "cleared", "cleared", "cleared"]);
  });

  it("a rejected product is not a strike", async () => {
    for (let n = 0; n < 3; n++) {
      const [row] = await db.insert(products).values({ vendorId: ids.vendor, handle: `bad-${n}`, title: `Bad ${n}`, status: "pending_review" }).returning();
      await inventory.reviewProduct(admin(), row.id, false, "Blurry");
    }
    expect(await status()).toBe("approved");
  });
});
