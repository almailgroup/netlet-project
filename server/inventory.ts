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
import { warrantyRequired } from "../shared/inventory/productDraft.js";
import { merchantWarranty } from "../shared/commerce/productDetail.js";
import { stockMoveProblem, type StockReason } from "../shared/inventory/stockMoves.js";
import { optionPairs, optionPairsProblem, optionsRecord } from "../shared/inventory/variantOptions.js";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  categories,
  followedProducts,
  productAddons,
  productImages,
  products,
  productStatus,
  productVariants,
  stockMovements,
  users,
  courierMembers,
  vendorMembers,
  vendors,
} from "../drizzle/schema.js";
import { assertCan, type Actor, type VendorRole } from "../shared/inventory/permissions.js";
import { DEFAULT_COMMISSION_PERCENT } from "../shared/inventory/commission.js";
import { ADDON_KINDS, isSellableAddon, type AddonKind } from "../shared/commerce/addons.js";
import { discountAllowed, isOffer } from "../shared/inventory/discountLicence.js";
import { violatesUnique } from "./_core/describeError.js";
import { recordAudit, violationCount } from "./audit.js";
import { memberPriceProblem } from "../shared/commerce/membership.js";
import { isValidMeasure, type SellUnit } from "../shared/commerce/units.js";
import { awardedBadges, vendorHealth, type HealthInputs } from "../shared/inventory/vendorHealth.js";
import { getDb } from "./db.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { createAccount, EmailTakenError } from "./_core/accounts.js";
import { canSendReset, deleteLogin, sendReset } from "./_core/passwordStore.js";
import { chartProblem, cleanChart, type SizeChart } from "../shared/commerce/sizeGuide.js";
/* The readable part of a handle, shared so the "Add a product" form's search
   preview shows the address the server will actually make. */
import { handleBase } from "../shared/inventory/productDraft.js";

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

  /*
   * A delivery company's login (2.2, 3.4.2), which is the fifth party the
   * requirements name. Asked only when there is no vendor membership, because
   * the two are different jobs and nobody holds both — and asked *before*
   * falling back to `customer`, or a driver would reach nothing at all.
   */
  if (!membership) {
    const [courier] = await db
      .select({ courierId: courierMembers.courierId })
      .from(courierMembers)
      .where(eq(courierMembers.userId, user.id))
      .limit(1);
    if (courier) return { kind: "courier", userId: user.id, courierId: courier.courierId };
  }

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
 * The product's size chart (3.1.20), or null to remove it. Checked by the
 * same rule the editor uses, beside the query, so a chart posted past the form
 * is refused for the same reason — and stored cleaned, so a range for a
 * column the seller unticked does not linger.
 */
export async function setProductSizeChart(actor: Actor, productId: number, chart: SizeChart | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);
  const cleaned = chart ? cleanChart(chart) : null;
  const problem = cleaned ? chartProblem(cleaned) : null;
  if (problem) throw new Error(problem);
  await db.update(products).set({ sizeChart: cleaned }).where(eq(products.id, productId));
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
export async function myStore(actor: Actor): Promise<{ id: number; name: string; autoPublish: boolean } | null> {
  if (actor.kind !== "vendor") return null;
  assertCan(actor, "vendor.viewMembers", actor.vendorId);
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: vendors.id, name: vendors.name, autoPublish: vendors.autoPublish })
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
export async function auditActor(actor: Actor) {
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
  const [variants, images, addons] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position), asc(productVariants.id)),
    db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.position), asc(productImages.id)),
    /* The optional extras (3.1.2). One query for the page rather than one per
       product, the way the images already are. */
    db.select().from(productAddons).where(inArray(productAddons.productId, ids)).orderBy(asc(productAddons.position), asc(productAddons.id)),
  ]);
  return rows.map(row => ({
    ...row,
    variants: variants.filter(v => v.productId === row.id),
    images: images.filter(i => i.productId === row.id),
    addons: addons.filter(a => a.productId === row.id),
  }));
}

/**
 * What a shopper may see: published products belonging to approved vendors.
 *
 * Both halves matter. A published product of a suspended vendor must vanish
 * from the storefront without anyone editing the product, which is what makes
 * suspension a real lever.
 */
export async function publishedCatalog(options: { limit?: number; categoryId?: number; ids?: number[] } = {}) {
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
        /* Narrowing to named products still passes every rule above — which is
           the point: a sponsored placement is drawn through this read so a
           paid slot cannot show what the shelf would not (3.3.15). */
        options.ids ? inArray(products.id, options.ids.length ? options.ids : [-1]) : undefined,
      ),
    )
    /* Ends on the id, for the reason `listAudit` does. `updatedAt` is not
       unique — a bulk import gives a hundred rows the same microsecond — and
       Postgres orders ties freely, so with a cap of 100 *which* products the
       shop displays was a coin toss that could change between two page loads.
       This read is the storefront's catalogue, the sitemap and the candidate
       set every recommendation is drawn from. */
    .orderBy(desc(products.updatedAt), desc(products.id))
    .limit(options.limit ?? 100);
  return hydrate(db, rows.map(row => row.p));
}

/**
 * How many products are on sale in each department, by the department's slug.
 *
 * The header, the phone's department sheet and the home tiles all listed every
 * department NetLet knows, so Beauty, Style and Grocery sat in the main
 * navigation leading to empty pages. The same rule as `publishedCatalog` — a
 * published product of an approved store — counted per department, so a link
 * appears exactly when the page behind it has something to show.
 */
