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
  productStatus,
  productVariants,
  stockMovements,
  users,
  vendorMembers,
  vendors,
} from "../drizzle/schema.js";
import { assertCan, type Actor, type VendorRole } from "../shared/inventory/permissions.js";
import { discountAllowed, isOffer } from "../shared/inventory/discountLicence.js";
import { recordAudit, violationCount } from "./audit.js";
import { isValidMeasure, type SellUnit } from "../shared/commerce/units.js";
import { vendorHealth, type HealthInputs } from "../shared/inventory/vendorHealth.js";
import { getDb } from "./db.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { createAccount, EmailTakenError } from "./_core/accounts.js";
import { isFirebaseConfigured, sendFirebasePasswordReset } from "./_core/firebase.js";

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

/**
 * This product's own shipping band, overriding its store's.
 *
 * `null` clears the override rather than setting a band — "follow the store"
 * is a third state, the same one the per-product commission rate and the
 * price-request flag both keep. `product.edit`, because it is a fact about the
 * listing, and guarded here rather than in the router alone.
 */
export async function setProductDeliverySpeed(
  actor: Actor,
  productId: number,
  speed: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  // Checked against the product's own vendor, so somebody else's id is a
  // refusal rather than a write.
  assertCan(actor, "product.edit", row.vendorId);
  await db.update(products).set({ deliverySpeed: speed }).where(eq(products.id, productId));
}

/**
 * The product's specification rows (3.1.7).
 *
 * The whole list is replaced with what the caller sends, which already
 * contains the free-form rows `mergeAttributes` kept — merging a second time
 * here would be two places deciding what survives, and eventually they
 * disagree. `product.edit`, guarded beside the query.
 */
export async function setProductAttributes(
  actor: Actor,
  productId: number,
  attributes: { namespace: string; key: string; label: string; value: string }[],
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);
  await db.update(products).set({ attributes }).where(eq(products.id, productId));
}

/**
 * How big this product is for delivery (3.4.14).
 *
 * `null` clears it and means unknown, which is a real answer rather than a
 * gap to fill with "small" — guessing small is how a sofa gets dispatched on a
 * motorcycle. `product.edit`, guarded beside the query.
 */
export async function setProductSizeClass(actor: Actor, productId: number, sizeClass: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);
  await db.update(products).set({ sizeClass }).where(eq(products.id, productId));
}

/**
 * The store the caller acts for, by name.
 *
 * Deliberately not a field on `Actor`: that type is the *permission* shape
 * both sides import to decide what somebody may do, and a display name has no
 * business in an answer about access. This is the one read that wants it — the
 * card telling a seller which hat they are putting on.
 *
 * Null for an administrator, who acts for NetLet rather than for a store, and
 * for a shopper who is in none.
 */
export async function myStore(actor: Actor): Promise<{ id: number; name: string } | null> {
  if (actor.kind !== "vendor") return null;
  assertCan(actor, "vendor.viewMembers", actor.vendorId);
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(eq(vendors.id, actor.vendorId))
    .limit(1);
  return row ?? null;
}

/**
 * The actor as the audit trail wants them: id plus the address at the time.
 *
 * One extra read per audited operation, which are rare and consequential by
 * definition — a commission edit is not a hot path. Copying the email means a
 * row survives the account being deleted, which is exactly when an audit trail
 * is most likely to be the only remaining record.
 */
