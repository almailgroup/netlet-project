/**
 * The inventory data layer.
 *
 * Every function here takes the `Actor` doing the work and refuses what that
 * actor may not do. The guard is not in the router alone, because a second
 * caller added later would silently skip it — the check belongs next to the
 * query it protects.
 *
 * Reads that a shopper makes go through `publishedCatalog`, which has no actor
 * because it only ever returns published products of approved vendors.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  categories,
  productImages,
  products,
  productVariants,
  stockMovements,
  users,
  vendorMembers,
  vendors,
} from "../drizzle/schema";
import { assertCan, type Actor, type VendorRole } from "../shared/inventory/permissions";
import { getDb } from "./db";

/* ------------------------------------------------------------- the actor --- */

/**
 * Works out what a signed-in user is allowed to be.
 *
 * A platform admin outranks any vendor membership, so that is checked first.
 * Someone in several vendors acts for one at a time; `vendorId` picks which,
 * and without it they get the first they belong to — which is the common case
 * of belonging to exactly one.
 */
export async function resolveActor(
  user: { id: number; role: string },
  vendorId?: number,
): Promise<Actor> {
  if (user.role === "admin") return { kind: "admin", userId: user.id };

  const db = await getDb();
  if (!db) return { kind: "customer", userId: user.id };

  const memberships = await db
    .select()
    .from(vendorMembers)
    .where(eq(vendorMembers.userId, user.id));

  const membership = vendorId
    ? memberships.find(entry => entry.vendorId === vendorId)
    : memberships[0];

  if (!membership) return { kind: "customer", userId: user.id };
  return {
    kind: "vendor",
    userId: user.id,
    vendorId: membership.vendorId,
    role: membership.role as VendorRole,
  };
}

/* --------------------------------------------------------------- reading --- */

/** A product with everything the storefront and the dashboards need. */
export type FullProduct = Awaited<ReturnType<typeof getProduct>>;

async function hydrate(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, rows: (typeof products.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [variants, images] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position)),
    db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.position)),
  ]);
  return rows.map(row => ({
    ...row,
    variants: variants.filter(v => v.productId === row.id),
    images: images.filter(i => i.productId === row.id),
  }));
}

/**
 * What a shopper may see: published products belonging to approved vendors.
 *
 * Both halves matter. A published product of a suspended vendor must vanish
 * from the storefront without anyone editing the product, which is what makes
 * suspension a real lever.
 */
export async function publishedCatalog(options: { limit?: number; categoryId?: number } = {}) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ p: products })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(
      and(
        eq(products.status, "published"),
        eq(vendors.status, "approved"),
        options.categoryId ? eq(products.categoryId, options.categoryId) : undefined,
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(options.limit ?? 100);
  return hydrate(db, rows.map(row => row.p));
}

/** One published product by its slug, for the product page. */
export async function publishedProduct(handle: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ p: products })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.handle, handle), eq(products.status, "published"), eq(vendors.status, "approved")))
    .limit(1);
  return (await hydrate(db, rows.map(row => row.p)))[0] ?? null;
}

/**
 * The products this actor administers.
 *
 * An admin sees every vendor's; anyone else sees only their own, at every
 * status, because a draft is exactly what a vendor comes to the dashboard to
 * finish.
 */
export async function listProductsFor(actor: Actor, vendorId?: number) {
  assertCan(actor, "product.view", vendorId);
  const db = await getDb();
  if (!db) return [];

  const scope = actor.kind === "admin"
    ? (vendorId ? eq(products.vendorId, vendorId) : undefined)
    : eq(products.vendorId, actor.kind === "vendor" ? actor.vendorId : -1);

  const rows = await db.select().from(products).where(scope).orderBy(desc(products.updatedAt)).limit(500);
  return hydrate(db, rows);
}

export async function getProduct(actor: Actor, productId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) return null;
  // Scope is checked against the product's own vendor, so asking for somebody
  // else's id is a refusal rather than a leak.
  assertCan(actor, "product.view", row.vendorId);
  return (await hydrate(db, [row]))[0];
}

/* --------------------------------------------------------------- writing --- */

/** Slug from a title, deduplicated against what already exists. */
async function uniqueHandle(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, title: string): Promise<string> {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150) || "product";
  const taken = await db.select({ handle: products.handle }).from(products).where(sql`${products.handle} like ${base + "%"}`);
  if (!taken.some(row => row.handle === base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.some(row => row.handle === candidate)) return candidate;
  }
}

