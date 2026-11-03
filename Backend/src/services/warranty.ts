/**
 * Warranty claims, the database half (migration 0072). The rules are
 * `Shared/commerce/warranty.ts`; the shopper files from the opened order, the
 * store (and NetLet) answers on `/admin/warranty`.
 *
 * Scoped in the query for the reason every order read is: a shopper reaches
 * only claims on their own orders, a store only claims on its own lines, and
 * another's is "not found", never "forbidden". Answering is `returns.handle` —
 * after-sales is the returns desk's work, at the rank that decides returns.
 *
 * A replacement or refund is written as an approved return request in the
 * same transaction as the answer, so the claim and its return cannot exist
 * apart; the returns desk then collects, receives and pays as it does every
 * other return, and the claim reads its progress.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { mediaFiles, orderItems, orders, products, returnRequests, users, vendors, warrantyClaims } from "../../database/schema.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { isMediaPath, mediaIdOf, mediaPath } from "../../../Shared/commerce/media.js";
import { MAX_RETURN_NOTE } from "../../../Shared/commerce/returnRequests.js";
import {
  claimStage,
  isOpenClaim,
  MAX_WARRANTY_PHOTOS,
  problemIssue,
  responseIssue,
  warrantyActions,
  warrantyEligibility,
  type WarrantyRemedy,
} from "../../../Shared/commerce/warranty.js";
import { getDb } from "./db.js";
import { isMissingTable, violatesUnique } from "../core/describeError.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** How many claims the desk shows at once, newest waiting first. */
export const WARRANTY_PAGE = 100;

export class WarrantyRefused extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "WarrantyRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/**
 * A read of the claims that answers `none` while the table is missing.
 *
 * The code deploys before the owner pastes migration 0072, and every order a
 * shopper opens reads this table — so without this, every opened order on the
 * live site failed until the paste. A missing table reads as "no claims", the
 * Warranty button is not offered (`warranty.unavailable`), and filing says so;
 * the review photos' rule (`isMissingTable`). Only reads outside a
 * transaction come through here: inside one, a failed statement aborts the
 * rest, which is why the account-deletion check asks `to_regclass` instead.
 */
async function orNone<T>(read: () => Promise<T>, none: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isMissingTable(error)) return none;
    throw error;
  }
}

/** The store's warranty as it typed it on the product, or null — shown beside the claim, never parsed. */
async function warrantyTerms(db: Db, productIds: (number | null)[]): Promise<Map<number, string>> {
  const ids = [...new Set(productIds.filter((id): id is number => id !== null))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: products.id, attributes: products.attributes }).from(products).where(inArray(products.id, ids));
  const out = new Map<number, string>();
  for (const row of rows) {
    const text = (row.attributes ?? []).find(attribute => attribute.namespace === "spec" && attribute.key === "warranty")?.value;
    if (text && text.trim()) out.set(row.id, text.trim());
  }
  return out;
}

/** Photos the shopper uploaded themselves, as ids, in the order given. */
async function ownPhotos(db: Db, userId: number, paths: readonly string[]): Promise<string[]> {
  if (paths.length > MAX_WARRANTY_PHOTOS) throw new WarrantyRefused("warranty.badPhoto");
  if (new Set(paths).size !== paths.length || paths.some(path => !isMediaPath(path))) throw new WarrantyRefused("warranty.badPhoto");
  const ids = paths.map(mediaIdOf);
  if (!ids.length) return [];
  const mine = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(and(inArray(mediaFiles.id, ids), eq(mediaFiles.uploadedBy, userId)));
  if (mine.length !== ids.length) throw new WarrantyRefused("warranty.badPhoto");
  return ids;
}

/** The served path of each stored photo id that still exists. */
async function photoPaths(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: mediaFiles.id, type: mediaFiles.contentType }).from(mediaFiles).where(inArray(mediaFiles.id, [...new Set(ids)]));
  return new Map(rows.map(row => [row.id, mediaPath(row.id, row.type as "image/jpeg" | "image/webp")]));
}

