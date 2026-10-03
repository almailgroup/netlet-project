/**
 * Payout runs (3.3.21), the database half. The rules are in
 * `shared/commerce/payoutRuns.ts`.
 *
 * **Scoped in the query.** A store's manager sees their own batch and their
 * own history; an administrator sees every store's. Recording a payout is
 * NetLet's alone.
 *
 * **Recorded once, under a lock.** Two administrators pressing "paid" for one
 * seller at once would each compute the same batch and pay it twice. The
 * seller's row is locked `for update` inside the transaction that recomputes
 * the batch and writes the run, so the second waits, recomputes against the
 * first's run, finds nothing outstanding, and is refused.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders, payoutRunItems, payoutRuns, vendors } from "../drizzle/schema.js";
import { lineOutcome } from "../shared/commerce/finance.js";
import { batchFor, maskIban, MAX_BANK_REFERENCE, type Batch, type Obligation } from "../shared/commerce/payoutRuns.js";
import { payoutDue } from "../shared/commerce/payoutSchedule.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { fromFils, toFils } from "../shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../shared/pagination.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class PayoutRefused extends Error {
  constructor(readonly reason: "payouts.nothingDue" | "payouts.noReference" | "payouts.notFound") {
    super(reason);
    this.name = "PayoutRefused";
  }
}

/** Whose payouts this actor may read: one store, or every store. */
function scopeOf(actor: Actor): number | undefined {
  if (actor.kind === "vendor") {
    assertCan(actor, "payouts.view", actor.vendorId);
    return actor.vendorId;
  }
  assertCan(actor, "payouts.view");
  return undefined;
}

/** Each order's obligation to each seller, and what has been paid against it. */
async function ledgerFor(db: Db | Tx, vendorId: number | undefined, now: Date) {
  const rows = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      status: orders.status,
      placedAt: orders.placedAt,
      paymentMethod: orders.paymentMethod,
      paymentCollectedAt: orders.paymentCollectedAt,
      vendorId: orderItems.vendorId,
      vendorNet: orderItems.vendorNet,
      fulfilment: orderItems.fulfilment,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      /* Only money that arrived can be owed; a cash order still on the road has
         nothing to pay out yet and is on the schedule, not in a batch. */
      inArray(orders.status, ["paid", "refunded"]),
      vendorId === undefined ? sql`${orderItems.vendorId} is not null` : eq(orderItems.vendorId, vendorId),
    ));

  const obligations = new Map<number, Map<number, Obligation>>();
  for (const row of rows) {
    const seller = row.vendorId!;
    const forSeller = obligations.get(seller) ?? new Map<number, Obligation>();
    obligations.set(seller, forSeller);
    const earned = lineOutcome(row.status, row.fulfilment) === "sold" ? toFils(row.vendorNet) : 0n;
    const held = forSeller.get(row.orderId);
    if (held) held.earnedFils += earned;
    else forSeller.set(row.orderId, { orderId: row.orderId, reference: row.reference, earnedFils: earned, due: payoutDue(row, now) });
  }

  const paidRows = await db
    .select({ vendorId: payoutRunItems.vendorId, orderId: payoutRunItems.orderId, paid: sql<string>`sum(${payoutRunItems.amount})` })
    .from(payoutRunItems)
    .where(vendorId === undefined ? undefined : eq(payoutRunItems.vendorId, vendorId))
    .groupBy(payoutRunItems.vendorId, payoutRunItems.orderId);
  const paid = new Map<number, Map<number, bigint>>();
  for (const row of paidRows) {
    if (row.vendorId === null || row.orderId === null) continue;
    const forSeller = paid.get(row.vendorId) ?? new Map<number, bigint>();
    forSeller.set(row.orderId, toFils(row.paid));
    paid.set(row.vendorId, forSeller);
  }
  return { obligations, paid };
}

export type ReadyBatch = {
  vendorId: number;
  vendorName: string;
  /** The full IBAN for an administrator about to send money; masked for the store's own staff. */
  iban: string | null;
  total: string;
  payable: boolean;
  lines: { orderId: number; reference: string; amount: string; kind: "payout" | "clawback" }[];
};

function shape(batch: Batch) {
  return {
    total: fromFils(batch.totalFils),
    payable: batch.payable,
    lines: batch.lines.map(line => ({ orderId: line.orderId, reference: line.reference, amount: fromFils(line.amountFils), kind: line.kind })),
  };
}