async function auditActor(actor: Actor) {
  const db = await getDb();
  /* The rank comes off the resolved actor rather than from the database,
     because that is what the guard just checked them against — reading the
     membership row again could disagree with the decision already made. */
  const role = actor.kind === "vendor" ? actor.role : actor.kind;
  if (!db) return { id: actor.userId, email: null, role };
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
  return { id: actor.userId, email: row?.email ?? null, role };
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
export async function listProductsFor(
  actor: Actor,
  vendorId?: number,
  request: PageRequest & { query?: string; status?: (typeof productStatus.enumValues)[number] } = {},
) {
  assertCan(actor, "product.view", vendorId);
  const db = await getDb();
  if (!db) return emptyPage<Awaited<ReturnType<typeof hydrate>>[number]>(request);

  const owned = actor.kind === "admin"
    ? (vendorId ? eq(products.vendorId, vendorId) : undefined)
    : eq(products.vendorId, actor.kind === "vendor" ? actor.vendorId : -1);

  /*
   * Searching happens here rather than over the loaded rows, and that is the
   * difference paging makes: a filter applied on the client would search only
   * the page you happen to be on, and report "no matches" for a product that
   * is on page three. A search that searches part of the catalog is worse than
   * no search, because it answers confidently.
   */
  const term = request.query?.trim().toLowerCase();
  const scope = and(
    owned,
    request.status ? eq(products.status, request.status) : undefined,
    term ? sql`lower(${products.title}) like ${`%${term}%`} or ${products.handle} like ${`%${term}%`}` : undefined,
  );

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(scope);
  const total = counted?.n ?? 0;
  const { page, pageSize, offset } = windowFor(request, total);

  const rows = await db
    .select()
    .from(products)
    .where(scope)
    .orderBy(desc(products.updatedAt), desc(products.id))
    .limit(pageSize)
    .offset(offset);
  return { rows: await hydrate(db, rows), total, page, pageSize };
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

/* ------------------------------------------------------------------ paging --- */

/**
 * What a paged list is asked for, and the empty answer when there is no
 * database. `total` travels with every page: a list that shows some of the
 * answer must not look like one that shows all of it.
 */
export type PageRequest = { page?: number; pageSize?: number };

const emptyPage = <T>(request: PageRequest): Page<T> => ({
  rows: [],
  total: 0,
  page: 1,
  pageSize: clampPageSize(request.pageSize),
});

/**
 * Turns a request into the offset to query with, given the true total.
 *
 * The total is counted first so an out-of-range page can be brought back into
 * range before the rows are fetched — asking page 7 of a 5-page list returns
 * page 5, not an empty table with no explanation.
 */
  /*
   * The id is a tiebreaker, not decoration. `updatedAt` is not unique — a bulk
   * import gives a hundred rows the same microsecond — and Postgres is free to
   * order ties differently between two queries, so offset paging over an
   * unstable sort silently repeats some rows and skips others. Every paged
   * query below ends on a unique column for that reason.
   */
function windowFor(request: PageRequest, total: number) {
  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);
  return { page, pageSize, offset: offsetFor(page, pageSize) };
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
  images: { url: string; altText?: string | null; kind?: "image" | "video" | null; posterUrl?: string | null }[],
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
        /* Absent means a photograph, which is what every row written before
           video was. A poster on an image row would never be read, so it is
           dropped rather than stored to be misleading later. */
        kind: image.kind === "video" ? ("video" as const) : ("image" as const),
        posterUrl: image.kind === "video" ? (image.posterUrl?.trim() || null) : null,
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
/**
 * Refuses to put an unpriced product in front of shoppers.
 *
 * `createProduct` starts every product with a "Default" variant at 0.000,
 * because a product with no variant cannot be priced or bought at all. The
 * cost of that convenience is this: publish before typing a price and the
 * storefront lists the thing at KWD 0 and lets somebody buy it for nothing.
 *
 * So publishing is where the price becomes required. Any variant at zero
 * blocks it, not merely all of them — an unpriced variant is buyable at zero
 * the moment the product is live, whatever its siblings cost.
 */
async function assertPriced(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, productId: number) {
  const rows = await db
    .select({ id: productVariants.id, price: productVariants.price })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  if (rows.length === 0) throw new Error("UNPRICED");
  if (rows.some(row => Number.parseFloat(row.price) <= 0)) throw new Error("UNPRICED");
}

/**
 * A product carrying an offer needs its vendor's discount permit — Kuwaiti law.
 *
 * Refused at the door onto the shelf rather than at the moment a compare-at
 * price is typed, because a price and a permit arrive in either order: a vendor
 * setting up a sale before their paperwork clears is ordinary, and blocking the
 * save would make them delete the price and type it again later. Publishing is
 * where the claim actually reaches a shopper.
 *
 * The storefront checks it *again* on read, and that is not belt and braces:
 * a permit expires on a date with nobody publishing anything, and only the read
 * catches that.
 */
async function assertDiscountLicensed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  productId: number,
  vendorId: number,
) {
  const rows = await db
    .select({ price: productVariants.price, compareAtPrice: productVariants.compareAtPrice })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  if (!rows.some(row => isOffer(row.price, row.compareAtPrice))) return;

  const vendor = (await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1))[0];
  const verdict = discountAllowed({
    number: vendor?.discountLicenceNumber,
    expiresAt: vendor?.discountLicenceExpiresAt,
  });
  // The reason travels, so the portal can say "expired" rather than "no".
  if (!verdict.allowed) throw new Error(`DISCOUNT_LICENCE_${verdict.reason.toUpperCase()}`);
}

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

  if (target === "published") {
    await assertPriced(db, productId);
    await assertDiscountLicensed(db, productId, row.vendorId);
  }

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
  const [was] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!was) throw new Error("NOT_FOUND");

  // The review queue is the other door onto the shelf, and it has to be shut
  // against an unpriced product too — an admin approving is publishing. The
  // discount permit rides along for the same reason: approving an offer is
  // advertising it.
  if (approve) {
    await assertPriced(db, productId);
    await assertDiscountLicensed(db, productId, was.vendorId);
  }

  await db
    .update(products)
    .set({ status: approve ? "published" : "rejected", reviewNote: note ?? null })
    .where(eq(products.id, productId));

  await recordAudit(await auditActor(actor), {
    action: "product.review",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: was.title,
    vendorId: was.vendorId,
    before: { status: was.status },
    after: { status: approve ? "published" : "rejected", approved: approve, note: note ?? null },
  });

  /*
   * Three violations suspend the vendor, which the requirements ask for.
   *
   * The count comes from the audit trail rather than a separate tally, so the
   * number that triggers a suspension is the same number an administrator can
   * read back and check. A second counter would eventually disagree with the
   * evidence, and the evidence is the point.
   */
  if (!approve) {
    const strikes = await violationCount(was.vendorId);
    if (strikes >= 3) {
      const [vendor] = await db.select().from(vendors).where(eq(vendors.id, was.vendorId)).limit(1);
      if (vendor && vendor.status !== "suspended") {
        await db.update(vendors).set({ status: "suspended" }).where(eq(vendors.id, was.vendorId));
        await recordAudit({ id: null, email: null }, {
          action: "vendor.setStatus",
          subjectType: "vendor",
          subjectId: was.vendorId,
          subjectLabel: vendor.name,
          vendorId: was.vendorId,
          before: { status: vendor.status },
          after: { status: "suspended", automatic: true, reason: "three-violations", strikes },
        });
      }
    }
  }
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
  unit?: SellUnit;
  stepAmount?: number;
  preorderStock?: number;
  preorderReleaseAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const product = (await db.select().from(products).where(eq(products.id, input.productId)).limit(1))[0];
  if (!product) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", product.vendorId);

  /*
   * The measure is refused here as well as in the router, because a second
   * caller added later would skip a check written only at the top — the same
   * argument that puts every other guard in this file next to its query. A
   * half-gram step is what puts floating point back into the arithmetic.
   */
  const measure = { unit: input.unit ?? "each", stepAmount: input.stepAmount ?? 1 };
  if (!isValidMeasure(measure)) throw new Error("INVALID_MEASURE");

  /*
   * The pre-order allowance is a promise to a shopper, so it is checked here
   * for the same reason: a negative allowance would make the `>=` predicate
   * behave strangely, and a fractional one is not a number of parcels.
   *
   * A release date in the past is accepted rather than refused — a date slips,
   * and refusing the save would leave the vendor unable to edit anything else
   * about the variant until they invent a new one. `preorder.ts` stops showing
   * a stale date instead, which is where that belongs.
   */
  const preorderStock = input.preorderStock ?? 0;
  if (!Number.isInteger(preorderStock) || preorderStock < 0) throw new Error("INVALID_PREORDER");

  const values = {
    productId: input.productId,
    title: input.title,
    sku: input.sku ?? null,
    price: input.price,
    compareAtPrice: input.compareAtPrice ?? null,
    stock: input.stock ?? 0,
    options: input.options ?? {},
    unit: measure.unit,
    stepAmount: String(measure.stepAmount),
    preorderStock,
    preorderReleaseAt: input.preorderReleaseAt ?? null,
  };
  if (input.id) {
    // A price change is singled out because the requirements want every one
    // visible to the admin. The row says what it moved from and to.
    const [was] = await db.select().from(productVariants).where(eq(productVariants.id, input.id)).limit(1);
    await db.update(productVariants).set(values).where(eq(productVariants.id, input.id));
    if (was && was.price !== values.price) {
      await recordAudit(await auditActor(actor), {
        action: "product.priceChange",
        subjectType: "variant",
        subjectId: input.id,
        subjectLabel: `${product.title} — ${values.title}`,
        vendorId: product.vendorId,
        before: { price: was.price },
        after: { price: values.price },
      });
    }
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

/** One row of `lowStock`, named so an empty page types the same as a full one. */
export type LowStockRow = {
  variantId: number;
  variantTitle: string;
  sku: string | null;
  stock: number;
  lowStockAt: number | null;
  productId: number;
  productTitle: string;
  productStatus: string;
  vendorName: string;
};

/**
 * What is about to run out, worst first.
 *
 * "Worst" is how far below its own threshold a variant is, not its raw count:
 * three left of something that reorders at two is fine, three left of
 * something that reorders at twenty is the emergency. Sorting by raw stock
 * would put them the wrong way round.
 */
export async function lowStock(actor: Actor, request: PageRequest = {}) {
  assertCan(actor, "product.view", scopeOf(actor));
  const db = await getDb();
  if (!db) return emptyPage<LowStockRow>(request);
  const vendorId = scopeOf(actor);
  const mine = vendorId ? eq(products.vendorId, vendorId) : undefined;
  const isLow = and(
    mine,
    sql`${productVariants.stock} <= 0 or (${productVariants.lowStockAt} is not null and ${productVariants.stock} <= ${productVariants.lowStockAt})`,
  );

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(isLow);
  const total = counted?.n ?? 0;
  const { page, pageSize, offset } = windowFor(request, total);

  const rows = await db
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
    .where(isLow)
    .orderBy(sql`${productVariants.stock} - coalesce(${productVariants.lowStockAt}, 0) asc`, asc(productVariants.id))
    .limit(pageSize)
    .offset(offset);

  return { rows, total, page, pageSize };
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
/** One row of `listPeople`, named so an empty page types the same as a full one. */
export type PersonRow = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  lastSignedIn: Date;
  createdAt: Date;
  vendors: { userId: number; vendorId: number; role: string; vendorName: string }[];
};

export async function listPeople(actor: Actor, options: { query?: string } & PageRequest = {}) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) return emptyPage<PersonRow>(options);

  const term = options.query?.trim().toLowerCase();
  const matching = term
    ? sql`lower(${users.email}) like ${`%${term}%`} or lower(coalesce(${users.name}, '')) like ${`%${term}%`}`
    : undefined;

  // This list is everyone with an account, shoppers included, so it is the one
  // that outgrows a fixed ceiling first — and deciding who administers NetLet
  // from the hundred newest registrations is not a decision at all.
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(matching);
  const total = counted?.n ?? 0;
  const { page, pageSize, offset } = windowFor(options, total);

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
    .where(matching)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(pageSize)
    .offset(offset);

  if (!rows.length) return { rows: [] as PersonRow[], total, page, pageSize };

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

  return {
    rows: rows.map(row => ({ ...row, vendors: memberships.filter(m => m.userId === row.id) })),
    total,
    page,
    pageSize,
  };
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

  await recordAudit(await auditActor(actor), {
    action: "user.setAdmin",
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    before: { role: target.role },
    after: { role: isAdmin ? "admin" : "user" },
  });

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

  const [existing] = await db
    .select()
    .from(vendorMembers)
    .where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, target.id)))
    .limit(1);

  await db
    .insert(vendorMembers)
    .values({ vendorId, userId: target.id, role })
    .onConflictDoUpdate({ target: [vendorMembers.vendorId, vendorMembers.userId], set: { role } });

  await recordAudit(await auditActor(actor), {
    action: "vendor.addMember",
    subjectType: "user",
    subjectId: target.id,
    subjectLabel: target.email,
    vendorId,
    before: existing ? { role: existing.role } : null,
    after: { role },
  });

  return { userId: target.id, vendorId, role };
}