/** File a claim on one delivered line of the shopper's own order. */
export async function fileClaim(
  userId: number,
  input: { reference: string; orderItemId: number; problem: string; photos: string[] },
): Promise<{ id: number }> {
  const db = await handle();
  const [line] = await db
    .select({ id: orderItems.id, orderId: orders.id, fulfilment: orderItems.fulfilment, deliveredAt: orderItems.deliveredAt, vendorId: orderItems.vendorId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.reference, input.reference), eq(orders.userId, userId), eq(orderItems.id, input.orderItemId)))
    .limit(1);
  if (!line) throw new WarrantyRefused("warranty.notFound");

  const claims = await orNone(() => db.select({ status: warrantyClaims.status }).from(warrantyClaims).where(eq(warrantyClaims.orderItemId, line.id)), null);
  if (!claims) throw new WarrantyRefused("warranty.unavailable");
  const returns = await db.select({ status: returnRequests.status }).from(returnRequests).where(eq(returnRequests.orderItemId, line.id));
  const eligible = warrantyEligibility(line, claims, returns);
  if (!eligible.allowed) throw new WarrantyRefused(eligible.reason);

  const issue = problemIssue(input.problem);
  if (issue) throw new WarrantyRefused(issue);
  const photos = await ownPhotos(db, userId, input.photos);

  try {
    const [row] = await db
      .insert(warrantyClaims)
      .values({
        orderId: line.orderId,
        orderItemId: line.id,
        userId,
        vendorId: line.vendorId,
        problem: input.problem.replace(/\s+/g, " ").trim(),
        photos,
      })
      .returning({ id: warrantyClaims.id });
    return row;
  } catch (error) {
    if (violatesUnique(error, "warranty_claims_open_unique")) throw new WarrantyRefused("warranty.openClaim");
    throw error;
  }
}

/** The shopper takes back a claim nobody has answered. */
export async function withdrawClaim(userId: number, id: number): Promise<void> {
  const db = await handle();
  const [moved] = await db
    .update(warrantyClaims)
    .set({ status: "withdrawn" })
    .where(and(eq(warrantyClaims.id, id), eq(warrantyClaims.userId, userId), eq(warrantyClaims.status, "open")))
    .returning({ id: warrantyClaims.id });
  if (!moved) throw new WarrantyRefused("warranty.notFound");
}

/** Every claim on one of the shopper's orders, newest first, with where each stands. */
export async function claimsForShopperOrder(userId: number, orderId: number) {
  const db = await handle();
  const rows = await orNone(() => db
    .select({
      id: warrantyClaims.id,
      orderItemId: warrantyClaims.orderItemId,
      status: warrantyClaims.status,
      problem: warrantyClaims.problem,
      photos: warrantyClaims.photos,
      remedy: warrantyClaims.remedy,
      response: warrantyClaims.response,
      returnStatus: returnRequests.status,
      createdAt: warrantyClaims.createdAt,
      decidedAt: warrantyClaims.decidedAt,
      completedAt: warrantyClaims.completedAt,
    })
    .from(warrantyClaims)
    .leftJoin(returnRequests, eq(returnRequests.id, warrantyClaims.returnRequestId))
    .where(and(eq(warrantyClaims.orderId, orderId), eq(warrantyClaims.userId, userId)))
    .orderBy(desc(warrantyClaims.createdAt), desc(warrantyClaims.id)), []);
  const paths = await photoPaths(db, rows.flatMap(row => row.photos ?? []));
  return rows.map(row => ({
    ...row,
    photos: (row.photos ?? []).map(id => paths.get(id)).filter((path): path is string => Boolean(path)),
    stage: claimStage(row, row.returnStatus ?? null),
    actions: warrantyActions(row, "shopper"),
  }));
}

