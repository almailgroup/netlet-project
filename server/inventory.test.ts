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
import { products, productVariants, stockMovements, users, vendorMembers, vendors } from "../drizzle/schema";
import type { Actor } from "../shared/inventory/permissions";

let db: ReturnType<typeof drizzle>;
let inv: typeof import("./inventory");

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
