/**
 * A product's catalogues, the database half. The rules are
 * `Shared/inventory/productCatalogues.ts`; the upload and the file's own
 * address are routes in `Backend/src/core/app.ts`.
 *
 * **Who may add to a product is asked of the product's row.** Every upload,
 * listing for the editor and removal looks the product up and asks
 * `can(actor, "product.edit", product.vendorId)` — NetLet's administrators,
 * and a manager or owner of *that* store. Another store's product and a
 * number that names nothing are one answer, "not found".
 *
 * **A file comes in parts and is joined in Postgres.** A Vercel function
 * refuses a body much over 4.5 MB, so the first part makes the row
 * (`uploading`) and each after it is `bytes || part`, written only while the
 * row is its uploader's, still uploading and exactly as long as the part's
 * offset says — so a part sent twice, out of order or by somebody else
 * changes nothing. The last part checks the file ends as a PDF does and
 * settles where it stands: `live`, or `pending` for a store whose products
 * wait for review. A file whose parts stopped coming is thrown away the next
 * time anybody adds to that product.
 *
 * **Closed, not broken, until migration 0082 is pasted**: a missing table
 * lists nothing and an upload says the section is not open yet, so the order
 * of the deploy and the paste does not matter.
 */
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { productCatalogues, products, users, vendors } from "../../database/schema.js";
import {
  CATALOGUE_PART_BYTES,
  CATALOGUE_UPLOAD_STALE_MS,
  MAX_CATALOGUES_PER_PRODUCT,
  MAX_CATALOGUE_UPLOADS_PER_HOUR,
  catalogueSizeProblem,
  catalogueTitleProblem,
  cleanCatalogueTitle,
  cleanReviewNote,
  endsLikePdf,
  partCount,
  startsLikePdf,
  statusOnUpload,
  type CatalogueStatus,
} from "../../../Shared/inventory/productCatalogues.js";
import { safeFileName } from "../../../Shared/inventory/applicationDocuments.js";
import { assertCan, can, type Actor } from "../../../Shared/inventory/permissions.js";
import { isMissingTable } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";
import { auditActor } from "./inventory.js";
import { takeHourlyAllowance } from "./rateLimit.js";

export type CatalogueRefusal =
  | "catalogue.empty"
  | "catalogue.tooLarge"
  | "catalogue.notPdf"
  | "catalogue.cutShort"
  | "catalogue.partMismatch"
  | "catalogue.tooManyFiles"
  | "catalogue.tooMany"
  | "catalogue.offPlatform"
  | "catalogue.notFound"
  | "catalogue.notWaiting"
  | "catalogue.noteNeeded"
  | "catalogue.unavailable";

export class CatalogueRefused extends Error {
  constructor(readonly reason: CatalogueRefusal) {
    super(reason);
    this.name = "CatalogueRefused";
  }
}

/** The HTTP status a refusal is said with. */
export function catalogueRefusalStatus(reason: CatalogueRefusal): number {
  switch (reason) {
    case "catalogue.notFound": return 404;
    case "catalogue.tooMany": return 429;
    case "catalogue.tooLarge": return 413;
    case "catalogue.unavailable": return 503;
    case "catalogue.partMismatch":
    case "catalogue.notWaiting": return 409;
    default: return 400;
  }
}

async function handle() {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** What a shopper is shown about one: never the bytes, never who sent it. */
export type CatalogueCard = {
  id: number;
  title: string | null;
  titleAr: string | null;
  fileName: string;
  sizeBytes: number;
  createdAt: Date;
};

/** What the product's editor is shown: where it stands too, and whether this person may take it off. */
export type CatalogueRow = CatalogueCard & {
  status: Exclude<CatalogueStatus, "uploading">;
  reviewNote: string | null;
  /** Added by NetLet rather than the store, said to the store as "Added by NetLet". */
  byNetlet: boolean;
};

export type CatalogueEditor = {
  /** False until migration 0082 is pasted. */
  ready: boolean;
  items: CatalogueRow[];
  /** Whether a finished upload goes on the page at once, for the editor to say before the press. */
  goesLive: boolean;
  /** How many more this product can take. */
  room: number;
};

const CARD = {
  id: productCatalogues.id,
  title: productCatalogues.title,
  titleAr: productCatalogues.titleAr,
  fileName: productCatalogues.fileName,
  sizeBytes: productCatalogues.sizeBytes,
  createdAt: productCatalogues.createdAt,
};

/** A product's owner and whether its store publishes without review, or null. */
async function productOf(productId: number) {
  const db = await handle();
  const [row] = await db
    .select({
      id: products.id,
      vendorId: products.vendorId,
      title: products.title,
      status: products.status,
      autoPublish: vendors.autoPublish,
      vendorStatus: vendors.status,
    })
    .from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(eq(products.id, productId))
    .limit(1);
  return row ?? null;
}

/** The store a product belongs to, so the caller can resolve who is asking for that store. */
export async function storeOfProduct(productId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, productId)).limit(1);
  return row?.vendorId ?? null;
}