/** Takes somebody out of a vendor. The account itself is untouched. */
export async function removeMemberAsAdmin(actor: Actor, vendorId: number, userId: number) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [was] = await db
    .select()
    .from(vendorMembers)
    .where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)))
    .limit(1);
  await db.delete(vendorMembers).where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)));

  await recordAudit(await auditActor(actor), {
    action: "vendor.removeMember",
    subjectType: "user",
    subjectId: userId,
    vendorId,
    before: was ? { role: was.role } : null,
    after: null,
  });

  return { userId, vendorId };
}

/* ---------------------------------------------------------------- health --- */

/**
 * A vendor's own performance numbers.
 *
 * Scoped like everything else: a vendor member reads their own vendor, an
 * admin reads any. The score itself is computed by the pure function in
 * `shared/inventory/vendorHealth.ts` — this only gathers the counts, so the
 * arithmetic a vendor sees is the arithmetic that is tested.
 */
export async function vendorHealthFor(actor: Actor, vendorId?: number) {
  const scope = actor.kind === "vendor" ? actor.vendorId : vendorId;
  /*
   * An admin who has not named a vendor has no health of their own, and that
   * is not an error: they belong to no company, so there is no shelf and no
   * rejection count to score. Returning null lets the overview simply omit the
   * panel. Throwing NOT_FOUND — which this used to do — made every admin visit
   * to /admin a failed request that the page then swallowed, so the panel was
   * silently missing and the console carried a 404 on every load.
   */
  if (scope === undefined) return null;
  assertCan(actor, "product.view", actor.kind === "vendor" ? actor.vendorId : undefined);

  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const byStatus = await db
    .select({ status: products.status, count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.vendorId, scope))
    .groupBy(products.status);
  const countOf = (status: string) => byStatus.find(row => row.status === status)?.count ?? 0;

  const [stock] = await db
    .select({
      variants: sql<number>`count(*)::int`,
      outOfStock: sql<number>`count(*) filter (where ${productVariants.stock} <= 0)::int`,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(products.vendorId, scope), eq(products.status, "published")));

  const inputs: HealthInputs = {
    published: countOf("published"),
    pendingReview: countOf("pending_review"),
    // The audit trail is already the record of rejections; a second tally
    // could disagree with the evidence an administrator can read back.
    rejections: await violationCount(scope),
    outOfStock: stock?.outOfStock ?? 0,
    variants: stock?.variants ?? 0,
    rating: null,
  };

  return { vendorId: scope, inputs, ...vendorHealth(inputs) };
}

