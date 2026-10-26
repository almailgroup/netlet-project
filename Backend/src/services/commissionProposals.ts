/**
 * Commission proposals and the commission desk (3.3.2, 3.3.9), the database
 * half. The rules are `Shared/inventory/commissionProposals.ts`.
 *
 * A store proposes — an owner for the whole store, a manager for one product —
 * and whoever may set commission decides: an administrator, or an employee an
 * administrator granted exactly that (`staff_grants`). Accepting sets the rate
 * through `setVendorCommission` / `setProductCommission`, so the change is
 * audited as every commission edit is, with the chain; the decision itself is
 * audited beside it as `commission.decide`.
 *
 * Outside `db.ts` for the reason `orders.ts` is: functions there call its
 * module-local `getDb`, which nothing outside can point at a test database.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { commissionProposals, products, vendors } from "../../database/schema.js";
import {
  MAX_DECISION_NOTE,
  MAX_PROPOSAL_REASON,
  normaliseFigure,
  proposalFigureProblem,
  storeRateFor,
  type ProposalFigure,
  type ProposalProblem,
  type ProposalStatus,
} from "../../../Shared/inventory/commissionProposals.js";
import { assertCan, can, type Actor } from "../../../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { violatesUnique } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { auditActor, setProductCommission, setVendorCommission } from "./inventory.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A refusal somebody can act on, as a message key. */
export class CommissionRefused extends Error {
  constructor(readonly reason: ProposalProblem | "commission.alreadyOpen" | "commission.notFound" | "commission.moved" | "commission.needsNote") {
    super(reason);
    this.name = "CommissionRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

export type ProposalRow = {
  id: number;
  vendorId: number;
  vendorName: string;
  productId: number | null;
  productTitle: string | null;
  percent: string | null;
  fixed: string | null;
  reason: string | null;
  status: ProposalStatus;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  /** What the store or product is charged now, so the decision is read against it. */
  current: { percent: string | null; fixed: string | null };
};

/**
 * Ask for a rate (3.3.2). The whole store is an owner's to ask about — it is
 * every sale the store makes — and one product a manager's, who runs the
 * catalogue. One open proposal per store and product, by the index.
 */
export async function proposeCommission(
  actor: Actor,
  input: { vendorId: number; productId: number | null; percent: string | null; fixed: string | null; reason?: string | null },
): Promise<ProposalRow> {
  assertCan(actor, input.productId === null ? "vendor.editProfile" : "product.edit", input.vendorId);
  const problem = proposalFigureProblem(input);
  if (problem) throw new CommissionRefused(problem);
  const figure = normaliseFigure(input);
  const db = await handle();
  if (input.productId !== null) {
    const [product] = await db.select({ vendorId: products.vendorId }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!product || product.vendorId !== input.vendorId) throw new CommissionRefused("commission.notFound");
  }
  let id: number;
  try {
    const [row] = await db
      .insert(commissionProposals)
      .values({
        vendorId: input.vendorId,
        productId: input.productId,
        percent: figure.percent,
        fixed: figure.fixed,
        reason: input.reason?.replace(/\s+/g, " ").trim().slice(0, MAX_PROPOSAL_REASON) || null,
        createdBy: actor.userId,
      })
      .returning({ id: commissionProposals.id });
    id = row.id;
  } catch (error) {
    if (violatesUnique(error, "commission_proposals_open_unique")) throw new CommissionRefused("commission.alreadyOpen");
    throw error;
  }
  const [made] = await rows(db, and(eq(commissionProposals.id, id)));
  await recordAudit(await auditActor(actor), {
    action: "commission.propose",
    subjectType: "proposal",
    subjectId: id,
    subjectLabel: made.productTitle ?? made.vendorName,
    vendorId: input.vendorId,
    after: { productId: input.productId, ...figure },
  });
  return made;
}

/** Take back an open proposal, by whoever could have made it. */
export async function withdrawProposal(actor: Actor, proposalId: number): Promise<void> {
  const db = await handle();
  const [row] = await db.select().from(commissionProposals).where(eq(commissionProposals.id, proposalId)).limit(1);
  if (!row) throw new CommissionRefused("commission.notFound");
  assertCan(actor, row.productId === null ? "vendor.editProfile" : "product.edit", row.vendorId);
  const [moved] = await db
    .update(commissionProposals)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(and(eq(commissionProposals.id, proposalId), eq(commissionProposals.status, "pending")))
    .returning({ id: commissionProposals.id });
  if (!moved) throw new CommissionRefused("commission.moved");
}

/**
 * Proposals, newest first. Whoever may set commission reads every store's; a
 * store reads its own, and nobody else reads any.
 */
export async function listProposals(
  actor: Actor,
  request: { status?: ProposalStatus; vendorId?: number; productId?: number; page?: number; pageSize?: number } = {},
): Promise<Page<ProposalRow>> {
  const db = await handle();
  const desk = can(actor, "vendor.setCommission");
  const scopeVendor = desk ? request.vendorId : actor.kind === "vendor" ? actor.vendorId : null;
  if (!desk && scopeVendor === null) throw new Error("FORBIDDEN:vendor.setCommission");
  if (!desk) assertCan(actor, "product.view", scopeVendor ?? undefined);
  const where = and(
    scopeVendor !== undefined && scopeVendor !== null ? eq(commissionProposals.vendorId, scopeVendor) : undefined,
    request.status ? eq(commissionProposals.status, request.status) : undefined,
    request.productId !== undefined ? eq(commissionProposals.productId, request.productId) : undefined,
  );
  const pageSize = clampPageSize(request.pageSize);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(commissionProposals).where(where);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  return { rows: await rows(db, where, pageSize, offsetFor(page, pageSize)), total, page, pageSize };
}

async function rows(db: Db, where: ReturnType<typeof and>, limit = 1, offset = 0): Promise<ProposalRow[]> {
  const found = await db
    .select({
      id: commissionProposals.id,
      vendorId: commissionProposals.vendorId,
      vendorName: vendors.name,
      productId: commissionProposals.productId,
      productTitle: products.title,
      percent: commissionProposals.percent,
      fixed: commissionProposals.fixed,
      reason: commissionProposals.reason,
      status: commissionProposals.status,
      decisionNote: commissionProposals.decisionNote,
      decidedAt: commissionProposals.decidedAt,
      createdAt: commissionProposals.createdAt,
      vendorPercent: vendors.commissionPercent,
      vendorFixed: vendors.commissionFixed,
      productPercent: products.commissionPercent,
      productFixed: products.commissionFixed,
    })
    .from(commissionProposals)
    .innerJoin(vendors, eq(vendors.id, commissionProposals.vendorId))
    .leftJoin(products, eq(products.id, commissionProposals.productId))
    .where(where)
    /* Open ones first, because that is the reason to open the page. */
    .orderBy(sql`case when ${commissionProposals.status} = 'pending' then 0 else 1 end`, desc(commissionProposals.createdAt), desc(commissionProposals.id))
    .limit(limit)
    .offset(offset);
  return found.map(row => ({
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    productId: row.productId,
    productTitle: row.productTitle,
    percent: row.percent,
    fixed: row.fixed,
    reason: row.reason,
    status: row.status as ProposalStatus,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    /* A product with no override of its own is charged its store's rate. */
    current: row.productId !== null && (row.productPercent !== null || row.productFixed !== null)
      ? { percent: row.productPercent, fixed: row.productFixed }
      : { percent: row.vendorPercent, fixed: row.vendorFixed },
  }));
}

/**
 * Accept or decline (3.3.2). Accepting sets the rate through the audited door
 * every commission edit uses; declining needs a note the store reads. Raced
 * safely by the predicate on `pending` — and the claim comes first, so two
 * people deciding at once set one rate.
 */
export async function decideProposal(actor: Actor, proposalId: number, decision: { accept: boolean; note?: string | null }): Promise<ProposalRow> {
  assertCan(actor, "vendor.setCommission");
  const note = decision.note?.replace(/\s+/g, " ").trim().slice(0, MAX_DECISION_NOTE) || null;
  if (!decision.accept && !note) throw new CommissionRefused("commission.needsNote");
  const db = await handle();
  const [claimed] = await db
    .update(commissionProposals)
    .set({ status: decision.accept ? "accepted" : "declined", decisionNote: note, decidedBy: actor.userId, decidedAt: new Date() })
    .where(and(eq(commissionProposals.id, proposalId), eq(commissionProposals.status, "pending")))
    .returning();
  if (!claimed) {
    const [exists] = await db.select({ id: commissionProposals.id }).from(commissionProposals).where(eq(commissionProposals.id, proposalId)).limit(1);
    throw new CommissionRefused(exists ? "commission.moved" : "commission.notFound");
  }
  const figure: ProposalFigure = { percent: claimed.percent, fixed: claimed.fixed };
  if (decision.accept) {
    if (claimed.productId !== null) await setProductCommission(actor, claimed.productId, figure);
    else {
      const rate = storeRateFor(figure);
      await setVendorCommission(actor, claimed.vendorId, rate.percent, rate.fixed);
    }
  }
  const [decided] = await rows(db, eq(commissionProposals.id, proposalId));
  await recordAudit(await auditActor(actor), {
    action: "commission.decide",
    subjectType: "proposal",
    subjectId: proposalId,
    subjectLabel: decided.productTitle ?? decided.vendorName,
    vendorId: claimed.vendorId,
    before: { status: "pending" },
    after: { status: claimed.status, note, ...figure },
  });
  return decided;
}

/** How many wait on whoever may decide them, for the overview's tile. */
export async function countOpenProposals(actor: Actor): Promise<number> {
  if (!can(actor, "vendor.setCommission")) return 0;
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(commissionProposals).where(eq(commissionProposals.status, "pending"));
  return row?.n ?? 0;
}

export type DeskStore = { id: number; name: string; nameAr: string | null; status: string; commissionPercent: string; commissionFixed: string | null };

/**
 * Every store's rate, for the commission desk (3.3.9) — which an employee
 * granted only `vendor.setCommission` can open, and who therefore sees the
 * rates and nothing else about a store: not its IBAN, not its contacts.
 */
export async function commissionStores(actor: Actor, request: { query?: string; page?: number } = {}): Promise<Page<DeskStore>> {
  assertCan(actor, "vendor.setCommission");
  const db = await handle();
  const term = request.query?.trim().toLowerCase();
  const where = term
    ? sql`(lower(${vendors.name}) like ${`%${term}%`} or lower(coalesce(${vendors.nameAr}, '')) like ${`%${term}%`} or lower(${vendors.slug}) like ${`%${term}%`})`
    : undefined;
  const pageSize = clampPageSize(undefined);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(vendors).where(where);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const found = await db
    .select({ id: vendors.id, name: vendors.name, nameAr: vendors.nameAr, status: vendors.status, commissionPercent: vendors.commissionPercent, commissionFixed: vendors.commissionFixed })
    .from(vendors)
    .where(where)
    .orderBy(vendors.name, vendors.id)
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return { rows: found, total, page, pageSize };
}