/** Whether the shop shows this product to a shopper: the catalogue's own rule. */
function shown(product: { status: string; vendorStatus: string }) {
  return product.status === "published" && product.vendorStatus === "approved";
}

/**
 * The catalogues on a product's page: live ones, in their order, for a
 * product the shop shows. Nothing for a draft, a suspended store's product or
 * a product that is not there — and nothing before the table is.
 */
export async function cataloguesForProduct(productId: number): Promise<CatalogueCard[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select(CARD)
      .from(productCatalogues)
      .innerJoin(products, eq(products.id, productCatalogues.productId))
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(and(
        eq(productCatalogues.productId, productId),
        eq(productCatalogues.status, "live"),
        eq(products.status, "published"),
        eq(vendors.status, "approved"),
      ))
      .orderBy(asc(productCatalogues.position), asc(productCatalogues.id));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/** Uploads on this product whose parts stopped coming, thrown away. */
async function dropStale(productId: number, now: Date) {
  const db = await handle();
  await db
    .delete(productCatalogues)
    .where(and(
      eq(productCatalogues.productId, productId),
      eq(productCatalogues.status, "uploading"),
      lt(productCatalogues.createdAt, new Date(now.getTime() - CATALOGUE_UPLOAD_STALE_MS)),
    ));
}

/** Every catalogue on a product but those still coming in, for its editor. */
export async function cataloguesForEditor(actor: Actor, productId: number, now = new Date()): Promise<CatalogueEditor> {
  const product = await productOf(productId);
  if (!product || !can(actor, "product.edit", product.vendorId)) throw new CatalogueRefused("catalogue.notFound");
  const goesLive = statusOnUpload({ admin: actor.kind === "admin", autoPublish: product.autoPublish }) === "live";
  const db = await handle();
  try {
    await dropStale(productId, now);
    const rows = await db
      .select({ ...CARD, status: productCatalogues.status, reviewNote: productCatalogues.reviewNote, uploaderRole: users.role })
      .from(productCatalogues)
      .leftJoin(users, eq(users.id, productCatalogues.uploadedBy))
      .where(and(eq(productCatalogues.productId, productId), sql`${productCatalogues.status} <> 'uploading'`))
      .orderBy(asc(productCatalogues.position), asc(productCatalogues.id));
    const items = rows.map(({ uploaderRole, ...row }) => ({
      ...row,
      status: row.status as CatalogueRow["status"],
      byNetlet: uploaderRole === "admin",
    }));
    return { ready: true, items, goesLive, room: Math.max(0, MAX_CATALOGUES_PER_PRODUCT - items.length) };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, items: [], goesLive, room: 0 };
    throw error;
  }
}

export type UploadProgress = {
  id: number;
  /** How many bytes NetLet holds of the file so far. */
  received: number;
  sizeBytes: number;
  /** Where it stands: still `uploading`, or settled. */
  status: CatalogueStatus;
};

/**
 * The first part of a file, which makes its row. The whole file's size, its
 * name and its titles come with it; each part after it goes to
 * `appendCataloguePart`.
 */
