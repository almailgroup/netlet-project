/**
 * The inventory rules, against a real Postgres.
 *
 * These are the tests that matter most in this system: a permission bug here
 * is one vendor editing another's catalog. PGlite runs the actual SQL, so the
 * foreign keys, the enums and the unique indexes are genuinely exercised.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { products, productVariants, stockMovements, users, vendorMembers, vendors } from "../drizzle/schema.js";
import type { Actor } from "../shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let inv: typeof import("./inventory");
let audit: typeof import("./audit");

const ids = { acme: 0, other: 0, admin: 0, owner: 0, staff: 0, acmeProduct: 0, acmeVariant: 0, otherProduct: 0 };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);

  const dir = path.resolve(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  // The data layer reaches for the app's pool; point it at this one.
  vi.doMock("./db", () => ({ getDb: async () => db }));
  inv = await import("./inventory");
  audit = await import("./audit");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [owner] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [staff] = await db.insert(users).values({ email: "staff@acme.test" }).returning();
  ids.admin = admin.id; ids.owner = owner.id; ids.staff = staff.id;

  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved" }).returning();
  const [other] = await db.insert(vendors).values({ slug: "other", name: "Other", status: "approved" }).returning();
  ids.acme = acme.id; ids.other = other.id;

  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: owner.id, role: "owner" },
    { vendorId: acme.id, userId: staff.id, role: "staff" },
  ]);

  const [p1] = await db.insert(products).values({ vendorId: acme.id, handle: "acme-lamp", title: "Acme Lamp" }).returning();
  const [p2] = await db.insert(products).values({ vendorId: other.id, handle: "other-kettle", title: "Other Kettle" }).returning();
  ids.acmeProduct = p1.id; ids.otherProduct = p2.id;
  const [v1] = await db.insert(productVariants).values({ productId: p1.id, title: "Default", price: "24.500", stock: 5 }).returning();
  ids.acmeVariant = v1.id;
}, 60_000);

const adminActor = (): Actor => ({ kind: "admin", userId: ids.admin });
const ownerActor = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.acme, role: "owner" });
const staffActor = (): Actor => ({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });

describe("resolveActor", () => {
  it("makes a platform admin an admin, regardless of memberships", async () => {
    expect(await inv.resolveActor({ id: ids.admin, role: "admin" })).toEqual({ kind: "admin", userId: ids.admin });
  });

  it("reads a vendor's rank from their membership", async () => {
    expect(await inv.resolveActor({ id: ids.staff, role: "user" }))
      .toEqual({ kind: "vendor", userId: ids.staff, vendorId: ids.acme, role: "staff" });
  });

  it("leaves somebody with no membership an ordinary shopper", async () => {
    const [nobody] = await db.insert(users).values({ email: "nobody@example.test" }).returning();
    expect(await inv.resolveActor({ id: nobody.id, role: "user" })).toEqual({ kind: "customer", userId: nobody.id });
  });
});

describe("scope", () => {
  it("shows a vendor only its own products", async () => {
    const rows = await inv.listProductsFor(ownerActor());
    expect(rows.map(r => r.handle)).toEqual(["acme-lamp"]);
  });

  it("shows an admin every vendor's", async () => {
    const rows = await inv.listProductsFor(adminActor());
    expect(rows.map(r => r.handle).sort()).toEqual(["acme-lamp", "other-kettle"]);
  });

  // The one that matters: asking for a specific id belonging to someone else
  // must refuse rather than answer.
  it("refuses to fetch another vendor's product by id", async () => {
    await expect(inv.getProduct(ownerActor(), ids.otherProduct)).rejects.toThrow("FORBIDDEN:product.view");
  });

  it("refuses to edit another vendor's product", async () => {
    await expect(inv.updateProduct(ownerActor(), ids.otherProduct, { title: "Hijacked" }))
      .rejects.toThrow("FORBIDDEN:product.edit");
    const [row] = await db.select().from(products).where(eq(products.id, ids.otherProduct));
    expect(row.title).toBe("Other Kettle");
  });
});

describe("rank", () => {
  it("lets staff move stock", async () => {
    const level = await inv.adjustStock(staffActor(), ids.acmeVariant, 10, "received");
    expect(level).toBe(15);
  });

  it("stops staff creating or publishing", async () => {
    await expect(inv.createProduct(staffActor(), { vendorId: ids.acme, title: "Sneaky" }))
      .rejects.toThrow("FORBIDDEN:product.create");
    await expect(inv.setProductStatus(staffActor(), ids.acmeProduct, "published"))
      .rejects.toThrow("FORBIDDEN:product.publish");
  });

  it("stops a vendor setting its own commission, at every rank", async () => {
    await expect(inv.setVendorCommission(ownerActor(), ids.acme, "0.00"))
      .rejects.toThrow("FORBIDDEN:vendor.setCommission");
  });
});

describe("stock", () => {
  it("never goes below zero, and records what really happened", async () => {
    const level = await inv.adjustStock(adminActor(), ids.acmeVariant, -1000, "correction");
    expect(level).toBe(0);
    const [latest] = await db.select().from(stockMovements)
      .where(eq(stockMovements.variantId, ids.acmeVariant))
      .orderBy(stockMovements.id);
    expect(latest).toBeDefined();
    const all = await db.select().from(stockMovements).where(eq(stockMovements.variantId, ids.acmeVariant));
    const clamped = all[all.length - 1];
    // Asked for -1000 from 15; the history says -15, matching the level.
    expect({ delta: clamped.delta, resulting: clamped.resulting }).toEqual({ delta: -15, resulting: 0 });
  });

  it("attributes the movement to whoever made it", async () => {
    await inv.adjustStock(staffActor(), ids.acmeVariant, 3, "returned");
    const all = await db.select().from(stockMovements).where(eq(stockMovements.variantId, ids.acmeVariant));
    expect(all[all.length - 1].actorId).toBe(ids.staff);
  });
});

describe("publishing", () => {
  it("sends an untrusted vendor's product to review rather than live", async () => {
    const status = await inv.setProductStatus(ownerActor(), ids.acmeProduct, "published");
    expect(status).toBe("pending_review");
  });

  it("publishes straight away for a vendor trusted with autoPublish", async () => {
    await db.update(vendors).set({ autoPublish: true }).where(eq(vendors.id, ids.acme));
    const status = await inv.setProductStatus(ownerActor(), ids.acmeProduct, "published");
    expect(status).toBe("published");
    await db.update(vendors).set({ autoPublish: false }).where(eq(vendors.id, ids.acme));
  });

  it("lets an admin publish anything directly", async () => {
    expect(await inv.setProductStatus(adminActor(), ids.otherProduct, "published")).toBe("published");
  });
});

describe("the storefront's view", () => {
  it("shows published products of approved vendors", async () => {
    const rows = await inv.publishedCatalog();
    expect(rows.map(r => r.handle).sort()).toEqual(["acme-lamp", "other-kettle"]);
  });

  // Suspension must empty the shelf without anyone editing a product.
  it("hides a suspended vendor's products without touching them", async () => {
    await db.update(vendors).set({ status: "suspended" }).where(eq(vendors.id, ids.other));
    const rows = await inv.publishedCatalog();
    expect(rows.map(r => r.handle)).toEqual(["acme-lamp"]);
    expect(await inv.publishedProduct("other-kettle")).toBeNull();
    const [row] = await db.select().from(products).where(eq(products.id, ids.otherProduct));
    expect(row.status).toBe("published");
    await db.update(vendors).set({ status: "approved" }).where(eq(vendors.id, ids.other));
  });

  it("carries variants and images with each product", async () => {
    const one = await inv.publishedProduct("acme-lamp");
    expect(one?.variants).toHaveLength(1);
    expect(one?.variants[0].price).toBe("24.500");
  });
});

describe("creating", () => {
  it("gives a new product a slug and a variant it can be priced with", async () => {
    const row = await inv.createProduct(ownerActor(), { vendorId: ids.acme, title: "Acme Lamp" });
    // The slug is taken, so it deduplicates rather than colliding.
    expect(row.handle).toBe("acme-lamp-2");
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, row.id));
    expect(variants).toHaveLength(1);
    expect(row.status).toBe("draft");
  });

  it("refuses to create inside another vendor", async () => {
    await expect(inv.createProduct(ownerActor(), { vendorId: ids.other, title: "Not mine" }))
      .rejects.toThrow("FORBIDDEN:product.create");
  });
});

describe("members", () => {
  it("lets an owner change a rank, and lists who is there", async () => {
    const after = await inv.setMemberRole(ownerActor(), ids.acme, ids.staff, "manager");
    expect(after.find(m => m.userId === ids.staff)?.role).toBe("manager");
    await inv.setMemberRole(ownerActor(), ids.acme, ids.staff, "staff");
  });

  it("stops staff managing the team", async () => {
    await expect(inv.setMemberRole(staffActor(), ids.acme, ids.owner, "staff"))
      .rejects.toThrow("FORBIDDEN:vendor.manageMembers");
  });

  it("stops an owner reaching into another vendor's team", async () => {
    await expect(inv.listMembers(ownerActor(), ids.other)).rejects.toThrow("FORBIDDEN:vendor.viewMembers");
  });
});

describe("product images", () => {
  it("replaces the whole list, in the order given", async () => {
    await inv.setProductImages(ownerActor(), ids.acmeProduct, [
      { url: "https://img/a.jpg", altText: "A" },
      { url: "https://img/b.jpg", altText: null },
    ]);
    let row = await inv.getProduct(ownerActor(), ids.acmeProduct);
    expect(row.images.map(i => i.url)).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
    expect(row.images.map(i => i.position)).toEqual([0, 1]);

    // Saving a shorter list removes the rest rather than leaving orphans.
    await inv.setProductImages(ownerActor(), ids.acmeProduct, [{ url: "https://img/b.jpg" }]);
    row = await inv.getProduct(ownerActor(), ids.acmeProduct);
    expect(row.images.map(i => i.url)).toEqual(["https://img/b.jpg"]);
  });

  it("lets staff look but not change the pictures", async () => {
    await expect(
      inv.setProductImages(staffActor(), ids.acmeProduct, [{ url: "https://img/c.jpg" }]),
    ).rejects.toThrow("FORBIDDEN:product.edit");
  });

  it("refuses a vendor reaching into another vendor's product", async () => {
    await expect(
      inv.setProductImages(ownerActor(), ids.otherProduct, [{ url: "https://img/c.jpg" }]),
    ).rejects.toThrow("FORBIDDEN:product.edit");
  });

  it("empties the list when given nothing", async () => {
    await inv.setProductImages(ownerActor(), ids.acmeProduct, []);
    const row = await inv.getProduct(ownerActor(), ids.acmeProduct);
    expect(row.images).toEqual([]);
  });
});

describe("who reaches the admin panel", () => {
  it("lists everyone with their memberships, for an admin", async () => {
    const people = await inv.listPeople(adminActor());
    const staffRow = people.find(person => person.email === "staff@acme.test");
    expect(staffRow).toBeTruthy();
    expect(staffRow!.vendors.map(v => v.role)).toEqual(["staff"]);
  });

  it("narrows by email or name", async () => {
    const people = await inv.listPeople(adminActor(), { query: "staff@" });
    expect(people.map(person => person.email)).toEqual(["staff@acme.test"]);
  });

  // The escalation this blocks: a vendor owner reading, and then editing, the
  // list of who administers the platform.
  it("refuses a vendor owner entirely", async () => {
    await expect(inv.listPeople(ownerActor())).rejects.toThrow("FORBIDDEN:platform.manageUsers");
    await expect(inv.setUserAdmin(ownerActor(), ids.staff, true)).rejects.toThrow("FORBIDDEN:platform.manageUsers");
    await expect(inv.addMemberByEmail(ownerActor(), ids.acme, "staff@acme.test", "manager"))
      .rejects.toThrow("FORBIDDEN:platform.manageUsers");
  });

  it("grants and revokes administrator", async () => {
    await inv.setUserAdmin(adminActor(), ids.owner, true);
    let row = (await db.select().from(users).where(eq(users.id, ids.owner)))[0];
    expect(row.role).toBe("admin");

    await inv.setUserAdmin(adminActor(), ids.owner, false);
    row = (await db.select().from(users).where(eq(users.id, ids.owner)))[0];
    expect(row.role).toBe("user");
  });

  it("will not let an administrator revoke their own access", async () => {
    await expect(inv.setUserAdmin(adminActor(), ids.admin, false)).rejects.toThrow("CANNOT_DEMOTE_SELF");
  });

  it("will not let the last administrator be removed", async () => {
    // Promote a second admin, then demote the first — allowed, because one is
    // left. Demoting that last one is not.
    await inv.setUserAdmin(adminActor(), ids.owner, true);
    const second: Actor = { kind: "admin", userId: ids.owner };
    await inv.setUserAdmin(second, ids.admin, false);

    await expect(inv.setUserAdmin({ kind: "admin", userId: ids.staff }, ids.owner, false))
      .rejects.toThrow("LAST_ADMIN");

    // Put the fixtures back for the tests that follow.
    await inv.setUserAdmin(second, ids.admin, true);
    await inv.setUserAdmin(adminActor(), ids.owner, false);
  });

  it("adds somebody to a vendor by address, and takes them out again", async () => {
    await inv.addMemberByEmail(adminActor(), ids.other, "staff@acme.test", "manager");
    let members = await inv.listMembers(adminActor(), ids.other);
    expect(members.map(m => m.role)).toEqual(["manager"]);

    await inv.removeMemberAsAdmin(adminActor(), ids.other, ids.staff);
    members = await inv.listMembers(adminActor(), ids.other);
    expect(members).toEqual([]);
  });

  it("refuses an address that has no account, rather than inventing one", async () => {
    await expect(inv.addMemberByEmail(adminActor(), ids.acme, "nobody@nowhere.test", "staff"))
      .rejects.toThrow("NO_SUCH_ACCOUNT");
    const rows = await db.select().from(users).where(eq(users.email, "nobody@nowhere.test"));
    expect(rows).toEqual([]);
  });
});

describe("the admin portal's reports", () => {
  it("counts a vendor's own products only, for that vendor", async () => {
    const mine = await inv.overview(ownerActor());
    const all = await inv.overview(adminActor());
    expect(all.draft + all.published + all.pendingReview + all.archived)
      .toBeGreaterThan(mine.draft + mine.published + mine.pendingReview + mine.archived);
  });

  it("does not show a vendor the platform's vendor counts", async () => {
    const mine = await inv.overview(ownerActor());
    expect(mine.vendorsPending).toBe(0);
    expect(mine.vendorsApproved).toBe(0);
    const all = await inv.overview(adminActor());
    expect(all.vendorsApproved).toBeGreaterThan(0);
  });

  it("judges low against each variant's own threshold, not a shared number", async () => {
    const [urgent] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Reorders at 20", price: "1.000", stock: 3, lowStockAt: 20,
    }).returning();
    const [fine] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Reorders at 2", price: "1.000", stock: 3, lowStockAt: 2,
    }).returning();

    const listed = (await inv.lowStock(ownerActor())).map(row => row.variantId);
    // Identical raw stock, opposite verdicts — which is the whole point.
    expect(listed).toContain(urgent.id);
    expect(listed).not.toContain(fine.id);
  });

  it("puts the most urgent shortfall first", async () => {
    const [worse] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Deep shortfall", price: "1.000", stock: 1, lowStockAt: 40,
    }).returning();
    const [milder] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Shallow shortfall", price: "1.000", stock: 9, lowStockAt: 10,
    }).returning();

    const listed = (await inv.lowStock(ownerActor())).map(row => row.variantId);
    expect(listed.indexOf(worse.id)).toBeLessThan(listed.indexOf(milder.id));
  });

  it("lists a variant at zero even when it declares no threshold", async () => {
    const [empty] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Nothing left", price: "1.000", stock: 0, lowStockAt: null,
    }).returning();
    const listed = (await inv.lowStock(ownerActor())).map(row => row.variantId);
    expect(listed).toContain(empty.id);
  });

  it("reads back who moved stock and why", async () => {
    await inv.adjustStock(staffActor(), ids.acmeVariant, 7, "received", "Two pallets");
    const history = await inv.stockHistory(ownerActor(), { variantId: ids.acmeVariant });
    expect(history[0]).toMatchObject({ delta: 7, reason: "received", note: "Two pallets" });
    expect(history[0].actorEmail).toBe("staff@acme.test");
  });

  it("keeps one vendor's stock history out of another's", async () => {
    const history = await inv.stockHistory(ownerActor());
    const productIds = new Set(history.map(row => row.productId));
    expect(productIds.has(ids.otherProduct)).toBe(false);
  });
});

describe("the audit trail", () => {
  it("records a commission edit with both sides of the change", async () => {
    await inv.setVendorCommission(adminActor(), ids.acme, "12.50", "1.000");
    const rows = await audit.listAudit({ action: "vendor.setCommission" });
    expect(rows[0]).toMatchObject({
      action: "vendor.setCommission",
      subjectType: "vendor",
      subjectId: ids.acme,
      actorEmail: "admin@netlet.test",
    });
    // The pair is what makes it an audit row rather than a timestamp.
    expect(rows[0].after).toMatchObject({ commissionPercent: "12.50" });
    expect(rows[0].before).toBeTruthy();
  });

  it("records who changed a platform role, and to what", async () => {
    await inv.setUserAdmin(adminActor(), ids.staff, true);
    const rows = await audit.listAudit({ action: "user.setAdmin" });
    expect(rows[0]).toMatchObject({ subjectLabel: "staff@acme.test" });
    expect(rows[0].before).toMatchObject({ role: "user" });
    expect(rows[0].after).toMatchObject({ role: "admin" });
    await inv.setUserAdmin(adminActor(), ids.staff, false);
  });

  it("records a price change, and only when the price actually moved", async () => {
    const before = (await audit.listAudit({ action: "product.priceChange" })).length;
    await inv.saveVariant(ownerActor(), {
      id: ids.acmeVariant, productId: ids.acmeProduct, title: "Default", price: "31.000",
    });
    // Saving the same price again is not a change worth a row.
    await inv.saveVariant(ownerActor(), {
      id: ids.acmeVariant, productId: ids.acmeProduct, title: "Default", price: "31.000",
    });
    const rows = await audit.listAudit({ action: "product.priceChange" });
    expect(rows.length).toBe(before + 1);
    expect(rows[0].after).toMatchObject({ price: "31.000" });
  });

  /*
   * The trail is evidence, and evidence must never be able to take down the
   * thing it witnesses. A row that cannot be written is logged and dropped.
   */
  it("swallows a failed write rather than failing the caller", async () => {
    await expect(
      audit.recordAudit(
        { id: 999_999, email: "ghost@netlet.test" }, // no such user: the FK rejects it
        { action: "vendor.setStatus", subjectType: "vendor", subjectId: ids.acme },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("three violations suspend a vendor", () => {
  it("suspends automatically on the third rejection, and says it was automatic", async () => {
    const [v] = await db.insert(vendors).values({ slug: "strikes", name: "Strikes", status: "approved" }).returning();

    for (let i = 1; i <= 3; i += 1) {
      const [p] = await db.insert(products).values({
        vendorId: v.id, handle: `strike-${i}`, title: `Strike ${i}`, status: "pending_review",
      }).returning();
      await inv.reviewProduct(adminActor(), p.id, false, "not acceptable");
    }

    const [after] = await db.select().from(vendors).where(eq(vendors.id, v.id));
    expect(after.status).toBe("suspended");

    const rows = await audit.listAudit({ vendorId: v.id, action: "vendor.setStatus" });
    expect(rows[0].after).toMatchObject({ automatic: true, reason: "three-violations" });
  });

  it("leaves a vendor alone while they are under the limit", async () => {
    const [v] = await db.insert(vendors).values({ slug: "onestrike", name: "One Strike", status: "approved" }).returning();
    const [p] = await db.insert(products).values({
      vendorId: v.id, handle: "one-strike", title: "One", status: "pending_review",
    }).returning();
    await inv.reviewProduct(adminActor(), p.id, false);

    const [after] = await db.select().from(vendors).where(eq(vendors.id, v.id));
    expect(after.status).toBe("approved");
  });
});

describe("per-product commission", () => {
  it("is refused to every vendor rank, exactly like the vendor rate", async () => {
    for (const who of [ownerActor(), staffActor()]) {
      await expect(inv.setProductCommission(who, ids.acmeProduct, { percent: "1.00" }))
        .rejects.toThrow("FORBIDDEN:vendor.setCommission");
    }
  });

  it("is written by an admin and recorded in the audit trail", async () => {
    await inv.setProductCommission(adminActor(), ids.acmeProduct, { percent: "5.00", fixed: "0.250" });
    const [row] = await db.select().from(products).where(eq(products.id, ids.acmeProduct));
    expect(row.commissionPercent).toBe("5.00");
    expect(row.commissionFixed).toBe("0.250");

    const rows = await audit.listAudit({ action: "vendor.setCommission", subjectType: "product" });
    expect(rows[0].after).toMatchObject({ commissionPercent: "5.00" });
  });

  it("clears back to the vendor's rate when set to nothing", async () => {
    await inv.setProductCommission(adminActor(), ids.acmeProduct, { percent: null, fixed: null });
    const [row] = await db.select().from(products).where(eq(products.id, ids.acmeProduct));
    expect(row.commissionPercent).toBeNull();
  });
});

describe("trust badges and account health", () => {
  it("lets an admin award a badge and refuses a vendor owner", async () => {
    await inv.setVendorBadges(adminActor(), ids.acme, ["verified", "fastShipping"]);
    const [row] = await db.select().from(vendors).where(eq(vendors.id, ids.acme));
    expect(row.badges).toEqual(["verified", "fastShipping"]);

    await expect(inv.setVendorBadges(ownerActor(), ids.acme, ["verified"]))
      .rejects.toThrow("FORBIDDEN:vendor.approve");
  });

  it("reports a vendor their own numbers, not another vendor's", async () => {
    const mine = await inv.vendorHealthFor(ownerActor());
    expect(mine.vendorId).toBe(ids.acme);
    // A vendor asking about someone else still gets their own: scope is not
    // a parameter they control.
    const still = await inv.vendorHealthFor(ownerActor(), ids.other);
    expect(still.vendorId).toBe(ids.acme);
  });

  it("shows the components behind the score, so a vendor can check it", async () => {
    const health = await inv.vendorHealthFor(adminActor(), ids.acme);
    expect(health.components.map(c => c.key).sort()).toEqual(["catalog", "compliance", "rating", "stock"]);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });
});