/** Whether each line may be claimed on now — what the order page draws its button from. */
export async function warrantyStateForLines(lines: { id: number; fulfilment: string; deliveredAt: Date | null; productId: number | null }[]) {
  const db = await handle();
  const ids = lines.map(line => line.id);
  const claims = ids.length
    ? await orNone(() => db.select({ orderItemId: warrantyClaims.orderItemId, status: warrantyClaims.status }).from(warrantyClaims).where(inArray(warrantyClaims.orderItemId, ids)), null)
    : [];
  const returns = ids.length ? await db.select({ orderItemId: returnRequests.orderItemId, status: returnRequests.status }).from(returnRequests).where(inArray(returnRequests.orderItemId, ids)) : [];
  const terms = await warrantyTerms(db, lines.map(line => line.productId));
  return new Map(lines.map(line => [line.id, {
    eligibility: claims
      ? warrantyEligibility(line, claims.filter(claim => claim.orderItemId === line.id), returns.filter(request => request.orderItemId === line.id))
      : { allowed: false as const, reason: "warranty.unavailable" as const },
    terms: line.productId === null ? null : terms.get(line.productId) ?? null,
  }]));
}

const scope = (actor: Actor) => (actor.kind === "vendor" ? eq(warrantyClaims.vendorId, actor.vendorId) : undefined);

function assertDesk(actor: Actor) {
  assertCan(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined);
}

/** The desk: claims on this store's lines, or every store's for NetLet; waiting ones first. */
export async function listClaims(actor: Actor, filter: { waiting?: boolean } = {}) {
  assertDesk(actor);
  const db = await handle();
  const rows = await orNone(() => db
    .select({
      id: warrantyClaims.id,
      reference: orders.reference,
      productId: orderItems.productId,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      quantity: orderItems.quantity,
      deliveredAt: orderItems.deliveredAt,
      vendorName: vendors.name,
      status: warrantyClaims.status,
      problem: warrantyClaims.problem,
      photos: warrantyClaims.photos,
      remedy: warrantyClaims.remedy,
      response: warrantyClaims.response,
      returnStatus: returnRequests.status,
      shopperName: users.name,
      createdAt: warrantyClaims.createdAt,
      decidedAt: warrantyClaims.decidedAt,
    })
    .from(warrantyClaims)
    .innerJoin(orders, eq(orders.id, warrantyClaims.orderId))
    .innerJoin(orderItems, eq(orderItems.id, warrantyClaims.orderItemId))
    .leftJoin(vendors, eq(vendors.id, warrantyClaims.vendorId))
    .leftJoin(users, eq(users.id, warrantyClaims.userId))
    .leftJoin(returnRequests, eq(returnRequests.id, warrantyClaims.returnRequestId))
    .where(and(scope(actor), filter.waiting ? inArray(warrantyClaims.status, ["open", "accepted"]) : undefined))
    .orderBy(
      sql`case when ${warrantyClaims.status} = 'open' then 0 when ${warrantyClaims.status} = 'accepted' then 1 else 2 end`,
      desc(warrantyClaims.createdAt),
      desc(warrantyClaims.id),
    )
    .limit(WARRANTY_PAGE), []);
  const paths = await photoPaths(db, rows.flatMap(row => row.photos ?? []));
  const terms = await warrantyTerms(db, rows.map(row => row.productId));
  return rows.map(({ shopperName, productId, ...row }) => ({
    ...row,
    /* The first name and nothing else: a store needs to know who, never how to reach them. */
    shopper: shopperName?.trim().split(/\s+/)[0] ?? null,
    terms: productId === null ? null : terms.get(productId) ?? null,
    photos: (row.photos ?? []).map(id => paths.get(id)).filter((path): path is string => Boolean(path)),
    stage: claimStage(row, row.returnStatus ?? null),
    actions: warrantyActions(row, "store"),
  }));
}