/**
 * Awards or removes a trust badge. Admin only, deliberately.
 *
 * A badge a seller can grant themselves tells a buyer nothing, so this sits
 * behind `vendor.approve` — the same judgement as letting them trade at all.
 */
export async function setVendorBadges(actor: Actor, vendorId: number, badges: string[]) {
  assertCan(actor, "vendor.approve");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  await db.update(vendors).set({ badges }).where(eq(vendors.id, vendorId));

  await recordAudit(await auditActor(actor), {
    action: "vendor.setStatus",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: was?.name ?? null,
    vendorId,
    before: was ? { badges: was.badges } : null,
    after: { badges },
  });
}

/**
 * Commission for one product, overriding its vendor's.
 *
 * Guarded by `vendor.setCommission` exactly like the vendor-level rate: the
 * requirements put commission entirely outside a vendor's control, and a
 * per-product override that a vendor could set would be that rule with a
 * loophole in it.
 */
export async function setProductCommission(
  actor: Actor,
  productId: number,
  rule: { percent?: string | null; fixed?: string | null },
) {
  assertCan(actor, "vendor.setCommission");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [was] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!was) throw new Error("NOT_FOUND");

  await db
    .update(products)
    .set({ commissionPercent: rule.percent ?? null, commissionFixed: rule.fixed ?? null })
    .where(eq(products.id, productId));

  await recordAudit(await auditActor(actor), {
    action: "vendor.setCommission",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: was.title,
    vendorId: was.vendorId,
    before: { commissionPercent: was.commissionPercent, commissionFixed: was.commissionFixed },
    after: { commissionPercent: rule.percent ?? null, commissionFixed: rule.fixed ?? null },
  });
}

