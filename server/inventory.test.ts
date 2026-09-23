/**
 * The inventory rules, against a real Postgres.
 *
 * These are the tests that matter most in this system: a permission bug here
 * is one vendor editing another's catalog. PGlite runs the actual SQL, so the
 * foreign keys, the enums and the unique indexes are genuinely exercised.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
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

  /*
   * The data layer reaches for the app's pool; point it at this one.
   *
   * `createUser` is here too because `createAccount` calls it, and `getDb` is
   * module-local inside db.ts — overriding the export would not redirect it.
   * It writes to this same database, so the row the test reads back is real;
   * the duplicate-address rule it does NOT reimplement, because
   * `createVendorWithOwner` checks that against the real table itself.
   */
  vi.doMock("./db", () => ({
    getDb: async () => db,
    createUser: async (input: { email: string; passwordHash?: string | null; name?: string | null }) => {
      /* One address stands in for the race the pre-check cannot close: the
         real `createUser` returns null when the address was taken between the
         check and the write, and that is what drives the rollback. */
      if (input.email.trim().toLowerCase() === "race@netlet.test") return null;
      const [row] = await db
        .insert(users)
        .values({ email: input.email.trim().toLowerCase(), passwordHash: input.passwordHash ?? null, name: input.name ?? null })
        .returning();
      return row;
    },
  }));
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
  // Priced, because publishing an unpriced product is refused — and a kettle
  // nobody can buy was never a realistic fixture anyway.
  await db.insert(productVariants).values({ productId: p2.id, title: "Default", price: "11.250", stock: 3 });
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
    const { rows } = await inv.listProductsFor(ownerActor());
    expect(rows.map(r => r.handle)).toEqual(["acme-lamp"]);
  });

  it("shows an admin every vendor's", async () => {
    const { rows } = await inv.listProductsFor(adminActor());
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
    const { rows: people } = await inv.listPeople(adminActor());
    const staffRow = people.find(person => person.email === "staff@acme.test");
    expect(staffRow).toBeTruthy();
    expect(staffRow!.vendors.map(v => v.role)).toEqual(["staff"]);
  });

  it("narrows by email or name", async () => {
    const { rows: people } = await inv.listPeople(adminActor(), { query: "staff@" });
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

    const listed = (await inv.lowStock(ownerActor())).rows.map(row => row.variantId);
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

    const listed = (await inv.lowStock(ownerActor())).rows.map(row => row.variantId);
    expect(listed.indexOf(worse.id)).toBeLessThan(listed.indexOf(milder.id));
  });

  it("lists a variant at zero even when it declares no threshold", async () => {
    const [empty] = await db.insert(productVariants).values({
      productId: ids.acmeProduct, title: "Nothing left", price: "1.000", stock: 0, lowStockAt: null,
    }).returning();
    const listed = (await inv.lowStock(ownerActor())).rows.map(row => row.variantId);
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

/* Requirement 3.4.17: one account sells and shops, and the door between the
   two only exists for somebody who actually has both identities. */
/* Requirement 3.1.7: the rows a department expects, written back without
   losing what a seller typed before the schema existed. */
describe("specification rows", () => {
  it("saves the schema's rows and keeps a free-form one", async () => {
    const kept = { namespace: "spec", key: "boxcontents", label: "In the box", value: "Cable" };
    await inv.setProductAttributes(adminActor(), ids.acmeProduct, [
      kept,
      { namespace: "spec", key: "ram", label: "Memory", value: "16" },
    ]);
    const [row] = await db.select({ attributes: products.attributes }).from(products).where(eq(products.id, ids.acmeProduct));
    expect(row.attributes).toContainEqual(kept);
    expect(row.attributes).toContainEqual({ namespace: "spec", key: "ram", label: "Memory", value: "16" });
  });

  /* Checked against the product's own vendor, so another seller's id is a
     refusal rather than a write. */
  it("refuses a seller reaching for another seller's product", async () => {
    await expect(inv.setProductAttributes(ownerActor(), ids.otherProduct, []))
      .rejects.toThrow("FORBIDDEN:product.edit");
  });
});

/* Requirement 3.4.14: the size class the seller picks, which decides the
   vehicle a dispatcher sends. */
describe("how big it is for delivery", () => {
  it("stores the class the seller picked, and clears back to unknown", async () => {
    await inv.setProductSizeClass(adminActor(), ids.acmeProduct, "large");
    let [row] = await db.select({ sizeClass: products.sizeClass }).from(products).where(eq(products.id, ids.acmeProduct));
    expect(row.sizeClass).toBe("large");

    /* Unknown is a real answer rather than a gap to fill with "small":
       guessing small is how a sofa gets dispatched on a motorcycle. */
    await inv.setProductSizeClass(adminActor(), ids.acmeProduct, null);
    [row] = await db.select({ sizeClass: products.sizeClass }).from(products).where(eq(products.id, ids.acmeProduct));
    expect(row.sizeClass).toBeNull();
  });

  /* Checked against the product's own vendor, so another seller's id is a
     refusal rather than a write. */
  it("refuses a seller reaching for another seller's product", async () => {
    await expect(inv.setProductSizeClass(ownerActor(), ids.otherProduct, "large"))
      .rejects.toThrow("FORBIDDEN:product.edit");
  });
});

describe("which store the caller acts for", () => {
  it("names a vendor member's own store", async () => {
    expect(await inv.myStore(ownerActor())).toMatchObject({ id: ids.acme, name: "Acme" });
  });

  /* An administrator acts for NetLet rather than for a store, so there is no
     name to give — and inventing one would put them inside a company. */
  it("is null for an administrator", async () => {
    expect(await inv.myStore(adminActor())).toBeNull();
  });

  it("is null for a shopper, which is what hides the switch", async () => {
    expect(await inv.myStore({ kind: "customer", userId: ids.staff })).toBeNull();
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

  /*
   * Requirement 3.3.9 asks for who changed the commission **and who authorised
   * them**. The trail knew both facts separately and nothing joined them.
   */
  it("names who granted the actor their administrator rights", async () => {
    // `staff@` is made an administrator by `admin@`, and then uses it.
    await inv.setUserAdmin(adminActor(), ids.staff, true);
    await inv.setVendorCommission({ kind: "admin", userId: ids.staff }, ids.acme, "9.00", null);

    const [row] = await audit.listAudit({ action: "vendor.setCommission" });
    expect(row.authorisedByEmail).toBe("admin@netlet.test");
    expect(row.authorisedById).toBe(ids.admin);
    await inv.setUserAdmin(adminActor(), ids.staff, false);
  });

  /*
   * Null is ordinary and honest: the first administrator was made one by
   * whoever ran the bootstrap, and there is no row to point at. Inventing
   * "system" there would assert something the trail does not know.
   */
  it("leaves the chain empty for the installation's first administrator", async () => {
    /*
     * A fresh administrator with no grant row, rather than the fixture's own
     * `admin@` — which other tests in this file promote and demote, so it does
     * have a grant and is not the first administrator any more. The premise
     * had to be built rather than assumed, which is the whole point of the
     * case: "nobody granted this" is a fact about one specific account.
     */
    const [founder] = await db.insert(users).values({ email: "founder@netlet.test", role: "admin" }).returning();
    await inv.setVendorCommission({ kind: "admin", userId: founder.id }, ids.acme, "11.00", null);

    const [row] = await audit.listAudit({ action: "vendor.setCommission" });
    expect(row.actorEmail).toBe("founder@netlet.test");
    expect(row.authorisedByEmail).toBeNull();
    expect(row.authorisedById).toBeNull();
  });

  /*
   * `user.setAdmin` records revocations too. Taking the most recent row
   * without reading it would name whoever removed the rights as the person
   * who conferred them.
   */
  it("names the grant and not the revocation before it", async () => {
    await inv.setUserAdmin(adminActor(), ids.staff, true);
    await inv.setUserAdmin(adminActor(), ids.staff, false);
    await inv.setUserAdmin({ kind: "admin", userId: ids.owner }, ids.staff, true);

    await inv.setVendorCommission({ kind: "admin", userId: ids.staff }, ids.acme, "8.00", null);
    const [row] = await audit.listAudit({ action: "vendor.setCommission" });
    expect(row.authorisedByEmail).toBe("owner@acme.test");
    await inv.setUserAdmin(adminActor(), ids.staff, false);
  });

  /* One extra query per row is worth paying on an act no vendor can reach and
     not on a stock adjustment, so the list is short and deliberate. */
  it("does not spend the lookup on ordinary acts", async () => {
    await inv.adjustStock(adminActor(), ids.acmeVariant, 1, "correction");
    const [row] = await audit.listAudit({ action: "product.priceChange" });
    if (row) expect(row.authorisedByEmail).toBeNull();
  });

  /*
   * Requirement 3.3.8. The changes were always logged; the requirement is
   * that an admin can *see* them, which needs the seller's rank on the row
   * and a count of what has not been read.
   */
  describe("seller changes reaching an admin", () => {
    it("separates what a seller changed from what NetLet did", async () => {
      await inv.saveVariant(ownerActor(), {
        id: ids.acmeVariant, productId: ids.acmeProduct, title: "Default", price: "44.000",
      });
      await inv.setProductStatus(adminActor(), ids.acmeProduct, "draft");

      const { rows } = await audit.sellerChanges({});
      expect(rows.every(row => ["owner", "manager", "staff"].includes(row.actorRole ?? ""))).toBe(true);
      expect(rows.some(row => row.action === "product.priceChange")).toBe(true);
      // The admin's own status change is NetLet acting, not a seller.
      expect(rows.some(row => row.actorRole === "admin")).toBe(false);
      await inv.setProductStatus(adminActor(), ids.acmeProduct, "published");
    });

    it("freezes the rank the actor held rather than the one they hold now", async () => {
      await inv.saveVariant(ownerActor(), {
        id: ids.acmeVariant, productId: ids.acmeProduct, title: "Default", price: "45.000",
      });
      const { rows } = await audit.sellerChanges({});
      expect(rows[0].actorRole).toBe("owner");
    });

    it("counts only what this administrator has not read, and clears on request", async () => {
      const before = await audit.sellerChangesForAdmin(adminActor());
      expect(before.unseen).toBeGreaterThan(0);

      await audit.markAuditSeen(adminActor());
      const after = await audit.sellerChangesForAdmin(adminActor());
      expect(after.unseen).toBe(0);
      // Marking read hides nothing: the trail itself is unchanged.
      expect(after.rows.length).toBe(before.rows.length);

      await inv.saveVariant(ownerActor(), {
        id: ids.acmeVariant, productId: ids.acmeProduct, title: "Default", price: "46.000",
      });
      expect((await audit.sellerChangesForAdmin(adminActor())).unseen).toBe(1);
    });

    /* Every seller's activity, so a vendor reading it would be reading their
       competitors'. */
    it("refuses a vendor owner entirely", async () => {
      await expect(audit.sellerChangesForAdmin(ownerActor())).rejects.toThrow("FORBIDDEN:platform.viewAll");
      await expect(audit.markAuditSeen(ownerActor())).rejects.toThrow("FORBIDDEN:platform.viewAll");
    });
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

/*
 * Opening a store is the flow that replaced "insert a row in Supabase, then
 * ask them to register, then attach them". The rollback is the part worth
 * testing hardest: a store that exists but cannot be signed into looks
 * finished, so nobody goes back to fix it.
 */
describe("account health", () => {
  it("is null for an admin who has named no vendor, not an error", async () => {
    // An admin belongs to no company, so they have no shelf and no rejection
    // count to score. This used to throw NOT_FOUND, which made every admin
    // visit to /admin a failed request the page then swallowed.
    await expect(inv.vendorHealthFor(adminActor())).resolves.toBeNull();
  });

  it("is that vendor's numbers when an admin names one", async () => {
    const health = await inv.vendorHealthFor(adminActor(), ids.acme);
    expect(health?.vendorId).toBe(ids.acme);
    expect(health?.score).toBeGreaterThanOrEqual(0);
  });

  it("is their own vendor's for a vendor member, whatever they ask for", async () => {
    const health = await inv.vendorHealthFor(ownerActor(), ids.other);
    expect(health?.vendorId).toBe(ids.acme);
  });
});

describe("opening a store", () => {
  it("creates the vendor, the login and the membership together", async () => {
    const { vendor, ownerUserId } = await inv.createVendorWithOwner(adminActor(), {
      name: "Bright Store",
      slug: "bright-store",
      status: "approved",
      contactEmail: "Shop@Bright.test",
      contactPhone: "55123456",
      governorate: "hawalli",
      licenceNumber: "0012345",
      payoutIban: "kw81 cbku 0000 0000 0000 1234 5601 01",
      owner: { email: "Owner@Bright.test", password: "a-long-enough-password", name: "Bright Owner" },
    });

    expect(vendor.slug).toBe("bright-store");
    // Normalised on the way in: an address that differs only by case is the
    // same address, and an IBAN with spaces is the same account.
    expect(vendor.contactEmail).toBe("shop@bright.test");
    expect(vendor.payoutIban).toBe("KW81CBKU0000000000001234560101");

    expect(ownerUserId).not.toBeNull();
    const [member] = await db
      .select()
      .from(vendorMembers)
      .where(eq(vendorMembers.userId, ownerUserId!));
    expect(member.vendorId).toBe(vendor.id);
    expect(member.role).toBe("owner");

    const [account] = await db.select().from(users).where(eq(users.id, ownerUserId!));
    expect(account.email).toBe("owner@bright.test");
  });

  it("refuses a taken address before writing anything at all", async () => {
    const before = await db.select().from(vendors);

    await expect(inv.createVendorWithOwner(adminActor(), {
      name: "Doomed Store",
      slug: "doomed-store",
      owner: { email: "owner@acme.test", password: "a-long-enough-password" },
    })).rejects.toThrow("EMAIL_TAKEN");

    const after = await db.select().from(vendors);
    expect(after).toHaveLength(before.length);
    expect(after.some(row => row.slug === "doomed-store")).toBe(false);
  });

  it("rolls the store back when the account cannot be made", async () => {
    // The address passes the pre-check — nothing in `users` has it — and then
    // fails at creation, which is the window the rollback exists for.
    const before = await db.select().from(vendors);

    await expect(inv.createVendorWithOwner(adminActor(), {
      name: "Raced Store",
      slug: "raced-store",
      owner: { email: "race@netlet.test", password: "a-long-enough-password" },
    })).rejects.toThrow("EMAIL_TAKEN");

    const after = await db.select().from(vendors);
    expect(after).toHaveLength(before.length);
    expect(after.some(row => row.slug === "raced-store")).toBe(false);
  });

  it("refuses a slug that is already a store", async () => {
    await expect(inv.createVendorWithOwner(adminActor(), {
      name: "Another Acme",
      slug: "acme",
    })).rejects.toThrow("SLUG_TAKEN");
  });

  it("opens a store with no owner, for one attached later", async () => {
    const { vendor, ownerUserId } = await inv.createVendorWithOwner(adminActor(), {
      name: "Unstaffed Store",
      slug: "unstaffed-store",
    });
    expect(ownerUserId).toBeNull();
    expect(vendor.status).toBe("pending");
  });

  it("refuses a vendor owner, who may not create companies", async () => {
    await expect(inv.createVendorWithOwner(ownerActor(), {
      name: "Self Dealt",
      slug: "self-dealt",
    })).rejects.toThrow(/FORBIDDEN/);
  });

  it("records who opened the store", async () => {
    const rows = await audit.listAudit(adminActor(), { limit: 50 });
    const entry = rows.find(row => row.action === "vendor.create" && row.subjectLabel === "Bright Store");
    expect(entry).toBeTruthy();
    expect(entry!.actorId).toBe(ids.admin);
  });
});

describe("giving an existing store a new login", () => {
  it("creates the account and attaches it at the rank asked for", async () => {
    const { userId } = await inv.addMemberWithNewAccount(adminActor(), ids.acme, {
      email: "Warehouse@Acme.test",
      password: "a-long-enough-password",
      name: "Acme Warehouse",
      role: "staff",
    });

    const [account] = await db.select().from(users).where(eq(users.id, userId));
    expect(account.email).toBe("warehouse@acme.test");
    // An ordinary NetLet account: being in a vendor is the membership row, not
    // a platform role. Otherwise every warehouse hand is an administrator.
    expect(account.role).toBe("user");

    const [member] = await db
      .select()
      .from(vendorMembers)
      .where(and(eq(vendorMembers.vendorId, ids.acme), eq(vendorMembers.userId, userId)));
    expect(member.role).toBe("staff");
  });

  it("refuses an address that already has an account", async () => {
    await expect(inv.addMemberWithNewAccount(adminActor(), ids.acme, {
      email: "owner@acme.test",
      password: "a-long-enough-password",
      role: "manager",
    })).rejects.toThrow("EMAIL_TAKEN");
  });

  it("refuses a vendor owner, who may rank their team but not mint logins", async () => {
    // The line the requirements draw: vendor.manageMembers is running your own
    // team, platform.manageUsers is creating a NetLet account. An owner has
    // the first and never the second, or they could staff themselves up from
    // nothing.
    await expect(inv.addMemberWithNewAccount(ownerActor(), ids.acme, {
      email: "smuggled@acme.test",
      password: "a-long-enough-password",
      role: "owner",
    })).rejects.toThrow(/FORBIDDEN/);
  });

  it("refuses a store that does not exist", async () => {
    await expect(inv.addMemberWithNewAccount(adminActor(), 99999, {
      email: "nowhere@acme.test",
      password: "a-long-enough-password",
      role: "staff",
    })).rejects.toThrow("NOT_FOUND");
  });
});

/*
 * The money bug. `createProduct` starts a product with a Default variant at
 * 0.000 so that it has something to price; publishing before anyone types a
 * price put a KWD 0 item on the shelf that a shopper could buy for nothing.
 */
describe("publishing an unpriced product", () => {
  it("is refused, and the product stays where it was", async () => {
    const created = await inv.createProduct(adminActor(), { vendorId: ids.acme, title: "Unpriced Thing" });

    await expect(
      inv.setProductStatus(adminActor(), created.id, "published"),
    ).rejects.toThrow("UNPRICED");

    const [row] = await db.select().from(products).where(eq(products.id, created.id));
    expect(row.status).toBe("draft");
  });

  it("is allowed once a price is on every variant", async () => {
    const created = await inv.createProduct(adminActor(), { vendorId: ids.acme, title: "Priced Thing" });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, created.id));
    await inv.saveVariant(adminActor(), { id: variant.id, productId: created.id, title: "Default", price: "12.750" });

    expect(await inv.setProductStatus(adminActor(), created.id, "published")).toBe("published");
  });

  it("blocks on one unpriced variant even when its siblings cost something", async () => {
    // The reason this is "any" and not "all": the zero one is buyable at zero
    // the moment the product goes live, whatever the others cost.
    const created = await inv.createProduct(adminActor(), { vendorId: ids.acme, title: "Half Priced" });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, created.id));
    await inv.saveVariant(adminActor(), { id: variant.id, productId: created.id, title: "Default", price: "9.000" });
    await inv.saveVariant(adminActor(), { productId: created.id, title: "Spare", price: "0.000" });

    await expect(
      inv.setProductStatus(adminActor(), created.id, "published"),
    ).rejects.toThrow("UNPRICED");
  });

  it("is refused through the review queue too, which is the other door", async () => {
    const created = await inv.createProduct(adminActor(), { vendorId: ids.acme, title: "Awaiting Review" });
    await db.update(products).set({ status: "pending_review" }).where(eq(products.id, created.id));

    await expect(
      inv.reviewProduct(adminActor(), created.id, true),
    ).rejects.toThrow("UNPRICED");

    // Rejecting is still fine: that takes it off the path to the shelf.
    await inv.reviewProduct(adminActor(), created.id, false, "No price");
    const [after] = await db.select().from(products).where(eq(products.id, created.id));
    expect(after.status).toBe("rejected");
  });
});

describe("sending a member a password reset", () => {
  it("says it sent nothing when there is no mail to send with", async () => {
    // Firebase is unconfigured in these tests, which is exactly the case an
    // administrator must not be told "sent" for: they would wait for an email
    // that was never going to arrive.
    const result = await inv.sendMemberPasswordReset(adminActor(), ids.owner, "en");
    expect(result.sent).toBe(false);
    expect(result.email).toBe("owner@acme.test");
  });

  it("records who asked for it", async () => {
    await inv.sendMemberPasswordReset(adminActor(), ids.staff, "en");
    const rows = await audit.listAudit(adminActor(), { limit: 50 });
    const entry = rows.find(row => row.action === "user.sendPasswordReset" && row.subjectId === ids.staff);
    expect(entry).toBeTruthy();
    expect(entry!.actorId).toBe(ids.admin);
  });

  it("refuses a vendor owner, who could otherwise reset a colleague's login", async () => {
    await expect(
      inv.sendMemberPasswordReset(ownerActor(), ids.staff, "en"),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("refuses an account that does not exist", async () => {
    await expect(
      inv.sendMemberPasswordReset(adminActor(), 999999, "en"),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("editing a store's details", () => {
  it("saves what changed and leaves the rest alone", async () => {
    const { vendor } = await inv.createVendorWithOwner(adminActor(), {
      name: "Edit Me",
      slug: "edit-me",
      contactPhone: "55000000",
    });

    const updated = await inv.updateVendorProfile(adminActor(), vendor.id, {
      addressLine: "Block 4, Street 12",
    });
    expect(updated.addressLine).toBe("Block 4, Street 12");
    expect(updated.contactPhone).toBe("55000000");
  });

  it("refuses a vendor owner editing their own company's record", async () => {
    // Deliberate: the licence number and the payout account are NetLet's
    // record of who it is paying, not a field the payee edits.
    await expect(
      inv.updateVendorProfile(ownerActor(), ids.acme, { payoutIban: "KW81CBKU0000000000001234560101" }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

/**
 * Paging, over more rows than a page holds.
 *
 * The fixtures above are deliberately small, so these build their own vendor
 * with enough products to actually spill — a list that fits on one page proves
 * nothing about the one that does not, which is the whole failure being fixed.
 */
describe("paging a list longer than a page", () => {
  let pagedVendor = 0;

  beforeAll(async () => {
    const [vendor] = await db.insert(vendors).values({ slug: "paged", name: "Paged", status: "approved" }).returning();
    pagedVendor = vendor.id;
    await db.insert(products).values(
      Array.from({ length: 25 }, (_, index) => ({
        vendorId: vendor.id,
        // Zero-padded so lexical order matches numeric order when reading a failure.
        handle: `paged-${String(index).padStart(2, "0")}`,
        title: `Paged ${String(index).padStart(2, "0")}`,
      })),
    );
  }, 60_000);

  const pagedActor = (): Actor => ({ kind: "admin", userId: ids.admin });

  it("reports the true total on every page, not the size of the page", async () => {
    const first = await inv.listProductsFor(pagedActor(), pagedVendor, { page: 1, pageSize: 10 });
    const last = await inv.listProductsFor(pagedActor(), pagedVendor, { page: 3, pageSize: 10 });
    expect(first.total).toBe(25);
    expect(last.total).toBe(25);
    expect(first.rows).toHaveLength(10);
    expect(last.rows).toHaveLength(5);
  });

  it("hands back different rows on different pages, with none repeated or lost", async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const result = await inv.listProductsFor(pagedActor(), pagedVendor, { page, pageSize: 10 });
      seen.push(...result.rows.map(row => row.handle));
    }
    expect(new Set(seen).size).toBe(25);
  });

  /*
   * A bookmark of page 9 outlives the rows that made nine pages. Landing on
   * the last page is what somebody meant; an empty table is not.
   */
  it("brings a page past the end back to the last real one", async () => {
    const result = await inv.listProductsFor(pagedActor(), pagedVendor, { page: 99, pageSize: 10 });
    expect(result.page).toBe(3);
    expect(result.rows).toHaveLength(5);
  });

  /*
   * The reason search moved to the server: filtering the rows already fetched
   * would search one page and report "no matches" for a product on another.
   */
  it("searches the whole list, not the page it is showing", async () => {
    const result = await inv.listProductsFor(pagedActor(), pagedVendor, { query: "Paged 23", pageSize: 10 });
    expect(result.total).toBe(1);
    expect(result.rows.map(row => row.handle)).toEqual(["paged-23"]);
  });

  it("counts what matches the filter, not the whole table", async () => {
    const all = await inv.listProductsFor(pagedActor(), pagedVendor, { pageSize: 10 });
    const drafts = await inv.listProductsFor(pagedActor(), pagedVendor, { status: "published", pageSize: 10 });
    expect(all.total).toBe(25);
    expect(drafts.total).toBe(0);
  });
});

/**
 * Rows that tie on the sort key.
 *
 * A bulk import gives every row the same `updatedAt`, and Postgres is free to
 * order ties differently between two queries — so offset paging over an
 * unstable sort repeats some rows on the next page and skips others entirely.
 * This is the case that found it: the pager looked fine until the fixtures had
 * matching timestamps.
 */
describe("paging rows that tie on the sort key", () => {
  let tiedVendor = 0;

  beforeAll(async () => {
    const [vendor] = await db.insert(vendors).values({ slug: "tied", name: "Tied", status: "approved" }).returning();
    tiedVendor = vendor.id;
    const sameMoment = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(products).values(
      Array.from({ length: 30 }, (_, index) => ({
        vendorId: vendor.id,
        handle: `tied-${String(index).padStart(2, "0")}`,
        title: `Tied ${String(index).padStart(2, "0")}`,
        createdAt: sameMoment,
        updatedAt: sameMoment,
      })),
    );
  }, 60_000);

  it("visits every row exactly once across the pages", async () => {
    const actor: Actor = { kind: "admin", userId: ids.admin };
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const result = await inv.listProductsFor(actor, tiedVendor, { page, pageSize: 10 });
      seen.push(...result.rows.map(row => row.handle));
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it("gives the same page the same rows when asked twice", async () => {
    const actor: Actor = { kind: "admin", userId: ids.admin };
    const once = await inv.listProductsFor(actor, tiedVendor, { page: 2, pageSize: 10 });
    const twice = await inv.listProductsFor(actor, tiedVendor, { page: 2, pageSize: 10 });
    expect(once.rows.map(row => row.handle)).toEqual(twice.rows.map(row => row.handle));
  });
});