/** Claims waiting on this desk, for a tile that hides at zero. */
export async function countOpenClaims(actor: Actor): Promise<number> {
  if (actor.kind !== "admin" && actor.kind !== "vendor") return 0;
  try { assertDesk(actor); } catch { return 0; }
  const db = await handle();
  const [row] = await orNone(() => db.select({ n: sql<number>`count(*)::int` }).from(warrantyClaims).where(and(scope(actor), eq(warrantyClaims.status, "open"))), []);
  return row?.n ?? 0;
}

/**
 * The store's (or NetLet's) answer: a remedy, or a refusal with its reason.
 * A replacement or refund becomes an approved return request in the same
 * transaction, which the returns desk then collects and settles.
 */
export async function decideClaim(
  actor: Actor,
  id: number,
  input: { accept: boolean; remedy?: WarrantyRemedy | null; response: string },
  now = new Date(),
): Promise<void> {
  assertDesk(actor);
  const issue = responseIssue(input.response, !input.accept);
  if (issue) throw new WarrantyRefused(issue);
  if (input.accept && !input.remedy) throw new WarrantyRefused("warranty.needsRemedy");
  const response = input.response.replace(/\s+/g, " ").trim() || null;
  const db = await handle();

  await db.transaction(async tx => {
    const w = tx as unknown as Db;
    const [claim] = await w
      .select()
      .from(warrantyClaims)
      .where(and(eq(warrantyClaims.id, id), scope(actor)))
      .limit(1)
      .for("update");
    if (!claim) throw new WarrantyRefused("warranty.notFound");
    if (claim.status !== "open") throw new WarrantyRefused("warranty.alreadyAnswered");

    let returnRequestId: number | null = null;
    if (input.accept && (input.remedy === "replace" || input.remedy === "refund")) {
      try {
        const [request] = await w
          .insert(returnRequests)
          .values({
            orderId: claim.orderId,
            orderItemId: claim.orderItemId,
            userId: claim.userId,
            vendorId: claim.vendorId,
            kind: input.remedy === "replace" ? "exchange" : "refund",
            reason: "defective",
            note: `Warranty claim ${claim.id}: ${claim.problem}`.slice(0, MAX_RETURN_NOTE),
            status: "approved",
            decidedBy: actor.kind === "admin" ? "admin" : "seller",
            decidedAt: now,
          })
          .returning({ id: returnRequests.id });
        returnRequestId = request.id;
      } catch (error) {
        if (violatesUnique(error, "return_requests_open_unique")) throw new WarrantyRefused("warranty.openReturn");
        throw error;
      }
    }

    await w
      .update(warrantyClaims)
      .set({
        status: input.accept ? "accepted" : "declined",
        remedy: input.accept ? input.remedy ?? null : null,
        response,
        returnRequestId,
        decidedBy: actor.userId,
        decidedAt: now,
      })
      .where(and(eq(warrantyClaims.id, claim.id), eq(warrantyClaims.status, "open")));
  });
}

/** A repair done: the store says so, with what it did. */
export async function completeClaim(actor: Actor, id: number, note: string, now = new Date()): Promise<void> {
  assertDesk(actor);
  const issue = responseIssue(note, false);
  if (issue) throw new WarrantyRefused(issue);
  const db = await handle();
  const [claim] = await db.select().from(warrantyClaims).where(and(eq(warrantyClaims.id, id), scope(actor))).limit(1);
  if (!claim) throw new WarrantyRefused("warranty.notFound");
  if (!warrantyActions(claim, "store").includes("complete")) throw new WarrantyRefused("warranty.alreadyAnswered");
  const words = note.replace(/\s+/g, " ").trim();
  await db
    .update(warrantyClaims)
    .set({ status: "completed", completedAt: now, ...(words ? { response: words } : {}) })
    .where(and(eq(warrantyClaims.id, claim.id), eq(warrantyClaims.status, "accepted")));
}

/** Whether a claim is still in somebody's hands — for the account's own lists. */
export { isOpenClaim };