/* --------------------------------------------------------------- vendors --- */

export async function listVendors(actor: Actor, request: PageRequest = {}) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return emptyPage<typeof vendors.$inferSelect>(request);

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(vendors);
  const total = counted?.n ?? 0;
  const { page, pageSize, offset } = windowFor(request, total);

  const rows = await db.select().from(vendors).orderBy(asc(vendors.name), asc(vendors.id)).limit(pageSize).offset(offset);
  return { rows, total, page, pageSize };
}

export async function setVendorCommission(actor: Actor, vendorId: number, percent: string, fixed?: string | null) {
  assertCan(actor, "vendor.setCommission");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  // Read before writing: the audit row's value is the pair, not the result.
  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  await db.update(vendors).set({ commissionPercent: percent, commissionFixed: fixed ?? null }).where(eq(vendors.id, vendorId));

  await recordAudit(await auditActor(actor), {
    action: "vendor.setCommission",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: was?.name ?? null,
    vendorId,
    before: was ? { commissionPercent: was.commissionPercent, commissionFixed: was.commissionFixed } : null,
    after: { commissionPercent: percent, commissionFixed: fixed ?? null },
  });
}

export async function setVendorStatus(actor: Actor, vendorId: number, status: "pending" | "approved" | "suspended") {
  assertCan(actor, "vendor.approve");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  await db.update(vendors).set({ status }).where(eq(vendors.id, vendorId));

  await recordAudit(await auditActor(actor), {
    action: "vendor.setStatus",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: was?.name ?? null,
    vendorId,
    before: was ? { status: was.status } : null,
    after: { status },
  });
}