/** Every seller's next batch that has anything in it, assembled by the schedule. */
export async function readyBatches(actor: Actor, now = new Date()): Promise<ReadyBatch[]> {
  const scope = scopeOf(actor);
  const db = await getDb();
  if (!db) return [];
  const { obligations, paid } = await ledgerFor(db, scope, now);
  const sellerIds = [...obligations.keys()];
  if (sellerIds.length === 0) return [];
  const sellers = await db
    .select({ id: vendors.id, name: vendors.name, iban: vendors.payoutIban })
    .from(vendors)
    .where(inArray(vendors.id, sellerIds));
  const byId = new Map(sellers.map(seller => [seller.id, seller]));

  return sellerIds
    .map(sellerId => {
      const batch = batchFor([...obligations.get(sellerId)!.values()], paid.get(sellerId) ?? new Map());
      const seller = byId.get(sellerId);
      return {
        vendorId: sellerId,
        vendorName: seller?.name ?? `#${sellerId}`,
        iban: actor.kind === "admin" ? seller?.iban ?? null : maskIban(seller?.iban ?? null),
        ...shape(batch),
      };
    })
    .filter(batch => batch.lines.length > 0)
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId - b.vendorId);
}

/**
 * Record that a seller's batch was sent, with the bank's reference.
 *
 * The batch is recomputed inside the transaction rather than taken from the
 * page, so what is recorded is what was owed at this moment — a refund landed
 * between the page drawing and the press is in it — and a second press finds
 * nothing left.
 */
export async function recordPayout(actor: Actor, vendorId: number, bankReference: string, now = new Date()) {
  assertCan(actor, "payouts.record");
  const reference = bankReference.trim();
  if (!reference || reference.length > MAX_BANK_REFERENCE) throw new PayoutRefused("payouts.noReference");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const run = await db.transaction(async tx => {
    const [seller] = await tx
      .select({ id: vendors.id, name: vendors.name, iban: vendors.payoutIban })
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1)
      .for("update");
    if (!seller) throw new PayoutRefused("payouts.notFound");

    const { obligations, paid } = await ledgerFor(tx, vendorId, now);
    const batch = batchFor([...(obligations.get(vendorId)?.values() ?? [])], paid.get(vendorId) ?? new Map());
    if (!batch.payable) throw new PayoutRefused("payouts.nothingDue");

    const [written] = await tx
      .insert(payoutRuns)
      .values({ vendorId, vendorName: seller.name, total: fromFils(batch.totalFils), bankReference: reference, ibanUsed: seller.iban, paidBy: actor.userId, paidAt: now })
      .returning({ id: payoutRuns.id, total: payoutRuns.total });
    await tx.insert(payoutRunItems).values(batch.lines.map(line => ({
      runId: written.id,
      orderId: line.orderId,
      orderReference: line.reference,
      vendorId,
      amount: fromFils(line.amountFils),
    })));
    return { id: written.id, total: written.total, vendorName: seller.name, lines: batch.lines.length };
  });

  await recordAudit(await auditActor(actor), {
    action: "payout.record",
    subjectType: "payout",
    subjectId: run.id,
    subjectLabel: run.vendorName,
    vendorId,
    after: { total: run.total, bankReference: reference, orders: run.lines },
  });
  return { id: run.id, total: run.total };
}

export type PayoutRunView = {
  id: number;
  vendorId: number | null;
  vendorName: string;
  total: string;
  bankReference: string;
  iban: string | null;
  paidAt: Date;
  lines: { reference: string; amount: string }[];
};

/** Payouts already sent, newest first, each with the orders it settled. */
export async function payoutHistory(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<PayoutRunView>> {
  const scope = scopeOf(actor);
  const db = await getDb();
  const pageSize = clampPageSize(request.pageSize ?? 20);
  if (!db) return { rows: [], total: 0, page: 1, pageSize };
  const filter = scope === undefined ? undefined : eq(payoutRuns.vendorId, scope);
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(payoutRuns).where(filter);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const runs = await db
    .select()
    .from(payoutRuns)
    .where(filter)
    .orderBy(desc(payoutRuns.paidAt), desc(payoutRuns.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  const items = runs.length
    ? await db
        .select({ runId: payoutRunItems.runId, reference: payoutRunItems.orderReference, amount: payoutRunItems.amount })
        .from(payoutRunItems)
        .where(inArray(payoutRunItems.runId, runs.map(run => run.id)))
        .orderBy(payoutRunItems.id)
    : [];
  return {
    rows: runs.map(run => ({
      id: run.id,
      vendorId: run.vendorId,
      vendorName: run.vendorName,
      total: run.total,
      bankReference: run.bankReference,
      iban: actor.kind === "admin" ? run.ibanUsed : maskIban(run.ibanUsed),
      paidAt: run.paidAt,
      lines: items.filter(item => item.runId === run.id).map(item => ({ reference: item.reference, amount: item.amount })),
    })),
    total,
    page,
    pageSize,
  };
}