export async function publishedDepartmentCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ slug: categories.slug, count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.status, "published"), eq(vendors.status, "approved")))
    .groupBy(categories.slug);
  return Object.fromEntries(rows.map(row => [row.slug, Number(row.count)]));
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
  if (!db) return emptyPage<Awaited<ReturnType<typeof hydrate>>[number] & { vendorName: string | null }>(request);

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
    /* Bracketed: `and` does not wrap a raw fragment, so without them this read
       "this store's and a title match, or any store's handle match" — and a
       seller's search returned every other store's products, drafts included. */
    /* The Arabic title and the seller's own codes too: a seller looking for
       "BATT-1" types the code they filed it under, and half the shelf is
       titled in Arabic. */
    term
      ? sql`(lower(${products.title}) like ${`%${term}%`} or lower(coalesce(${products.titleAr}, '')) like ${`%${term}%`} or ${products.handle} like ${`%${term}%`} or exists (select 1 from ${productVariants} where ${productVariants.productId} = ${products.id} and lower(coalesce(${productVariants.sku}, '')) like ${`%${term}%`}))`
      : undefined,
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
  /* The store's name rather than "#3": an administrator scanning every
     store's shelf reads names, and one query for the page is all it costs. */
  const vendorIds = Array.from(new Set(rows.map(row => row.vendorId)));
  const names = vendorIds.length
    ? await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, vendorIds))
    : [];
  const hydrated = await hydrate(db, rows);
  return {
    rows: hydrated.map(row => ({ ...row, vendorName: names.find(vendor => vendor.id === row.vendorId)?.name ?? null })),
    total,
    page,
    pageSize,
  };
}

export async function getProduct(actor: Actor, productId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) return null;
  // Scope is checked against the product's own vendor, so asking for somebody
  // else's id is a refusal rather than a leak.
  assertCan(actor, "product.view", row.vendorId);
  const [product] = await hydrate(db, [row]);
  /* Whether the shop is withholding this product's saving, and why — so the
     editor can say so beside the price rather than the seller finding out by
     looking at their own shop. */
  return { ...product, offerHidden: await offerHiddenFor(db, productId, row.vendorId) };
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
  const base = handleBase(title);
  const taken = await db.select({ handle: products.handle }).from(products).where(sql`${products.handle} like ${base + "%"}`);
  if (!taken.some(row => row.handle === base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.some(row => row.handle === candidate)) return candidate;
  }
}

/** How many times a write is retried after somebody else took its handle. */
const HANDLE_ATTEMPTS = 8;

/**
 * The seed a handle is made from on a given attempt.
 *
 * The title itself for the first two, so an ordinary collision still gives the
 * readable `brass-lamp-2`. After that a short random tail is added, because the
 * losers of a race all re-read the *same* next free handle and race for it again:
 * six identical titles at once had only one winner per round and the sixth ran
 * out of retries, which a test measured rather than a reading of the code. The
 * tail breaks the symmetry, so every racer makes progress.
 */
function handleSeed(title: string, attempt: number): string {
  if (attempt <= 2) return title;
  const tail = Array.from(randomBytes(3), byte => (byte % 36).toString(36)).join("");
  return `${title} ${tail}`;
}

/**
 * Runs a write that takes a product handle, and runs it again if another write
 * took that handle first.
 *
 * `uniqueHandle` reads what is free and the insert follows, so two sellers
 * listing "iPhone 15 case" in the same moment both read `iphone-15-case-3` as
 * free and both insert it. The unique index is right to refuse the second; what
 * was wrong is that the refusal arrived as a 500 — "duplicate key value violates
 * unique constraint" — for something nobody did wrong. A fuzz found it by
 * creating products in parallel. The write is given a fresh read each time, so
 * the retry sees the row it lost to and takes the next handle along.
 *
 * Only the handle's own violation is retried. Any other unique index refusing
 * is a real conflict and goes out as itself.
 */
async function withFreeHandle<T>(write: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write(attempt);
    } catch (error) {
      if (attempt >= HANDLE_ATTEMPTS || !violatesUnique(error, "products_handle_unique")) throw error;
    }
  }
}