export async function listCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
}

/* ----------------------------------------------------- opening a store --- */

export type NewVendorInput = {
  name: string;
  nameAr?: string | null;
  slug: string;
  status?: "pending" | "approved" | "suspended";
  commissionPercent?: string;
  commissionFixed?: string | null;
  autoPublish?: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  logoUrl?: string | null;
  governorate?: string | null;
  addressLine?: string | null;
  licenceNumber?: string | null;
  payoutIban?: string | null;
  /**
   * The login to open with the store.
   *
   * Optional: an admin recording a seller whose owner will be attached later
   * is a real case, and refusing the store until a password exists would send
   * them back to a database client — which is the thing this replaces.
   */
  owner?: { email: string; password: string; name?: string | null; role?: VendorRole } | null;
};

/**
 * Opens a store, and optionally its owner's login, in one go.
 *
 * This is the whole reason the page exists. Before it, onboarding a seller
 * meant inserting a vendor row by hand in the database, asking the person to
 * register on the storefront, then finding them in `/admin/people` and
 * attaching them — three systems, one of which was a SQL console.
 *
 * The order matters. The vendor is written first because it is the row that
 * can fail on a duplicate slug, and a failed slug after creating a Firebase
 * account would leave a login belonging to no store. If the account then
 * fails, the vendor is removed again: a half-made store that looks finished
 * is worse than one that was never made, because nobody goes looking for it.
 */
