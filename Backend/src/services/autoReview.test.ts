/**
 * A seller's submission is read before a person sees it (3.3.6): the rule's
 * checks and NetLet AI both finding nothing puts it on the shelf; either
 * finding something keeps it in the queue and tells the administrators; and
 * anything short of a clean answer leaves it waiting, as it always did.
 *
 * Against a real Postgres (PGlite) with a stand-in model, because what this
 * decides is what goes in front of shoppers without anybody pressing a button.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, authAttempts, categories, notifications, productImages, products, productVariants, users, vendorMembers, vendors } from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";
import { MAX_LISTING_SCREENS_PER_HOUR } from "../../../Shared/inventory/productReview.js";

let db: ReturnType<typeof drizzle>;
let inv: typeof import("./inventory");
let audit: typeof import("./audit");
const model = { on: true, answer: '{"concern":null}' as string | null, asked: 0 };
const ids = { admin: 0, admin2: 0, owner: 0, store: 0, category: 0 };
const owner = (): Actor => ({ kind: "vendor", userId: ids.owner, vendorId: ids.store, role: "owner" });

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
  vi.doMock("./gemini", async importOriginal => ({
    ...(await importOriginal<typeof import("./gemini.js")>()),
    modelAvailable: async () => model.on,
    askModel: async () => { model.asked += 1; return model.answer; },
  }));
  inv = await import("./inventory");
  audit = await import("./audit");

  const [admin] = await db.insert(users).values({ email: "admin@netlet.test", role: "admin" }).returning();
  const [admin2] = await db.insert(users).values({ email: "admin2@netlet.test", role: "admin" }).returning();
  const [seller] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [store] = await db.insert(vendors).values({ name: "Acme", nameAr: "أكمي", slug: "acme", status: "approved" }).returning();
  await db.insert(vendorMembers).values({ vendorId: store.id, userId: seller.id, role: "owner" });
  const [category] = await db.insert(categories).values({ name: "Home & Kitchen", slug: "home-and-kitchen" }).onConflictDoNothing().returning();
  Object.assign(ids, {
    admin: admin.id,
    admin2: admin2.id,
    owner: seller.id,
    store: store.id,
    category: category?.id ?? (await db.select().from(categories).where(eq(categories.slug, "home-and-kitchen")))[0].id,
  });
});

beforeEach(async () => {
  Object.assign(model, { on: true, answer: '{"concern":null}', asked: 0 });
  await db.delete(notifications);
  await db.delete(authAttempts);
});

let serial = 0;
/** A listing with nothing for the rule to find: a price, a photo, a department, a description. */
async function listing(overrides: Partial<typeof products.$inferInsert> = {}, options: { photo?: boolean; price?: string } = {}) {
  serial += 1;
  const [product] = await db.insert(products).values({
    vendorId: ids.store,
    handle: `lamp-${serial}`,
    title: `Brass table lamp ${serial}`,
    description: "A warm brass lamp with a linen shade, for a bedside or a reading corner.",
    categoryId: ids.category,
    status: "draft",
    ...overrides,
  }).returning();
  await db.insert(productVariants).values({ productId: product.id, title: "Default", price: options.price ?? "12.500", stock: 4 });
  if (options.photo !== false) await db.insert(productImages).values({ productId: product.id, url: "https://example.test/lamp.jpg" });
  return product.id;
}

const statusOf = async (id: number) => (await db.select({ status: products.status }).from(products).where(eq(products.id, id)))[0].status;
const staffNotices = () => db.select().from(notifications).where(eq(notifications.kind, "staff_listing_flagged"));
const approvals = (id: number) => db.select().from(auditLog).where(and(eq(auditLog.action, "product.autoApprove"), eq(auditLog.subjectId, id)));