export async function createProduct(actor: Actor, input: {
  vendorId: number;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  categoryId?: number | null;
  tags?: string[];
  /** The seller's warranty as they word it, stored as the Warranty specification row. */
  warranty?: string | null;
  /**
   * The first variant's terms. Absent, the product starts with a "Default" at
   * 0.000, as it always did — the editor's own "New product" path. The guided
   * form sends them, so what it creates is a product with a price, a code and
   * a count rather than a blank draft that is then filled in by five saves.
   */
  variant?: { price: string; compareAtPrice?: string | null; sku?: string | null; stock?: number };
  /** The gallery, in order. Held to the same URL rule as `setProductImages`. */
  images?: { url: string; kind?: "image" | "video" | null; altText?: string | null }[];
}) {
  assertCan(actor, "product.create", input.vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const sku = input.variant?.sku?.trim() || null;
  const opening = input.variant?.stock ?? 0;
  await assertSkuFree(db, input.vendorId, sku);

  /*
   * One transaction, so the form's one press is one outcome. Three writes in a
   * row used to be the shape of "New product" — a draft, then a price, then the
   * pictures — and a failure on the second left a blank "New product" on the
   * shelf that nobody had asked for and nobody went back to delete.
   */
  const row = await withFreeHandle(async attempt => {
    /* Read before the transaction opens, never inside it on the pool: a
       second connection asked for while the first holds a transaction is a
       deadlock on a single-connection database, and a wasted one anywhere. */
    const handle = await uniqueHandle(db, handleSeed(input.title, attempt));
    return skuAware(() => db.transaction(async tx => {
      const [created] = await tx.insert(products).values({
        vendorId: input.vendorId,
        categoryId: input.categoryId ?? null,
        handle,
        title: input.title,
        titleAr: input.titleAr ?? null,
        description: input.description ?? null,
        tags: input.tags ?? [],
        attributes: input.warranty?.trim()
          ? [{ namespace: "specs", key: "warranty", label: "Warranty", value: input.warranty.trim() }]
          : [],
        status: "draft",
      }).returning();

      // A product with no variant cannot be priced or bought, so it starts with
      // one rather than being a shape the rest of the system has to tolerate.
      const [variant] = await tx.insert(productVariants).values({
        productId: created.id,
        title: "Default",
        sku,
        price: input.variant?.price ?? "0.000",
        compareAtPrice: input.variant?.compareAtPrice ?? null,
        stock: opening,
      }).returning({ id: productVariants.id });

      /* An opening count is a movement like any other, so the stock page's
         history starts where the shelf did rather than at a number nobody
         recorded. */
      if (opening > 0) {
        await tx.insert(stockMovements).values({ variantId: variant.id, delta: opening, resulting: opening, reason: "received", note: null, actorId: actor.userId });
      }

      if (input.images?.length) {
        await tx.insert(productImages).values(input.images.map((image, position) => ({
          productId: created.id,
          url: image.url,
          altText: image.altText?.trim() || null,
          position,
          kind: image.kind === "video" ? ("video" as const) : ("image" as const),
        })));
      }
      return created;
    }));
  });

  await recordAudit(await auditActor(actor), {
    action: "product.create",
    subjectType: "product",
    subjectId: row.id,
    subjectLabel: row.title,
    vendorId: row.vendorId,
    after: { title: row.title, price: input.variant?.price ?? "0.000", stock: opening },
  });
  return row;
}

/**
 * Create a whole shelf from a spreadsheet (3.3.3, 3.3.5).
 *
 * `shared/inventory/bulkUpload.ts` has already read the file, found the
 * columns, refused the rows that cannot be products and guessed a department
 * for the ones that left it blank — all of it pure, and all of it shown to the
 * seller before this is called. What is left is the half that needs a
 * database: a unique handle per row, a category id per name, and the writes.
 *
 * **All of it or none of it.** A half-finished import is the worst outcome,
 * because the seller cannot tell what landed and running the corrected file
 * again duplicates whatever did. One transaction, so a failure on row 300
 * leaves the shelf exactly as it was.
 *
 * Every product lands as a **draft**, whatever the file said. Publishing is
 * its own decision with its own rules — a price, and a Ministry permit behind
 * any advertised saving — and an importer that could put four hundred rows
 * straight into the shop is an importer that can put four hundred mistakes
 * there.
 */
export async function bulkCreateProducts(actor: Actor, input: {
  vendorId: number;
  rows: {
    title: string;
    sku: string | null;
    price: string;
    compareAtPrice: string | null;
    stock: number;
    category: string | null;
    description: string;
    imageUrl: string | null;
  }[];
}): Promise<{ created: number }> {
  assertCan(actor, "product.create", input.vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (input.rows.length === 0) return { created: 0 };

  /* One read for every category the file mentions, rather than one per row.
     A name the catalog does not carry leaves the product uncategorised rather
     than creating a department from a typo. */
  const known = await db.select({ id: categories.id, name: categories.name }).from(categories);
  const idFor = (name: string | null) =>
    known.find(row => row.name.toLowerCase() === (name ?? "").toLowerCase())?.id ?? null;

  /*
   * The whole plan is retried, not just the insert that lost: a handle taken
   * by a concurrent create aborts the transaction, and every handle after it
   * was planned against a shelf that has since changed. `withFreeHandle` reads
   * it again and replans.
   */
  return withFreeHandle(async attempt => {
    /*
     * Handles are taken one at a time and remembered, because `uniqueHandle`
     * reads what is committed — and inside a transaction the rows above are not
     * yet visible to it, so a file with two "Brass Lamp"s would ask for the same
     * handle twice and fail the unique index at the very end.
     */
    const taken = new Set<string>();
    /*
     * A handle is ASCII, so a title with none of it — which is half the catalog
     * on a Kuwaiti shop — reduces to the fallback `product`, and importing ten
     * Arabic-titled rows gives `product`, `product-2`, `product-3`. The seller's
     * own code is the better seed: it is Latin by convention, it is unique in
     * the file already, and `imp-buds` is a URL somebody can read.
     *
     * Arabic in the URL itself is the other answer and a larger one — every
     * link, the router and the sitemap would have to agree about percent
     * encoding — so it is deliberately not attempted here.
     */
    const seedFor = (row: { title: string; sku: string | null }) =>
      /[a-z0-9]/i.test(row.title) || !row.sku ? row.title : row.sku;

    const handleFor = async (title: string) => {
      const base = await uniqueHandle(db, handleSeed(title, attempt));
      let handle = base;
      for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`;
      taken.add(handle);
      return handle;
    };

    const planned = [] as { handle: string; row: (typeof input.rows)[number] }[];
    for (const row of input.rows) planned.push({ handle: await handleFor(seedFor(row)), row });

    /*
     * The same SKU rule the editor applies, at the other door onto the shelf.
     *
     * Both the file and the shelf are checked, because a spreadsheet naming one
     * code twice is as much a mistake as one naming a code already in use — and
     * the per-product index cannot catch either, since every row here becomes a
     * new product. Left out, the two doors would disagree: typing a duplicate
     * into the editor is refused while pasting it in a file is not.
     *
     * The whole file is refused rather than the offending rows skipped, which is
     * what the transaction below already promises: a seller who fixes one cell
     * and imports again knows what they have, where a partial import leaves them
     * guessing which rows landed.
     */
    const codes = new Set<string>();
    for (const { row } of planned) {
      const sku = row.sku?.trim() || null;
      if (!sku) continue;
      if (codes.has(sku)) throw new Error("SKU_TAKEN");
      codes.add(sku);
      await assertSkuFree(db, input.vendorId, sku);
    }

    await db.transaction(async tx => {
      for (const { handle, row } of planned) {
        const [product] = await tx.insert(products).values({
          vendorId: input.vendorId,
          categoryId: idFor(row.category),
          handle,
          title: row.title,
          description: row.description || null,
          tags: [],
          status: "draft",
        }).returning({ id: products.id });

        await tx.insert(productVariants).values({
          productId: product.id,
          title: "Default",
          sku: row.sku,
          price: row.price,
          compareAtPrice: row.compareAtPrice,
          stock: row.stock,
        });

        /* A picture is optional and a bad URL is ordinary — `Thumb` swaps a
           failing image for a fallback, which is why one typed into a
           spreadsheet is worth storing rather than validating away. */
        if (row.imageUrl) {
          await tx.insert(productImages).values({ productId: product.id, url: row.imageUrl, position: 0 });
        }
      }
    });

    return { created: planned.length };
  });
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

  /*
   * A product's address follows its name until anybody can see it. Every
   * product starts as "New product", so every one was `new-product`,
   * `new-product-2`… for ever, because the handle was chosen at creation and
   * never again. A draft or a product in review has no public page and no
   * link anybody has shared, so its handle is re-made from the new title on
   * the save that renames it. A published one keeps its address here: moving
   * it needs the old one to redirect, which is a table of its own.
   */
  const renamed = patch.title !== undefined && patch.title.trim() !== row.title.trim();
  const base = renamed ? handleBase(patch.title!) : null;
  const keepsHandle = !base || row.status === "published" || row.handle === base || new RegExp(`^${base}-[a-z0-9]+$`).test(row.handle);
  if (keepsHandle) {
    await db.update(products).set(patch).where(eq(products.id, productId));
  } else {
    await withFreeHandle(async attempt => db.update(products)
      .set({ ...patch, handle: await uniqueHandle(db, handleSeed(patch.title!, attempt)) })
      .where(eq(products.id, productId)));
  }
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
/**
 * Replace the optional extras a product offers (3.1.2).
 *
 * The whole list at once, the way the images are, because these are read as a
 * set and a per-row endpoint turns "the seller changed their mind about the
 * order of two things" into four calls.
 *
 * **A free extra is refused here**, not hidden on the page: an extra that adds
 * nothing to the total is a feature of the product, and a check box that
 * changes no figure is the dead-control rule. The guard is beside the query
 * rather than in the router alone, for the reason every other guard here is.
 */
export async function setProductAddons(
  actor: Actor,
  productId: number,
  addons: { kind: string; label: string; labelAr?: string | null; price: string }[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) throw new Error("NOT_FOUND");
  assertCan(actor, "product.edit", row.vendorId);

  const sellable = addons.filter(addon => isSellableAddon(addon));
  if (sellable.length !== addons.length) throw new Error("ADDON_NOT_SELLABLE");

  await db.delete(productAddons).where(eq(productAddons.productId, productId));
  if (sellable.length) {
    await db.insert(productAddons).values(
      sellable.map((addon, position) => ({
        productId,
        kind: ADDON_KINDS.includes(addon.kind as AddonKind) ? addon.kind : "other",
        label: addon.label.trim(),
        labelAr: addon.labelAr?.trim() || null,
        price: addon.price,
        position,
      })),
    );
  }
  return getProduct(actor, productId);
}

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
/**
 * An electronics listing goes on the shelf with its warranty stated
 * (`warrantyRequired`). Checked at the same two doors as the price, for the
 * same reason: a refusal at one door and not the other is no refusal.
 */
async function assertWarrantyStated(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, productId: number) {
  const [row] = await db
    .select({ attributes: products.attributes, slug: categories.slug })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, productId))
    .limit(1);
  if (row && warrantyRequired(row.slug) && !merchantWarranty(row.attributes ?? [])) throw new Error("NO_WARRANTY");
}

async function assertPriced(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, productId: number) {
  const rows = await db
    .select({ id: productVariants.id, price: productVariants.price })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  if (rows.length === 0) throw new Error("UNPRICED");
  if (rows.some(row => Number.parseFloat(row.price) <= 0)) throw new Error("UNPRICED");
}

/**
 * Run a variant write, turning the SKU index's refusal into one of ours.
 *
 * `assertSkuFree` below catches this a moment earlier and with the better
 * grain, so reaching here means two writes raced. The index is what actually
 * holds the line; this is what keeps the answer a refusal the seller can read
 * rather than "duplicate key value violates unique constraint".
 */
async function skuAware<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (violatesUnique(error, "product_variants_product_sku_unique")) throw new Error("SKU_TAKEN");
    throw error;
  }
}

/**
 * Is this SKU free across the whole of this seller's shelf?
 *
 * A SKU is how a seller finds one variant among thousands, so two of their own
 * products carrying the same one makes that lookup ambiguous — a real mistake,
 * worth telling them about. It is *not* checked across sellers: a SKU is the
 * seller's own code, "BATT-1" is what two independent shops would both reach
 * for, and a marketplace that let the first to type it own the string forever
 * is refusing a listing over somebody else's filing.
 *
 * The check is here rather than in the router for the reason every other guard
 * in this file is, and the vendor grain is here rather than in an index because
 * an index cannot reach through `products` to `vendor_id`. What the index does
 * hold is the per-product case, which is the one two tabs could race; a seller
 * beating this check by one browser tab ends up with the same code on two of
 * their products, which is untidy rather than expensive.
 */
async function assertSkuFree(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  vendorId: number | null,
  sku: string | null,
  exceptVariantId?: number,
) {
  if (!sku) return;
  const clash = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(productVariants.sku, sku),
      vendorId === null ? isNull(products.vendorId) : eq(products.vendorId, vendorId),
      exceptVariantId === undefined ? undefined : ne(productVariants.id, exceptVariantId),
    ))
    .limit(1);
  if (clash.length) throw new Error("SKU_TAKEN");
}

/**
 * Why this product's saving is not shown in the shop, or null when it is (or
 * when it has none to show).
 *
 * Kuwaiti law needs a Ministry of Commerce discount permit before a shop may
 * *advertise* a saving, and the storefront enforces that on every read:
 * `fromInventory` drops `compareAtPrice` while the store's permit is not valid,
 * so the strikethrough, the badge and the savings line never reach a shopper
 * without one. That read is the whole of the law's protection.
 *
 * Publishing used to refuse an offer without a permit as well, and that was a
 * second rule in the wrong place: it stopped a store selling a product at its
 * ordinary price because of a was-price nobody would have been shown — the
 * product "sells at its price but stops showing a discount", which is what the
 * store's own permit field has always said. So this answers instead of
 * throwing, and the editor says it beside the product for as long as it holds.
 * The was-price stays saved, and appears by itself once a valid permit is
 * recorded, because the read decides that and not the write.
 */
async function offerHiddenFor(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  productId: number,
  vendorId: number,
): Promise<"missing" | "expired" | null> {
  const rows = await db
    .select({ price: productVariants.price, compareAtPrice: productVariants.compareAtPrice })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  if (!rows.some(row => isOffer(row.price, row.compareAtPrice))) return null;

  const vendor = (await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1))[0];
  const verdict = discountAllowed({
    number: vendor?.discountLicenceNumber,
    expiresAt: vendor?.discountLicenceExpiresAt,
  });
  // The reason travels, so the portal can say "expired" rather than "no".
  return verdict.allowed ? null : verdict.reason;
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
    await assertWarrantyStated(db, productId);
  }

  let status: typeof row.status = target;
  if (target === "published" && actor.kind === "vendor") {
    const vendor = (await db.select().from(vendors).where(eq(vendors.id, row.vendorId)).limit(1))[0];
    status = vendor?.autoPublish ? "published" : "pending_review";
  }

  await db.update(products).set({ status, reviewNote: reviewNote ?? null }).where(eq(products.id, productId));
  /* Named in `SELLER_ACTIONS` from the start and never written, so "what the
     sellers changed" could not show a product going live or coming down. */
  if (status !== row.status) {
    await recordAudit(await auditActor(actor), {
      action: "product.setStatus",
      subjectType: "product",
      subjectId: productId,
      subjectLabel: row.title,
      vendorId: row.vendorId,
      before: { status: row.status },
      after: { status },
    });
  }
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
  // against an unpriced product too — an admin approving is publishing. A
  // missing discount permit does not shut it: the read hides the saving
  // (`offerHiddenFor`), and the product sells at its price.
  if (approve) {
    await assertPriced(db, productId);
    await assertWarrantyStated(db, productId);
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
export async function adjustStock(actor: Actor, variantId: number, delta: number, reason: StockReason, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const problem = stockMoveProblem(delta, reason);
  if (problem) throw new Error(problem);

  const variant = (await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1))[0];
  if (!variant) throw new Error("NOT_FOUND");
  const product = (await db.select().from(products).where(eq(products.id, variant.productId)).limit(1))[0];
  if (!product) throw new Error("NOT_FOUND");
  assertCan(actor, "stock.adjust", product.vendorId);
  /*
   * Under a row lock, so a checkout taking units between the read and the
   * write cannot be undone by it: this used to read the level, add the delta
   * in JavaScript and write the total back outside any lock, which put sold
   * units back on the shelf whenever the two raced. The take is an `UPDATE`
   * on the same row, so it waits for this.
   */
  const { before, resulting } = await db.transaction(async tx => {
    const [row] = await tx
      .select({ stock: productVariants.stock, centreId: productVariants.centreId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .for("update");
    if (!row) throw new Error("NOT_FOUND");
    /* NetLet's shelf is counted by NetLet (4.2): a seller cannot type a number
       into a warehouse they are not standing in. Asked under the lock, so a
       receipt handing the variant over cannot slip in between. */
    if (row.centreId !== null && actor.kind !== "admin") throw new Error("fulfilment.netletHolds");
    const level = Math.max(0, row.stock + delta);
    await tx.update(productVariants).set({ stock: level }).where(eq(productVariants.id, variantId));
    return { before: row.stock, resulting: level };
  });
  /* Taking five off a shelf already at zero changed nothing, and a movement
     of nothing is noise in the one log that explains the number. */
  if (resulting === before) return resulting;
  await db.insert(stockMovements).values({
    variantId,
    // The recorded delta is what actually happened, not what was asked for, so
    // a clamped adjustment does not leave the history disagreeing with the level.
    delta: resulting - before,
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
  /** A member's price (4.1). Undefined leaves it as it is; null clears it. */
  memberPrice?: string | null;
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

  /* Below the shelf, or not at all (4.1): the same rule the editor's field asks. */
  if (input.memberPrice !== undefined) {
    const problem = memberPriceProblem(input.price, input.memberPrice);
    if (problem) throw new Error(problem);
  }

  if (input.options !== undefined) {
    const problem = optionPairsProblem(optionPairs(input.options));
    if (problem) throw new Error(problem);
  }

  const sku = input.sku?.trim() || null;
  await assertSkuFree(db, product.vendorId, sku, input.id);

  const values = {
    productId: input.productId,
    title: input.title,
    sku,
    price: input.price,
    compareAtPrice: input.compareAtPrice ?? null,
    /* Absent leaves them as they are: the editor saved a price without its
       options for a long time, and every such save emptied them. */
    ...(input.options !== undefined ? { options: optionsRecord(optionPairs(input.options)) } : {}),
    unit: measure.unit,
    stepAmount: String(measure.stepAmount),
    preorderStock,
    preorderReleaseAt: input.preorderReleaseAt ?? null,
    ...(input.memberPrice !== undefined ? { memberPrice: input.memberPrice } : {}),
  };
  if (input.id) {
    // Bound to a const because the write below runs inside a closure, where
    // the narrowing this `if` just established does not reach.
    const variantId = input.id;
    // A price change is singled out because the requirements want every one
    // visible to the admin. The row says what it moved from and to.
    const [was] = await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
    /* A pre-order is a promise about units nobody holds yet, and NetLet's
       shelf holds only what NetLet counted in (4.2). */
    if (was && was.centreId !== null && preorderStock > 0) throw new Error("fulfilment.noPreorder");
    /*
     * Stock is not written here, ever, on an existing variant. It moves by a
     * delta with a reason (`adjustStock`), a sale or a receipt. This wrote
     * `input.stock ?? 0`, and the editor sends no stock when it saves a price
     * or a title — so every variant edit emptied the shelf, silently, and the
     * product read "sold out" until somebody noticed and typed the count back.
     */
    await skuAware(() => db.update(productVariants).set(values).where(eq(productVariants.id, variantId)));
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
  const [row] = await skuAware(() => db.insert(productVariants).values({ options: {}, ...values, stock: input.stock ?? 0 }).returning());
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
  const was = await db.transaction(async tx => {
    if (role !== "owner") await assertKeepsAnOwner(tx, vendorId, userId);
    const [before] = await tx
      .select({ role: vendorMembers.role })
      .from(vendorMembers)
      .where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)))
      .limit(1);
    await tx
      .insert(vendorMembers)
      .values({ vendorId, userId, role })
      .onConflictDoUpdate({ target: [vendorMembers.vendorId, vendorMembers.userId], set: { role } });
    return before ?? null;
  });
  /* Who may act for a store is the sensitive operation 3.3.9 names; the
     administrator's door onto the same rows was audited and the store's own
     team page was not, so an owner's changes left no trace. */
  if (was?.role !== role) {
    await recordAudit(await auditActor(actor), {
      action: "vendor.addMember",
      subjectType: "user",
      subjectId: userId,
      subjectLabel: await emailOf(db, userId),
      vendorId,
      before: was ? { role: was.role } : null,
      after: { role },
    });
  }
  return listMembers(actor, vendorId);
}

export async function removeMember(actor: Actor, vendorId: number, userId: number) {
  assertCan(actor, "vendor.manageMembers", vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const was = await db.transaction(async tx => {
    await assertKeepsAnOwner(tx, vendorId, userId);
    const [removed] = await tx
      .delete(vendorMembers)
      .where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)))
      .returning({ role: vendorMembers.role });
    return removed ?? null;
  });
  if (was) {
    await recordAudit(await auditActor(actor), {
      action: "vendor.removeMember",
      subjectType: "user",
      subjectId: userId,
      subjectLabel: await emailOf(db, userId),
      vendorId,
      before: { role: was.role },
      after: null,
    });
  }
  return listMembers(actor, vendorId);
}

async function emailOf(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.email ?? null;
}

/**
 * A store keeps at least one owner.
 *
 * Demoting or removing the only one left the store with nobody who can run its
 * team — an owner doing it to themselves by accident locked their own staff out
 * of the people page, and only an administrator could put it back. The same
 * reason `/admin/people` refuses removing the last administrator. The store's
 * row is locked first, so two owners demoting each other at once cannot both
 * see the other as the one who stays.
 */
type Tx = Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0];

async function assertKeepsAnOwner(tx: Tx, vendorId: number, userId: number) {
  await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).for("update");
  const owners = await tx
    .select({ userId: vendorMembers.userId })
    .from(vendorMembers)
    .where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.role, "owner")));
  if (owners.length === 1 && owners[0].userId === userId) throw new Error("admin.lastOwner");
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
  /**
   * Shoppers waiting to hear it is back (3.1.1) — the half of "vendor sees
   * demand" that was missing: the count was only ever drawn for shoppers.
   * Per product, because a follow is on a product; a number, never who.
   */
  waiting: number;
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
  /* Parenthesised, and that is the whole safety property: drizzle's `and`
     does not wrap the conditions it joins, so without the brackets this read
     "this store's AND at zero, OR under threshold anywhere" and listed every
     other store's low variants to a vendor. */
  const isLow = and(
    mine,
    sql`(${productVariants.stock} <= 0 or (${productVariants.lowStockAt} is not null and ${productVariants.stock} <= ${productVariants.lowStockAt}))`,
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
      waiting: sql<number>`(select count(*)::int from ${followedProducts} where ${followedProducts.productId} = ${products.id}::text and ${followedProducts.backInStock})`,
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
    /* And here, which is the `listAudit` case exactly: a bulk adjustment
       writes several rows in one request, they tie on `createdAt`, and "the
       most recent movement" was whichever Postgres felt like. */
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
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
    ? sql`(lower(${users.email}) like ${`%${term}%`} or lower(coalesce(${users.name}, '')) like ${`%${term}%`})`
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

  if (!isAdmin && target.id === actor.userId) throw new Error("CANNOT_DEMOTE_SELF");

  await db.transaction(async tx => {
    if (!isAdmin) {
      /* The administrators' rows are locked before they are counted. Counted
         without, two administrators revoking each other at the same moment
         each saw two and each went ahead, leaving none — the one state this
         rule exists to make impossible. Locked, the second waits, then finds
         one. */
      const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).for("update");
      if (admins.length <= 1 && admins.some(row => row.id === userId)) throw new Error("LAST_ADMIN");
    }
    await tx.update(users).set({ role: isAdmin ? "admin" : "user" }).where(eq(users.id, userId));
  });

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

  await db.transaction(async tx => {
    /* Adding somebody already in the store sets their rank, so this door can
       demote the only owner as surely as the team page can. */
    if (role !== "owner") await assertKeepsAnOwner(tx, vendorId, target.id);
    await tx
      .insert(vendorMembers)
      .values({ vendorId, userId: target.id, role })
      .onConflictDoUpdate({ target: [vendorMembers.vendorId, vendorMembers.userId], set: { role } });
  });

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
  await db.transaction(async tx => {
    await assertKeepsAnOwner(tx, vendorId, userId);
    await tx.delete(vendorMembers).where(and(eq(vendorMembers.vendorId, vendorId), eq(vendorMembers.userId, userId)));
  });

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
 * Only `verified` is awarded at all: the others are measured on the read, and
 * one typed in here would be a claim with nothing behind it. Filtered here as
 * well as in the router's schema, for the reason every guard lives beside its
 * query.
 */
export async function setVendorBadges(actor: Actor, vendorId: number, requested: string[]) {
  assertCan(actor, "vendor.approve");
  const badges = awardedBadges(requested);
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

export const VENDOR_STATUSES = ["pending", "approved", "suspended"] as const;

/**
 * Every store, paged, with what an administrator scans the list for: how many
 * products each has and how many of them are live, and how many people can
 * sign in for it.
 *
 * Searching and the status filter happen here rather than over the loaded
 * page, for the reason product search does: a filter over one page answers
 * "no matches" for a store on the next. `counts` is per status over the whole
 * table, so the filter can say how many each would show before it is pressed.
 */
export async function listVendors(
  actor: Actor,
  request: PageRequest & { query?: string; status?: (typeof VENDOR_STATUSES)[number] } = {},
) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  type Row = typeof vendors.$inferSelect & { productCount: number; liveCount: number; memberCount: number };
  const noCounts = { all: 0, pending: 0, approved: 0, suspended: 0 };
  if (!db) return { ...emptyPage<Row>(request), counts: noCounts };

  const term = request.query?.trim().toLowerCase();
  const scope = and(
    request.status ? eq(vendors.status, request.status) : undefined,
    /* Bracketed, for the reason every `or` fragment here is. */
    term
      ? sql`(lower(${vendors.name}) like ${`%${term}%`} or lower(coalesce(${vendors.nameAr}, '')) like ${`%${term}%`} or ${vendors.slug} like ${`%${term}%`} or lower(coalesce(${vendors.contactEmail}, '')) like ${`%${term}%`})`
      : undefined,
  );

  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(vendors).where(scope);
  const total = counted?.n ?? 0;
  const { page, pageSize, offset } = windowFor(request, total);

  const rows = await db.select().from(vendors).where(scope).orderBy(asc(vendors.name), asc(vendors.id)).limit(pageSize).offset(offset);
  const ids = rows.map(row => row.id);
  const [catalogue, teams, byStatus] = await Promise.all([
    ids.length
      ? db
        .select({
          vendorId: products.vendorId,
          all: sql<number>`count(*)::int`,
          live: sql<number>`count(*) filter (where ${products.status} = 'published')::int`,
        })
        .from(products)
        .where(inArray(products.vendorId, ids))
        .groupBy(products.vendorId)
      : [],
    ids.length
      ? db
        .select({ vendorId: vendorMembers.vendorId, n: sql<number>`count(*)::int` })
        .from(vendorMembers)
        .where(inArray(vendorMembers.vendorId, ids))
        .groupBy(vendorMembers.vendorId)
      : [],
    db.select({ status: vendors.status, n: sql<number>`count(*)::int` }).from(vendors).groupBy(vendors.status),
  ]);

  const counts = { ...noCounts };
  for (const entry of byStatus) {
    counts[entry.status as keyof typeof counts] = entry.n;
    counts.all += entry.n;
  }
  return {
    rows: rows.map(row => {
      const shelf = catalogue.find(entry => entry.vendorId === row.id);
      return {
        ...row,
        productCount: shelf?.all ?? 0,
        liveCount: shelf?.live ?? 0,
        memberCount: teams.find(entry => entry.vendorId === row.id)?.n ?? 0,
      };
    }),
    total,
    page,
    pageSize,
    counts,
  };
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

export type NewVendorInput = StoreDetailsPatch & {
  name: string;
  slug: string;
  status?: "pending" | "approved" | "suspended";
  commissionPercent?: string;
  commissionFixed?: string | null;
  autoPublish?: boolean;
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
 * can fail on a duplicate slug, and a failed slug after creating the credential
 * would leave a login belonging to no store. If the account then
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
   * Supabase Auth to make the account — and a credential created for a store
   * that is then rolled back is an orphan on the Authentication page.
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
      status: input.status ?? "pending",
      commissionPercent: input.commissionPercent ?? DEFAULT_COMMISSION_PERCENT,
      commissionFixed: input.commissionFixed ?? null,
      autoPublish: input.autoPublish ?? false,
      /* Everything else the form can hold — see `storeDetailColumns`. What is
         absent takes the column's own default, so a store opened without a
         word about cash still accepts it. */
      ...storeDetailColumns(input),
    })
    .returning();

  let ownerUserId: number | null = null;
  if (input.owner) {
    /* Held outside the try so the catch can undo it. The account is made before
       the membership that gives it a reason to exist, and if that insert fails
       the login is left over — which with the credential in Supabase Auth means
       a row on the Authentication page for a store that no longer exists, on the
       one page somebody looks at to see who has an account. */
    let account: Awaited<ReturnType<typeof createAccount>> | null = null;
    try {
      account = await createAccount({
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
      // Undo the store rather than leave one nobody can sign into, and the
      // login with it rather than leave one that signs into nothing.
      await db.delete(vendors).where(eq(vendors.id, vendor.id));
      if (account) await deleteLogin(account);
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
  if (!vendor) return null;
  /* The figures the store's page opens on: what is on its shelf, what is
     waiting for somebody, and who can sign in for it. */
  const [[shelf], [team]] = await Promise.all([
    db
      .select({
        all: sql<number>`count(*)::int`,
        live: sql<number>`count(*) filter (where ${products.status} = 'published')::int`,
        review: sql<number>`count(*) filter (where ${products.status} = 'pending_review')::int`,
        drafts: sql<number>`count(*) filter (where ${products.status} = 'draft')::int`,
      })
      .from(products)
      .where(eq(products.vendorId, vendorId)),
    db.select({ n: sql<number>`count(*)::int` }).from(vendorMembers).where(eq(vendorMembers.vendorId, vendorId)),
  ]);
  return {
    ...vendor,
    stats: {
      products: shelf?.all ?? 0,
      live: shelf?.live ?? 0,
      inReview: shelf?.review ?? 0,
      drafts: shelf?.drafts ?? 0,
      members: team?.n ?? 0,
    },
  };
}

/**
 * Whether this store's products go live without review (3.3.7).
 *
 * It could only be set when the store was opened, so a store that earned the
 * trust later — or lost it — needed a database client. It is the review
 * queue's own decision moved earlier, so it needs what the review queue needs,
 * and the trail records it as a change to the store.
 */
export async function setVendorAutoPublish(actor: Actor, vendorId: number, autoPublish: boolean) {
  assertCan(actor, "product.review");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!was) throw new Error("NOT_FOUND");
  if (was.autoPublish === autoPublish) return was;
  const [updated] = await db.update(vendors).set({ autoPublish }).where(eq(vendors.id, vendorId)).returning();
  await recordAudit(await auditActor(actor), {
    action: "vendor.update",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: updated.name,
    vendorId,
    before: { autoPublish: was.autoPublish },
    after: { autoPublish },
  });
  return updated;
}

/**
 * Every detail of a store an administrator can set, as the router accepts it.
 *
 * One type for both writers — creating a store and editing one — because two
 * lists of the same fields is how they came to disagree with the schema.
 */
export type StoreDetailsPatch = {
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
  acceptsCod?: boolean;
  codCeiling?: string | null;
  subscriptionPercent?: string | null;
};

/** Trimmed, with a blank meaning "no value" rather than an empty string. */
const textOrNull = (value: string | null | undefined) => value?.trim() || null;

/**
 * The columns a store-details patch writes, and nothing else.
 *
 * **This is the only place a store detail becomes a column**, and that is the
 * fix rather than a tidy-up. Seven fields — the delivery fee and its free-over
 * threshold, the shipping band, the carrier, selling under NetLet's licence,
 * whether the store takes cash and its ceiling — were validated by the router,
 * drawn on the store's page and accepted by the save, and then dropped here,
 * because each was added to the schema, the form and the table and never to
 * either writer. The save reported success. Every seller delivered free, cash on
 * delivery could not be switched off for a store being defrauded, and nothing
 * looked wrong. Creating a store dropped those seven and the discount permit too.
 *
 * An absent key writes nothing, so an edit leaves untouched what it did not
 * mention; a blank writes null, so a field can be cleared. A blank never reaches
 * a numeric column as `""`, which Postgres would refuse with a 500.
 * `inventory.test.ts` drives this from the router's own schema, so a detail
 * added there and not here fails the build rather than a shop.
 */
export function storeDetailColumns(patch: StoreDetailsPatch) {
  const has = (key: keyof StoreDetailsPatch) => patch[key] !== undefined;
  return {
    ...(has("nameAr") ? { nameAr: textOrNull(patch.nameAr) } : {}),
    ...(has("contactEmail") ? { contactEmail: textOrNull(patch.contactEmail)?.toLowerCase() ?? null } : {}),
    ...(has("contactPhone") ? { contactPhone: textOrNull(patch.contactPhone) } : {}),
    ...(has("description") ? { description: textOrNull(patch.description) } : {}),
    ...(has("descriptionAr") ? { descriptionAr: textOrNull(patch.descriptionAr) } : {}),
    ...(has("logoUrl") ? { logoUrl: textOrNull(patch.logoUrl) } : {}),
    ...(has("governorate") ? { governorate: textOrNull(patch.governorate) } : {}),
    ...(has("addressLine") ? { addressLine: textOrNull(patch.addressLine) } : {}),
    ...(has("licenceNumber") ? { licenceNumber: textOrNull(patch.licenceNumber) } : {}),
    ...(has("payoutIban")
      ? { payoutIban: patch.payoutIban?.replace(/[\s-]/g, "").toUpperCase() || null }
      : {}),
    ...(has("discountLicenceNumber") ? { discountLicenceNumber: textOrNull(patch.discountLicenceNumber) } : {}),
    ...(has("discountLicenceExpiresAt") ? { discountLicenceExpiresAt: patch.discountLicenceExpiresAt ?? null } : {}),
    ...(has("deliveryFlat") ? { deliveryFlat: textOrNull(patch.deliveryFlat) } : {}),
    ...(has("deliveryFreeOver") ? { deliveryFreeOver: textOrNull(patch.deliveryFreeOver) } : {}),
    ...(has("deliverySpeed") ? { deliverySpeed: textOrNull(patch.deliverySpeed) } : {}),
    ...(has("deliveryProvider") ? { deliveryProvider: textOrNull(patch.deliveryProvider) } : {}),
    ...(has("underPlatformLicence") ? { underPlatformLicence: patch.underPlatformLicence } : {}),
    ...(has("acceptsCod") ? { acceptsCod: patch.acceptsCod } : {}),
    ...(has("codCeiling") ? { codCeiling: textOrNull(patch.codCeiling) } : {}),
    ...(has("subscriptionPercent") ? { subscriptionPercent: textOrNull(patch.subscriptionPercent) } : {}),
  };
}

/**
 * Edits a store's details. Deliberately not commission or status: those are
 * their own audited actions, and folding them into a general "save" would
 * make the audit trail say "updated" where it now says what changed.
 */
export async function updateVendorProfile(actor: Actor, vendorId: number, patch: StoreDetailsPatch & {
  name?: string;
}) {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [was] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!was) throw new Error("NOT_FOUND");

  const next = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...storeDetailColumns(patch),
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
  // reaches Supabase and leaves an account belonging to no store.
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
 * that did not involve an administrator opening the provider's console. The
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

  await sendReset(target.email, locale);

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
   * whether the request was accepted. With Supabase Auth unconfigured there is
   * no mail to send at all, and an administrator told "sent" would
   * wait for an email that was never going to arrive.
   *
   * Said plainly here, unlike the shopper-facing reset, because this takes a
   * user id already on screen rather than an address somebody could be guessing.
   */
  return { sent: canSendReset(), email: target.email };
}