export async function startCatalogueUpload(
  actor: Actor,
  productId: number,
  request: { sizeBytes: number; fileName: string | null; title?: string | null; titleAr?: string | null; declaredType: string; bytes: Uint8Array },
  now = new Date(),
): Promise<UploadProgress> {
  const product = await productOf(productId);
  if (!product || !can(actor, "product.edit", product.vendorId)) throw new CatalogueRefused("catalogue.notFound");
  const sizeProblem = catalogueSizeProblem(request.sizeBytes);
  if (sizeProblem) throw new CatalogueRefused(sizeProblem);
  if (request.declaredType.split(";")[0].trim().toLowerCase() !== "application/pdf" || !startsLikePdf(request.bytes)) {
    throw new CatalogueRefused("catalogue.notPdf");
  }
  if (request.bytes.length !== Math.min(request.sizeBytes, CATALOGUE_PART_BYTES)) throw new CatalogueRefused("catalogue.partMismatch");
  const title = cleanCatalogueTitle(request.title);
  const titleAr = cleanCatalogueTitle(request.titleAr);
  if (catalogueTitleProblem(title) || catalogueTitleProblem(titleAr)) throw new CatalogueRefused("catalogue.offPlatform");

  const db = await handle();
  try {
    await dropStale(productId, now);
    const [held] = await db
      .select({ n: sql<number>`count(*)::int`, last: sql<number | null>`max(${productCatalogues.position})` })
      .from(productCatalogues)
      .where(eq(productCatalogues.productId, productId));
    if ((held?.n ?? 0) >= MAX_CATALOGUES_PER_PRODUCT) throw new CatalogueRefused("catalogue.tooManyFiles");
    /* Counted last, so a file refused for what it is does not spend the hour. */
    if (!(await takeHourlyAllowance(actor.userId, "catalogue", MAX_CATALOGUE_UPLOADS_PER_HOUR))) throw new CatalogueRefused("catalogue.tooMany");

    const [inserted] = await db
      .insert(productCatalogues)
      .values({
        productId,
        title,
        titleAr,
        fileName: safeFileName(request.fileName, "application/pdf"),
        contentType: "application/pdf",
        sizeBytes: request.sizeBytes,
        bytes: request.bytes,
        position: (held?.last ?? -1) + 1,
        status: "uploading",
        uploadedBy: actor.userId,
        createdAt: now,
      })
      .returning({ id: productCatalogues.id });
    const progress: UploadProgress = { id: inserted.id, received: request.bytes.length, sizeBytes: request.sizeBytes, status: "uploading" };
    return request.bytes.length === request.sizeBytes ? await settle(actor, inserted.id, product) : progress;
  } catch (error) {
    if (isMissingTable(error)) throw new CatalogueRefused("catalogue.unavailable");
    throw error;
  }
}

/**
 * One more part of a file this person started. Written only while the row is
 * theirs, still uploading and exactly `offset` long, so a part sent twice or
 * out of order changes nothing and is said as a mismatch.
 */
export async function appendCataloguePart(
  actor: Actor,
  id: number,
  request: { offset: number; bytes: Uint8Array },
): Promise<UploadProgress> {
  const db = await handle();
  let row;
  try {
    [row] = await db
      .select({
        id: productCatalogues.id,
        productId: productCatalogues.productId,
        sizeBytes: productCatalogues.sizeBytes,
        status: productCatalogues.status,
        uploadedBy: productCatalogues.uploadedBy,
        received: sql<number>`octet_length(${productCatalogues.bytes})::int`,
      })
      .from(productCatalogues)
      .where(eq(productCatalogues.id, id))
      .limit(1);
  } catch (error) {
    if (isMissingTable(error)) throw new CatalogueRefused("catalogue.unavailable");
    throw error;
  }
  if (!row || row.status !== "uploading" || row.uploadedBy !== actor.userId) throw new CatalogueRefused("catalogue.notFound");
  const product = await productOf(row.productId);
  if (!product || !can(actor, "product.edit", product.vendorId)) throw new CatalogueRefused("catalogue.notFound");
  const expected = Math.min(CATALOGUE_PART_BYTES, row.sizeBytes - row.received);
  if (request.offset !== row.received || request.bytes.length !== expected || expected <= 0) throw new CatalogueRefused("catalogue.partMismatch");

  const [grown] = await db
    .update(productCatalogues)
    .set({ bytes: sql`${productCatalogues.bytes} || ${Buffer.from(request.bytes)}::bytea` })
    .where(and(
      eq(productCatalogues.id, id),
      eq(productCatalogues.status, "uploading"),
      eq(productCatalogues.uploadedBy, actor.userId),
      sql`octet_length(${productCatalogues.bytes}) = ${request.offset}`,
    ))
    .returning({ received: sql<number>`octet_length(${productCatalogues.bytes})::int` });
  /* Another tab sent the same part between the read and the write. */
  if (!grown) throw new CatalogueRefused("catalogue.partMismatch");
  if (grown.received < row.sizeBytes) return { id, received: grown.received, sizeBytes: row.sizeBytes, status: "uploading" };
  return settle(actor, id, product);
}