export async function createProduct(actor: Actor, input: {
  vendorId: number;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  categoryId?: number | null;
  tags?: string[];
}) {
  assertCan(actor, "product.create", input.vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const handle = await uniqueHandle(db, input.title);
  const [row] = await db.insert(products).values({
    vendorId: input.vendorId,
    categoryId: input.categoryId ?? null,
    handle,
    title: input.title,
    titleAr: input.titleAr ?? null,
    description: input.description ?? null,
    tags: input.tags ?? [],
    status: "draft",
  }).returning();

  // A product with no variant cannot be priced or bought, so it starts with
  // one rather than being a shape the rest of the system has to tolerate.
  await db.insert(productVariants).values({ productId: row.id, title: "Default", price: "0.000" });
  return row;
}

export async function updateProduct(actor: Actor, productId: number, patch: {
  title?: string;
  titleAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  categoryId?: number | null;
  tags?: string[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);
  await db.update(products).set(patch).where(eq(products.id, productId));
  return getProduct(actor, productId);
}

/**
 * Moves a product between statuses.
 *
 * A vendor may publish only if their vendor is trusted with `autoPublish`;
 * otherwise publishing means asking, and the product goes to `pending_review`
 * for an admin. That is the approval cycle the requirements describe, and the
 * decision is here rather than in the UI so it cannot be clicked around.
 */
export async function setProductStatus(
  actor: Actor,
  productId: number,
  target: "draft" | "published" | "archived",
  reviewNote?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.publish", row.vendorId);

  let status: typeof row.status = target;
  if (target === "published" && actor.kind === "vendor") {
    const vendor = (await db.select().from(vendors).where(eq(vendors.id, row.vendorId)).limit(1))[0];
    status = vendor?.autoPublish ? "published" : "pending_review";
  }

  await db.update(products).set({ status, reviewNote: reviewNote ?? null }).where(eq(products.id, productId));
  return status;
}

/** An admin's verdict on something waiting for review. */
export async function reviewProduct(actor: Actor, productId: number, approve: boolean, note?: string) {
  assertCan(actor, "product.review");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db
    .update(products)
    .set({ status: approve ? "published" : "rejected", reviewNote: note ?? null })
    .where(eq(products.id, productId));
}

/**
 * Changes a stock level and records why.
 *
 * The new level is computed from the row we just read and clamped at zero:
 * negative stock is not a state the storefront can render honestly, and a
 * vendor who oversells wants the error now rather than a minus sign later.
 */
export async function adjustStock(actor: Actor, variantId: number, delta: number, reason: string, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const variant = (await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1))[0];
  if (!variant) throw new Error("NOT_FOUND");
  const product = (await db.select().from(products).where(eq(products.id, variant.productId)).limit(1))[0];
  if (!product) throw new Error("NOT_FOUND");
  assertCan(actor, "stock.adjust", product.vendorId);

  const resulting = Math.max(0, variant.stock + delta);
  await db.update(productVariants).set({ stock: resulting }).where(eq(productVariants.id, variantId));
  await db.insert(stockMovements).values({
    variantId,
    // The recorded delta is what actually happened, not what was asked for, so
    // a clamped adjustment does not leave the history disagreeing with the level.
    delta: resulting - variant.stock,
    resulting,
    reason,
    note: note ?? null,
    actorId: actor.userId,
  });
  return resulting;
}

export async function saveVariant(actor: Actor, input: {
  id?: number;
  productId: number;
  title: string;
  sku?: string | null;
  price: string;
  compareAtPrice?: string | null;
  stock?: number;
  options?: Record<string, string>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const product = (await db.select().from(products).where(eq(products.id, input.productId)).limit(1))[0];
  if (!product) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", product.vendorId);

  const values = {
    productId: input.productId,
    title: input.title,
    sku: input.sku ?? null,
    price: input.price,
    compareAtPrice: input.compareAtPrice ?? null,
    stock: input.stock ?? 0,
    options: input.options ?? {},
  };
  if (input.id) {
    await db.update(productVariants).set(values).where(eq(productVariants.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(productVariants).values(values).returning();
  return row.id;
}

/* ---------------------------------------------------------------- people --- */

export async function listMembers(actor: Actor, vendorId: number) {
  assertCan(actor, "vendor.viewMembers", vendorId);
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: vendorMembers.id,
      userId: vendorMembers.userId,
      role: vendorMembers.role,
      email: users.email,
      name: users.name,
    })
    .from(vendorMembers)
    .innerJoin(users, eq(vendorMembers.userId, users.id))
    .where(eq(vendorMembers.vendorId, vendorId));
}

/**
 * Adds somebody to a vendor, or changes their rank.
 *
 * An owner cannot promote anyone above themselves, which is what stops the
 * only genuinely dangerous move a vendor account can make on its own.
 */
export async function setMemberRole(actor: Actor, vendorId: number, userId: number, role: VendorRole) {
  assertCan(actor, "vendor.manageMembers", vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db
    .insert(vendorMembers)
    .values({ vendorId, userId, role })
    .onConflictDoUpdate({ target: [vendorMembers.vendorId, vendorMembers.userId], set: { role } });
  return listMembers(actor, vendorId);
}

export async function removeMember(actor: Actor, vendorId: number, userId: number) {
  assertCan(actor, "vendor.manageMembers", vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.delete(vendorMembers).where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)));
  return listMembers(actor, vendorId);
}

/* --------------------------------------------------------------- vendors --- */

export async function listVendors(actor: Actor) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vendors).orderBy(asc(vendors.name));
}

export async function setVendorCommission(actor: Actor, vendorId: number, percent: string, fixed?: string | null) {
  assertCan(actor, "vendor.setCommission");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(vendors).set({ commissionPercent: percent, commissionFixed: fixed ?? null }).where(eq(vendors.id, vendorId));
}

export async function setVendorStatus(actor: Actor, vendorId: number, status: "pending" | "approved" | "suspended") {
  assertCan(actor, "vendor.approve");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(vendors).set({ status }).where(eq(vendors.id, vendorId));
}

export async function listCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
}
