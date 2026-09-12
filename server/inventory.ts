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
} from "../drizzle/schema.js";
import { assertCan, type Actor, type VendorRole } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

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

/** A product with everything the storefront and the admin portal need. */
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
 * status, because a draft is exactly what a vendor comes to the admin portal to
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
 * Replaces a product's images, in the order given.
 *
 * Replace rather than append: the editor shows the whole list and saves the
 * whole list, so "remove the third one" is the same operation as "add one",
 * and there is no second endpoint to forget to guard. Position comes from the
 * array index, so reordering is a save rather than a swap protocol.
 *
 * Until uploads exist these are URLs a vendor pastes. That is also why the
 * image CSP is wide by default — see ENV.mediaHost.
 */
export async function setProductImages(
  actor: Actor,
  productId: number,
  images: { url: string; altText?: string | null }[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);

  await db.delete(productImages).where(eq(productImages.productId, productId));
  if (images.length) {
    await db.insert(productImages).values(
      images.map((image, position) => ({
        productId,
        url: image.url,
        altText: image.altText?.trim() || null,
        position,
      })),
    );
  }
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

/* -------------------------------------------------------------- overview --- */

/**
 * Scope, as SQL.
 *
 * Every report below is the same query for an admin and for a vendor, differing
 * only in whether it is narrowed to one vendor. Writing that once means a
 * report added later cannot accidentally show a vendor somebody else's numbers.
 */
function scopeOf(actor: Actor) {
  return actor.kind === "vendor" ? actor.vendorId : undefined;
}

/**
 * What the portal opens on.
 *
 * Counts rather than lists, because the first question on arriving is "is
 * there anything waiting for me", and a list answers that slower than a
 * number does. Each one is a link to the page that acts on it — a count with
 * nowhere to go is decoration.
 */
export async function overview(actor: Actor) {
  assertCan(actor, "product.view", scopeOf(actor));
  const db = await getDb();
  if (!db) {
    return { draft: 0, pendingReview: 0, published: 0, archived: 0, outOfStock: 0, lowStock: 0, vendorsPending: 0, vendorsApproved: 0 };
  }
  const vendorId = scopeOf(actor);
  const mine = vendorId ? eq(products.vendorId, vendorId) : undefined;

  const byStatus = await db
    .select({ status: products.status, count: sql<number>`count(*)::int` })
    .from(products)
    .where(mine)
    .groupBy(products.status);

  const countOf = (status: string) => byStatus.find(row => row.status === status)?.count ?? 0;

  // Stock questions are about variants, joined back to products for scope.
  const [stock] = await db
    .select({
      outOfStock: sql<number>`count(*) filter (where ${productVariants.stock} <= 0)::int`,
      // Only variants that declare a threshold can be "low". A variant with no
      // lowStockAt has not been given a level to be low against, and counting
      // it as fine is the honest reading.
      lowStock: sql<number>`count(*) filter (where ${productVariants.lowStockAt} is not null and ${productVariants.stock} > 0 and ${productVariants.stock} <= ${productVariants.lowStockAt})::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(mine ? and(mine, eq(products.status, "published")) : eq(products.status, "published"));

  let vendorsPending = 0;
  let vendorsApproved = 0;
  if (actor.kind === "admin") {
    const byVendorStatus = await db
      .select({ status: vendors.status, count: sql<number>`count(*)::int` })
      .from(vendors)
      .groupBy(vendors.status);
    vendorsPending = byVendorStatus.find(row => row.status === "pending")?.count ?? 0;
    vendorsApproved = byVendorStatus.find(row => row.status === "approved")?.count ?? 0;
  }

  return {
    draft: countOf("draft"),
    pendingReview: countOf("pending_review"),
    published: countOf("published"),
    archived: countOf("archived"),
    outOfStock: stock?.outOfStock ?? 0,
    lowStock: stock?.lowStock ?? 0,
    vendorsPending,
    vendorsApproved,
  };
}

/**
 * What is about to run out, worst first.
 *
 * "Worst" is how far below its own threshold a variant is, not its raw count:
 * three left of something that reorders at two is fine, three left of
 * something that reorders at twenty is the emergency. Sorting by raw stock
 * would put them the wrong way round.
 */
export async function lowStock(actor: Actor, limit = 50) {
  assertCan(actor, "product.view", scopeOf(actor));
  const db = await getDb();
  if (!db) return [];
  const vendorId = scopeOf(actor);
  const mine = vendorId ? eq(products.vendorId, vendorId) : undefined;

  return db
    .select({
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      stock: productVariants.stock,
      lowStockAt: productVariants.lowStockAt,
      productId: products.id,
      productTitle: products.title,
      productStatus: products.status,
      vendorName: vendors.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(
      and(
        mine,
        sql`${productVariants.stock} <= 0 or (${productVariants.lowStockAt} is not null and ${productVariants.stock} <= ${productVariants.lowStockAt})`,
      ),
    )
    .orderBy(sql`${productVariants.stock} - coalesce(${productVariants.lowStockAt}, 0) asc`)
    .limit(limit);
}

/**
 * Who moved stock, when, and why.
 *
 * `adjustStock` already writes a row per movement; nothing read them back
 * until now. A level that looks wrong is answered here rather than by asking
 * around, which is the whole reason stock moves by a delta with a reason
 * instead of by typing a new total.
 */
export async function stockHistory(actor: Actor, options: { variantId?: number; limit?: number } = {}) {
  assertCan(actor, "product.view", scopeOf(actor));
  const db = await getDb();
  if (!db) return [];
  const vendorId = scopeOf(actor);

  return db
    .select({
      id: stockMovements.id,
      delta: stockMovements.delta,
      resulting: stockMovements.resulting,
      reason: stockMovements.reason,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      productId: products.id,
      productTitle: products.title,
      actorEmail: users.email,
      actorName: users.name,
    })
    .from(stockMovements)
    .innerJoin(productVariants, eq(stockMovements.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(users, eq(stockMovements.actorId, users.id))
    .where(
      and(
        vendorId ? eq(products.vendorId, vendorId) : undefined,
        options.variantId ? eq(stockMovements.variantId, options.variantId) : undefined,
      ),
    )
    .orderBy(desc(stockMovements.createdAt))
    .limit(options.limit ?? 100);
}

/* ------------------------------------------------------- platform people --- */

/**
 * Everyone with an account, with what they can reach.
 *
 * This is the list an administrator works from when deciding who gets in, so
 * it carries the two things that decide that: the platform role, and every
 * vendor membership. A shopper with neither is still listed — they are who
 * you are about to grant something to.
 *
 * `query` matches email or name. It is a `LIKE`, not a search index: this
 * list is people who work here, not the catalog, and it stays small enough
 * that anything cleverer would be pretending.
 */
export async function listPeople(actor: Actor, options: { query?: string; limit?: number } = {}) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) return [];

  const term = options.query?.trim().toLowerCase();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      lastSignedIn: users.lastSignedIn,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(term ? sql`lower(${users.email}) like ${`%${term}%`} or lower(coalesce(${users.name}, '')) like ${`%${term}%`}` : undefined)
    .orderBy(desc(users.createdAt))
    .limit(options.limit ?? 100);

  if (!rows.length) return [];

  const memberships = await db
    .select({
      userId: vendorMembers.userId,
      vendorId: vendorMembers.vendorId,
      role: vendorMembers.role,
      vendorName: vendors.name,
    })
    .from(vendorMembers)
    .innerJoin(vendors, eq(vendorMembers.vendorId, vendors.id))
    .where(inArray(vendorMembers.userId, rows.map(row => row.id)));

  return rows.map(row => ({
    ...row,
    vendors: memberships.filter(m => m.userId === row.id),
  }));
}

/**
 * Grants or revokes NetLet administrator.
 *
 * Two things are deliberately impossible here. An administrator cannot revoke
 * their own access — locking yourself out of the only surface that can let
 * you back in is not a mistake worth allowing, and there is always another
 * administrator who can do it if it is really meant. And the last
 * administrator cannot be removed at all, for the same reason at the scale of
 * the whole platform: an installation with nobody who can approve a vendor or
 * grant a role is one that needs a database client to recover.
 */
export async function setUserAdmin(actor: Actor, userId: number, isAdmin: boolean) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const target = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!target) throw new Error("NOT_FOUND");

  if (!isAdmin) {
    if (target.id === actor.userId) throw new Error("CANNOT_DEMOTE_SELF");
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, "admin"));
    if (count <= 1) throw new Error("LAST_ADMIN");
  }

  await db.update(users).set({ role: isAdmin ? "admin" : "user" }).where(eq(users.id, userId));
  return { id: userId, role: isAdmin ? "admin" : "user" } as const;
}

/**
 * Puts somebody in a vendor, by address rather than by id.
 *
 * An administrator adding a vendor's staff knows their email, not their row
 * id — and the person may not have registered yet. An unknown address is
 * refused rather than creating an account, because an account created without
 * a password is one nobody can sign in to and everybody assumes works.
 */
export async function addMemberByEmail(
  actor: Actor,
  vendorId: number,
  email: string,
  role: VendorRole,
) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const target = (await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1))[0];
  if (!target) throw new Error("NO_SUCH_ACCOUNT");

  await db
    .insert(vendorMembers)
    .values({ vendorId, userId: target.id, role })
    .onConflictDoUpdate({ target: [vendorMembers.vendorId, vendorMembers.userId], set: { role } });
  return { userId: target.id, vendorId, role };
}

/** Takes somebody out of a vendor. The account itself is untouched. */
export async function removeMemberAsAdmin(actor: Actor, vendorId: number, userId: number) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.delete(vendorMembers).where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)));
  return { userId, vendorId };
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