/**
 * The last part is in: a PDF ends with `%%EOF`, so a file cut short is thrown
 * away and said so; otherwise it settles where the store's publish rule puts
 * it, and the trail says it was added.
 */
async function settle(
  actor: Actor,
  id: number,
  product: { id: number; vendorId: number; title: string; autoPublish: boolean },
): Promise<UploadProgress> {
  const db = await handle();
  const [tail] = await db
    .select({
      tail: sql<Uint8Array>`substring(${productCatalogues.bytes} from greatest(1, octet_length(${productCatalogues.bytes}) - 1023))`,
      sizeBytes: productCatalogues.sizeBytes,
      fileName: productCatalogues.fileName,
      title: productCatalogues.title,
    })
    .from(productCatalogues)
    .where(eq(productCatalogues.id, id))
    .limit(1);
  if (!tail || !endsLikePdf(new Uint8Array(tail.tail))) {
    await db.delete(productCatalogues).where(eq(productCatalogues.id, id));
    throw new CatalogueRefused("catalogue.cutShort");
  }
  const status = statusOnUpload({ admin: actor.kind === "admin", autoPublish: product.autoPublish });
  const [settled] = await db
    .update(productCatalogues)
    .set({ status })
    .where(and(eq(productCatalogues.id, id), eq(productCatalogues.status, "uploading")))
    .returning({ id: productCatalogues.id });
  if (!settled) throw new CatalogueRefused("catalogue.partMismatch");
  await recordAudit(await auditActor(actor), {
    action: "product.catalogue.add",
    subjectType: "product",
    subjectId: product.id,
    subjectLabel: product.title,
    vendorId: product.vendorId,
    after: { catalogueId: id, fileName: tail.fileName, title: tail.title, sizeBytes: tail.sizeBytes, status },
  });
  return { id, received: tail.sizeBytes, sizeBytes: tail.sizeBytes, status };
}