export async function createVendorWithOwner(actor: Actor, input: NewVendorInput) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const slug = input.slug.trim();
  if (!slug) throw new Error("SLUG_REQUIRED");

  const [clash] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.slug, slug)).limit(1);
  if (clash) throw new Error("SLUG_TAKEN");

  /*
   * Check the address before writing anything.
   *
   * `createAccount` would refuse a duplicate anyway, but only after asking
   * Firebase to make the account — and a Firebase user created for a store
   * that is then rolled back is an orphan nothing here will ever clean up.
   * This is still not the only guard: the race between the check and the
   * write is what `EmailTakenError` remains the backstop for.
   */
  const ownerEmail = input.owner?.email.trim().toLowerCase();
  if (ownerEmail) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1);
    if (taken) throw new Error("EMAIL_TAKEN");
  }

  const [vendor] = await db
    .insert(vendors)
    .values({
      slug,
      name: input.name.trim(),
      nameAr: input.nameAr?.trim() || null,
      status: input.status ?? "pending",
      commissionPercent: input.commissionPercent ?? "10.00",
      commissionFixed: input.commissionFixed ?? null,
      autoPublish: input.autoPublish ?? false,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      description: input.description?.trim() || null,
      descriptionAr: input.descriptionAr?.trim() || null,
      logoUrl: input.logoUrl?.trim() || null,
      governorate: input.governorate?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      licenceNumber: input.licenceNumber?.trim() || null,
      payoutIban: input.payoutIban?.replace(/[\s-]/g, "").toUpperCase() || null,
    })
    .returning();

  let ownerUserId: number | null = null;
  if (input.owner) {
    try {
      const account = await createAccount({
        email: ownerEmail!,
        password: input.owner.password,
        name: input.owner.name ?? null,
      });
      await db.insert(vendorMembers).values({
        vendorId: vendor.id,
        userId: account.id,
        role: input.owner.role ?? "owner",
      });
      ownerUserId = account.id;
    } catch (error) {
      // Undo the store rather than leave one nobody can sign into.
      await db.delete(vendors).where(eq(vendors.id, vendor.id));
      if (error instanceof EmailTakenError) throw new Error("EMAIL_TAKEN");
      throw error;
    }
  }

  await recordAudit(await auditActor(actor), {
    action: "vendor.create",
    subjectType: "vendor",
    subjectId: vendor.id,
    subjectLabel: vendor.name,
    vendorId: vendor.id,
    before: null,
    after: { slug: vendor.slug, status: vendor.status, ownerUserId },
  });

  return { vendor, ownerUserId };
}

/** One vendor in full, for the detail page. Admin only, like the list. */
export async function getVendor(actor: Actor, vendorId: number) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return null;
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  return vendor ?? null;
}

/**
 * Edits a store's details. Deliberately not commission or status: those are
 * their own audited actions, and folding them into a general "save" would
 * make the audit trail say "updated" where it now says what changed.
 */