describe("a clean submission", () => {
  it("goes live, on the trail as NetLet AI's approval, with no notice", async () => {
    const id = await listing();
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("published");
    expect(await statusOf(id)).toBe("published");
    expect(model.asked).toBe(1);

    const [row] = await approvals(id);
    expect(row).toMatchObject({ actorId: null, actorEmail: null, vendorId: ids.store, subjectLabel: expect.stringContaining("Brass table lamp") });
    expect(row.after).toEqual({ status: "published", automatic: true });
    expect(await staffNotices()).toEqual([]);
  });

  it("is counted with the sellers' changes an administrator has not read", async () => {
    const id = await listing();
    await inv.setProductStatus(owner(), id, "published");
    const changes = await audit.sellerChanges();
    expect(changes.rows.some(row => row.action === "product.autoApprove" && row.subjectId === id)).toBe(true);
  });
});

describe("a submission somebody should look at", () => {
  it("waits, and tells every administrator, when the model raises a concern", async () => {
    model.answer = '{"concern":"Claims to treat back pain."}';
    const id = await listing();
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    expect(await statusOf(id)).toBe("pending_review");
    expect(await approvals(id)).toEqual([]);

    const notices = await staffNotices();
    expect(notices.map(notice => notice.userId).sort()).toEqual([ids.admin, ids.admin2].sort());
    expect(notices[0]).toMatchObject({
      messageKey: "notice.staffListingFlagged",
      link: "/admin/review",
      params: { product: expect.stringContaining("Brass table lamp"), store: "Acme", storeAr: "أكمي" },
    });
  });

  it("waits, and tells them, when the rule finds something — without spending a model call or the hour", async () => {
    const id = await listing({}, { photo: false });
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    expect(model.asked).toBe(0);
    expect(await staffNotices()).toHaveLength(2);
    expect(await db.select().from(authAttempts)).toEqual([]);
  });

  it("tells them once a day however often the seller presses Publish", async () => {
    const id = await listing({}, { photo: false });
    for (let press = 0; press < 3; press += 1) {
      await inv.setProductStatus(owner(), id, "draft");
      await inv.setProductStatus(owner(), id, "published");
    }
    expect(await staffNotices()).toHaveLength(2);
  });

  it("waits on a contact detail in the description however clean the model says it is", async () => {
    const id = await listing({ description: "Lovely lamp, message me on 99887766 for a better price today." });
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    expect(model.asked).toBe(0);
  });
});

describe("anything short of a clean answer waits for a person, as before", () => {
  it("with no model", async () => {
    model.on = false;
    const id = await listing();
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    expect(await staffNotices()).toEqual([]);
  });

  it("when the model does not answer, or answers in another shape", async () => {
    for (const answer of [null, "not json", '{"verdict":"fine"}', '{"concern":7}']) {
      model.answer = answer;
      const id = await listing();
      expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    }
    expect(await staffNotices()).toEqual([]);
  });

  it("from a bulk publish, which is not screened", async () => {
    const id = await listing();
    expect(await inv.setProductStatus(owner(), id, "published", undefined, { screen: false })).toBe("pending_review");
    expect(model.asked).toBe(0);
  });

  it("once the account's hourly readings are spent", async () => {
    const id = await listing();
    await db.insert(authAttempts).values(Array.from({ length: MAX_LISTING_SCREENS_PER_HOUR }, () => ({ bucket: `user:${ids.owner}`, kind: "listingScreen" })));
    expect(await inv.setProductStatus(owner(), id, "published")).toBe("pending_review");
    expect(model.asked).toBe(0);
  });

  it("never for a store trusted to publish, or an administrator, who skip the queue as before", async () => {
    await db.update(vendors).set({ autoPublish: true }).where(eq(vendors.id, ids.store));
    try {
      const id = await listing();
      expect(await inv.setProductStatus(owner(), id, "published")).toBe("published");
      expect(model.asked).toBe(0);
      expect(await approvals(id)).toEqual([]);
    } finally {
      await db.update(vendors).set({ autoPublish: false }).where(eq(vendors.id, ids.store));
    }
    const id = await listing();
    expect(await inv.setProductStatus({ kind: "admin", userId: ids.admin }, id, "published")).toBe("published");
    expect(model.asked).toBe(0);
  });
});