/** One row with what deciding about it needs, or null where there is none (or no table yet). */
async function findCatalogue(id: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({
        id: productCatalogues.id,
        productId: productCatalogues.productId,
        vendorId: products.vendorId,
        productTitle: products.title,
        productStatus: products.status,
        vendorStatus: vendors.status,
        status: productCatalogues.status,
        fileName: productCatalogues.fileName,
        title: productCatalogues.title,
        sizeBytes: productCatalogues.sizeBytes,
      })
      .from(productCatalogues)
      .innerJoin(products, eq(products.id, productCatalogues.productId))
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(eq(productCatalogues.id, id))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/** The store a catalogue's product belongs to, so the caller can resolve who is asking for that store. */
export async function storeOfCatalogue(id: number): Promise<number | null> {
  return (await findCatalogue(id))?.vendorId ?? null;
}

/**
 * One file's bytes, or one part of them, for its own address. A live one on a
 * product the shop shows is anybody's to read (`public`); any other —
 * waiting, turned down, or on a product not on the shelf — only the
 * product's store and NetLet's. Null for anybody else, for an id that names
 * nothing and for a part past the end, the same answer.
 */
export async function readCatalogue(
  actor: Actor | null,
  id: number,
  part: number | null = null,
): Promise<{ fileName: string; sizeBytes: number; bytes: Uint8Array; public: boolean } | null> {
  const row = await findCatalogue(id);
  if (!row || row.status === "uploading") return null;
  const open = row.status === "live" && shown({ status: row.productStatus, vendorStatus: row.vendorStatus });
  if (!open && !(actor && (can(actor, "product.view", row.vendorId) || can(actor, "product.review")))) return null;
  if (part !== null && (part < 0 || part >= partCount(row.sizeBytes))) return null;
  const db = await handle();
  const [file] = await db
    .select({
      bytes: part === null
        ? productCatalogues.bytes
        : sql<Uint8Array>`substring(${productCatalogues.bytes} from ${part * CATALOGUE_PART_BYTES + 1} for ${CATALOGUE_PART_BYTES})`,
    })
    .from(productCatalogues)
    .where(eq(productCatalogues.id, id))
    .limit(1);
  if (!file) return null;
  return { fileName: row.fileName, sizeBytes: row.sizeBytes, bytes: new Uint8Array(file.bytes), public: open };
}

/** Take a catalogue off its product, for good: NetLet, or a manager or owner of the product's store. */
export async function removeCatalogue(actor: Actor, id: number): Promise<{ productId: number }> {
  const row = await findCatalogue(id);
  if (!row || row.status === "uploading" || !can(actor, "product.edit", row.vendorId)) throw new CatalogueRefused("catalogue.notFound");
  const db = await handle();
  const gone = await db.delete(productCatalogues).where(eq(productCatalogues.id, id)).returning({ id: productCatalogues.id });
  /* Somebody else removed it between the look and the press. */
  if (gone.length === 0) throw new CatalogueRefused("catalogue.notFound");
  await recordAudit(await auditActor(actor), {
    action: "product.catalogue.remove",
    subjectType: "product",
    subjectId: row.productId,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    before: { catalogueId: row.id, fileName: row.fileName, title: row.title, status: row.status },
  });
  return { productId: row.productId };
}

export type WaitingCatalogue = CatalogueCard & {
  productId: number;
  productTitle: string;
  productHandle: string;
  vendorId: number;
  store: string;
};

/** Catalogues waiting for NetLet to look at them, oldest first — the review queue's. */
export async function waitingCatalogues(actor: Actor): Promise<WaitingCatalogue[]> {
  assertCan(actor, "product.review");
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select({
        ...CARD,
        productId: products.id,
        productTitle: products.title,
        productHandle: products.handle,
        vendorId: vendors.id,
        store: vendors.name,
      })
      .from(productCatalogues)
      .innerJoin(products, eq(products.id, productCatalogues.productId))
      .innerJoin(vendors, eq(vendors.id, products.vendorId))
      .where(eq(productCatalogues.status, "pending"))
      .orderBy(asc(productCatalogues.createdAt), asc(productCatalogues.id))
      .limit(100);
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/** How many wait, for the overview's tile. */
export async function waitingCatalogueCount(actor: Actor): Promise<number> {
  assertCan(actor, "product.review");
  const db = await getDb();
  if (!db) return 0;
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(productCatalogues).where(eq(productCatalogues.status, "pending"));
    return row?.n ?? 0;
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

/**
 * NetLet's answer to one waiting: on the page, or turned down with a reason
 * the store reads under it in the editor. Written with `pending` in the
 * predicate, so two administrators pressing at once answer it once.
 */
export async function decideCatalogue(actor: Actor, id: number, decision: { approve: boolean; note?: string | null }): Promise<{ status: "live" | "declined" }> {
  assertCan(actor, "product.review");
  const note = cleanReviewNote(decision.note);
  if (!decision.approve && !note) throw new CatalogueRefused("catalogue.noteNeeded");
  const row = await findCatalogue(id);
  if (!row) throw new CatalogueRefused("catalogue.notFound");
  const status = decision.approve ? "live" : "declined";
  const db = await handle();
  const [moved] = await db
    .update(productCatalogues)
    .set({ status, reviewNote: decision.approve ? null : note })
    .where(and(eq(productCatalogues.id, id), eq(productCatalogues.status, "pending")))
    .returning({ id: productCatalogues.id });
  if (!moved) throw new CatalogueRefused("catalogue.notWaiting");
  await recordAudit(await auditActor(actor), {
    action: "product.catalogue.decide",
    subjectType: "product",
    subjectId: row.productId,
    subjectLabel: row.productTitle,
    vendorId: row.vendorId,
    after: { catalogueId: id, fileName: row.fileName, status, note: decision.approve ? null : note },
  });
  return { status };
}