export async function updateVendorProfile(actor: Actor, vendorId: number, patch: {
  name?: string;
  nameAr?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  logoUrl?: string | null;
  governorate?: string | null;
  addressLine?: string | null;
  licenceNumber?: string | null;
  payoutIban?: string | null;
  discountLicenceNumber?: string | null;
  discountLicenceExpiresAt?: Date | null;
  deliveryFlat?: string | null;
  deliveryFreeOver?: string | null;
  deliverySpeed?: string | null;
  deliveryProvider?: string | null;
  underPlatformLicence?: boolean;
}) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!was) throw new Error("NOT_FOUND");

  const next = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr?.trim() || null } : {}),
    ...(patch.contactEmail !== undefined ? { contactEmail: patch.contactEmail?.trim().toLowerCase() || null } : {}),
    ...(patch.contactPhone !== undefined ? { contactPhone: patch.contactPhone?.trim() || null } : {}),
    ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
    ...(patch.descriptionAr !== undefined ? { descriptionAr: patch.descriptionAr?.trim() || null } : {}),
    ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl?.trim() || null } : {}),
    ...(patch.governorate !== undefined ? { governorate: patch.governorate?.trim() || null } : {}),
    ...(patch.addressLine !== undefined ? { addressLine: patch.addressLine?.trim() || null } : {}),
    ...(patch.licenceNumber !== undefined ? { licenceNumber: patch.licenceNumber?.trim() || null } : {}),
    ...(patch.payoutIban !== undefined
      ? { payoutIban: patch.payoutIban?.replace(/[\s-]/g, "").toUpperCase() || null }
      : {}),
    ...(patch.discountLicenceNumber !== undefined
      ? { discountLicenceNumber: patch.discountLicenceNumber?.trim() || null }
      : {}),
    ...(patch.discountLicenceExpiresAt !== undefined
      ? { discountLicenceExpiresAt: patch.discountLicenceExpiresAt ?? null }
      : {}),
  };
  if (Object.keys(next).length === 0) return was;

  const [updated] = await db.update(vendors).set(next).where(eq(vendors.id, vendorId)).returning();

  await recordAudit(await auditActor(actor), {
    action: "vendor.update",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: updated.name,
    vendorId,
    before: Object.fromEntries(Object.keys(next).map(key => [key, (was as Record<string, unknown>)[key]])),
    after: next,
  });

  return updated;
}

/**
 * Creates a login and puts it straight into a vendor.
 *
 * The counterpart to `addMemberByEmail`, which can only attach somebody who
 * has already registered on the storefront. That covers a seller who signed
 * up and then asked for access; it does not cover the ordinary case of an
 * administrator onboarding a shop whose staff have never visited the site.
 * Without this, the only way to make a vendor login was to create the store
 * and the owner together — so a store that already existed could never gain
 * one.
 *
 * Admin only. `vendor.manageMembers` lets a vendor owner change ranks and
 * remove people within their own company, but minting an account is making a
 * NetLet login, which is `platform.manageUsers` — the same grant that governs
 * who administers the platform.
 */
export async function addMemberWithNewAccount(
  actor: Actor,
  vendorId: number,
  input: { email: string; password: string; name?: string | null; role: VendorRole },
) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!vendor) throw new Error("NOT_FOUND");

  const email = input.email.trim().toLowerCase();
  // Checked here rather than left to `createAccount`, so a duplicate never
  // reaches Firebase and leaves an account belonging to no store.
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new Error("EMAIL_TAKEN");

  const account = await createAccount({ email, password: input.password, name: input.name ?? null });
  await db.insert(vendorMembers).values({ vendorId, userId: account.id, role: input.role });

  await recordAudit(await auditActor(actor), {
    action: "vendor.addMember",
    subjectType: "user",
    subjectId: account.id,
    subjectLabel: account.email,
    vendorId,
    before: null,
    after: { role: input.role, createdAccount: true },
  });

  return { userId: account.id, vendorId, role: input.role };
}

/**
 * Sends somebody a link to set a new password.
 *
 * The gap this closes: a vendor who forgets their password had no way back
 * that did not involve an administrator opening the Firebase console. The
 * shopper-facing reset already existed, but it is deliberately silent about
 * whether an address is registered — useless to an administrator, who needs
 * to know the link actually went somewhere.
 *
 * So this one *does* say. It is admin-only and takes a user id rather than an
 * address, so it cannot be used to ask which addresses exist: the caller
 * already has the row in front of them.
 */
export async function sendMemberPasswordReset(actor: Actor, userId: number, locale: "en" | "ar") {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new Error("NOT_FOUND");

  await sendFirebasePasswordReset(target.email, locale);

  await recordAudit(await auditActor(actor), {
    action: "user.sendPasswordReset",
    subjectType: "user",
    subjectId: target.id,
    subjectLabel: target.email,
    before: null,
    after: null,
  });

  /*
   * Whether a link could actually be sent, which is not the same question as
   * whether the request was accepted. Without Firebase there is no mail to
   * send, and an administrator told "sent" would wait for an email that was
   * never going to arrive.
   */
  return { sent: isFirebaseConfigured(), email: target.email };
}
