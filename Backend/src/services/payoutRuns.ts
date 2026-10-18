/**
 * Payout runs (3.3.21), the database half. The rules are in
 * `Shared/commerce/payoutRuns.ts`.
 *
 * **Scoped in the query.** A store's manager sees their own batch and their
 * own history; an administrator sees every store's. Recording a payout is
 * NetLet's alone.
 *
 * **Prepared once, under a lock.** Two administrators preparing one seller
 * at once would each compute the same batch and pay it twice. The seller's
 * row is locked `for update` inside the transaction that recomputes the batch
 * and writes the run, so the second waits, recomputes against the first's
 * run, finds nothing outstanding, and is refused.
 *
 * **Frozen before the money moves.** A prepared run's lines count as paid the
 * moment it is written; the transfer is made from that figure, and marking it
 * sent adds the bank's reference and nothing else. `payoutFile.ts` has why.
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { adBookings, fulfilmentCharges, orderItems, orders, payoutFiles, payoutRunItems, payoutRuns, vendors } from "../../database/schema.js";
import { bookingRoom, feeAccrued, feeCeiling, kuwaitToday } from "../../../Shared/commerce/adBookings.js";
import { lineOutcome } from "../../../Shared/commerce/finance.js";
import { batchFor, chargeReference, feeReference, maskIban, MAX_BANK_REFERENCE, type Batch, type FeeCharge, type Obligation } from "../../../Shared/commerce/payoutRuns.js";
import { debtorProblem, fileReference, kuwaitDate, MAX_FILE_TRANSFERS, pain001, payoutCsv, type DebtorProblem, type FileTransfer, type PayoutFormat } from "../../../Shared/commerce/payoutFile.js";
import { payoutDue } from "../../../Shared/commerce/payoutSchedule.js";
import { isValidIban } from "../../../Shared/inventory/storeProfile.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";
import { ENV } from "../core/env.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type PayoutRefusal =
  | "payouts.nothingDue"
  | "payouts.noReference"
  | "payouts.notFound"
  | "payouts.noIban"
  | "payouts.badIban"
  | "payouts.nothingPrepared"
  | "payouts.fileEmpty"
  | DebtorProblem;

export class PayoutRefused extends Error {
  constructor(readonly reason: PayoutRefusal) {
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

/**
 * Every placement's fee as the ledger sees it (3.3.15): what it has accrued by
 * today, the most it can still cost, and what runs have already taken.
 */
async function feesFor(db: Db | Tx, vendorId: number | undefined, now: Date) {
  const today = kuwaitToday(now);
  const bookings = await db
    .select({
      id: adBookings.id,
      vendorId: adBookings.vendorId,
      startsOn: adBookings.startsOn,
      endsOn: adBookings.endsOn,
      dailyRate: adBookings.dailyRate,
      cancelledOn: adBookings.cancelledOn,
      /* A banner is charged only once approved (`feeAccrued`). */
      bannerStatus: adBookings.bannerStatus,
    })
    .from(adBookings)
    .where(vendorId === undefined ? undefined : eq(adBookings.vendorId, vendorId));
  const taken = await db
    .select({ bookingId: payoutRunItems.bookingId, amount: sql<string>`sum(${payoutRunItems.amount})` })
    .from(payoutRunItems)
    .where(sql`${payoutRunItems.bookingId} is not null`)
    .groupBy(payoutRunItems.bookingId);
  const deducted = new Map(taken.map(row => [row.bookingId!, toFils(row.amount)]));

  const bySeller = new Map<number, (FeeCharge & { ceilingFils: bigint })[]>();
  for (const booking of bookings) {
    const held = bySeller.get(booking.vendorId) ?? [];
    held.push({
      bookingId: booking.id,
      reference: feeReference(booking.id),
      accruedFils: feeAccrued(booking, today),
      deductedFils: deducted.get(booking.id) ?? 0n,
      ceilingFils: feeCeiling(booking, today),
    });
    bySeller.set(booking.vendorId, held);
  }

  /*
   * NetLet's packing charges (4.2): whole the moment they are made, so the
   * accrued figure and the ceiling are both the charge. Read with the same
   * scope, and taken the same way — a negative fee line on the next run.
   */
  const charges = await db
    .select({ id: fulfilmentCharges.id, vendorId: fulfilmentCharges.vendorId, amount: fulfilmentCharges.amount })
    .from(fulfilmentCharges)
    .where(vendorId === undefined ? undefined : eq(fulfilmentCharges.vendorId, vendorId));
  if (charges.length) {
    const chargeTaken = await db
      .select({ chargeId: payoutRunItems.chargeId, amount: sql<string>`sum(${payoutRunItems.amount})` })
      .from(payoutRunItems)
      .where(sql`${payoutRunItems.chargeId} is not null`)
      .groupBy(payoutRunItems.chargeId);
    const chargeDeducted = new Map(chargeTaken.map(row => [row.chargeId!, toFils(row.amount)]));
    for (const charge of charges) {
      const held = bySeller.get(charge.vendorId) ?? [];
      const fils = toFils(charge.amount);
      held.push({ chargeId: charge.id, reference: chargeReference(charge.id), accruedFils: fils, deductedFils: chargeDeducted.get(charge.id) ?? 0n, ceilingFils: fils });
      bySeller.set(charge.vendorId, held);
    }
  }
  return bySeller;
}

/**
 * What a seller can still commit to placements, in fils (3.3.15): every
 * order's money not yet paid to them, due or not, less what their bookings can
 * still cost beyond what runs have already taken. Read inside the booking's
 * transaction, under the seller's row lock, so two bookings cannot both spend
 * the same earnings.
 */
export async function placementRoom(tx: Db | Tx, vendorId: number, now: Date): Promise<bigint> {
  const { obligations, paid } = await ledgerFor(tx, vendorId, now);
  const paidHere = paid.get(vendorId) ?? new Map<number, bigint>();
  let outstanding = 0n;
  for (const obligation of obligations.get(vendorId)?.values() ?? []) {
    outstanding += obligation.earnedFils - (paidHere.get(obligation.orderId) ?? 0n);
  }
  const fees = (await feesFor(tx, vendorId, now)).get(vendorId) ?? [];
  return bookingRoom(outstanding, fees.map(fee => ({ ceilingFils: fee.ceilingFils, deductedFils: fee.deductedFils })));
}

export type ReadyBatch = {
  vendorId: number;
  vendorName: string;
  /** The full IBAN for an administrator about to send money; masked for the store's own staff. */
  iban: string | null;
  total: string;
  payable: boolean;
  lines: { orderId: number | null; reference: string; amount: string; kind: "payout" | "clawback" | "fee" }[];
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
  const fees = await feesFor(db, scope, now);
  /* A seller with a placement and no sales still has a batch: the fee it owes. */
  const sellerIds = [...new Set([...obligations.keys(), ...fees.keys()])];
  if (sellerIds.length === 0) return [];
  const sellers = await db
    .select({ id: vendors.id, name: vendors.name, iban: vendors.payoutIban })
    .from(vendors)
    .where(inArray(vendors.id, sellerIds));
  const byId = new Map(sellers.map(seller => [seller.id, seller]));

  return sellerIds
    .map(sellerId => {
      const batch = batchFor([...(obligations.get(sellerId)?.values() ?? [])], paid.get(sellerId) ?? new Map(), fees.get(sellerId) ?? []);
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

/** Where the money goes: the seller's account, refused when there is nowhere valid to send it. */
function payeeIban(iban: string | null): string {
  if (!iban?.trim()) throw new PayoutRefused("payouts.noIban");
  if (!isValidIban(iban)) throw new PayoutRefused("payouts.badIban");
  return iban.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Freeze one seller's batch as a prepared run, under the seller's row lock.
 *
 * The batch is recomputed inside the transaction rather than taken from the
 * page, so a second press — or a second administrator — recomputes against
 * the first run and finds nothing outstanding. From here the figure no longer
 * moves: the transfer is made from it.
 */
async function prepareIn(db: Db, userId: number, vendorId: number, now: Date) {
  return db.transaction(async tx => {
    const [seller] = await tx
      .select({ id: vendors.id, name: vendors.name, iban: vendors.payoutIban })
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1)
      .for("update");
    if (!seller) throw new PayoutRefused("payouts.notFound");
    const iban = payeeIban(seller.iban);

    const { obligations, paid } = await ledgerFor(tx, vendorId, now);
    const fees = (await feesFor(tx, vendorId, now)).get(vendorId) ?? [];
    const batch = batchFor([...(obligations.get(vendorId)?.values() ?? [])], paid.get(vendorId) ?? new Map(), fees);
    if (!batch.payable) throw new PayoutRefused("payouts.nothingDue");

    const [written] = await tx
      .insert(payoutRuns)
      .values({ vendorId, vendorName: seller.name, total: fromFils(batch.totalFils), status: "prepared", bankReference: null, ibanUsed: iban, preparedBy: userId, preparedAt: now, paidAt: null })
      .returning({ id: payoutRuns.id, total: payoutRuns.total });
    await tx.insert(payoutRunItems).values(batch.lines.map(line => ({
      runId: written.id,
      orderId: line.orderId,
      bookingId: line.bookingId,
      chargeId: line.chargeId,
      orderReference: line.reference,
      vendorId,
      amount: fromFils(line.amountFils),
    })));
    return { id: written.id, total: written.total, vendorName: seller.name, lines: batch.lines.length };
  });
}

async function auditPrepared(actor: Actor, vendorId: number, run: { id: number; total: string; vendorName: string; lines: number }) {
  await recordAudit(await auditActor(actor), {
    action: "payout.prepare",
    subjectType: "payout",
    subjectId: run.id,
    subjectLabel: run.vendorName,
    vendorId,
    after: { total: run.total, lines: run.lines },
  });
}

/** Freeze one seller's next payout, ready to send. NetLet's alone. */
export async function preparePayout(actor: Actor, vendorId: number, now = new Date()) {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const run = await prepareIn(db, actor.userId, vendorId, now);
  await auditPrepared(actor, vendorId, run);
  return { id: run.id, total: run.total };
}

/**
 * Prepare every payable batch at once. Each seller is its own transaction,
 * so one store with no account on file does not hold up the rest — it is
 * named back instead, because a payout silently skipped is a seller wondering
 * why nothing arrived.
 */
export async function prepareAllPayouts(actor: Actor, now = new Date()) {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const payable = (await readyBatches(actor, now)).filter(batch => batch.payable);
  let prepared = 0;
  const skipped: string[] = [];
  for (const batch of payable) {
    try {
      const run = await prepareIn(db, actor.userId, batch.vendorId, now);
      await auditPrepared(actor, batch.vendorId, run);
      prepared += 1;
    } catch (error) {
      if (error instanceof PayoutRefused && (error.reason === "payouts.noIban" || error.reason === "payouts.badIban")) skipped.push(batch.vendorName);
      /* Prepared by somebody else between the read and the lock: nothing to do. */
      else if (!(error instanceof PayoutRefused && error.reason === "payouts.nothingDue")) throw error;
    }
  }
  return { prepared, skipped };
}

/**
 * Gather every prepared run not yet in a file into a new one.
 *
 * The runs are locked as they are chosen and moved with the predicate still
 * in the `UPDATE`, so two administrators pressing at once make one file and
 * a refusal, never two files carrying the same transfer.
 */
export async function makePayoutFile(actor: Actor, now = new Date()) {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const made = await db.transaction(async tx => {
    const waiting = await tx
      .select({ id: payoutRuns.id })
      .from(payoutRuns)
      .where(and(eq(payoutRuns.status, "prepared"), isNull(payoutRuns.fileId)))
      .orderBy(asc(payoutRuns.id))
      .limit(MAX_FILE_TRANSFERS)
      .for("update");
    if (waiting.length === 0) throw new PayoutRefused("payouts.nothingPrepared");
    const [file] = await tx.insert(payoutFiles).values({ createdBy: actor.userId, createdAt: now }).returning();
    const moved = await tx
      .update(payoutRuns)
      .set({ fileId: file.id })
      .where(and(inArray(payoutRuns.id, waiting.map(run => run.id)), eq(payoutRuns.status, "prepared"), isNull(payoutRuns.fileId)))
      .returning({ total: payoutRuns.total });
    if (moved.length === 0) throw new PayoutRefused("payouts.nothingPrepared");
    return { file, transfers: moved.length, total: fromFils(moved.reduce((sum, run) => sum + toFils(run.total), 0n)) };
  });
  const reference = fileReference(made.file.id, made.file.createdAt);
  await recordAudit(await auditActor(actor), {
    action: "payout.file",
    subjectType: "payoutFile",
    subjectId: made.file.id,
    subjectLabel: reference,
    after: { transfers: made.transfers, total: made.total },
  });
  return { id: made.file.id, reference, transfers: made.transfers, total: made.total };
}

/** NetLet's own account as configured, and what keeps it out of an ISO 20022 file. */
function debtorNow() {
  const debtor = { name: ENV.payoutFromName.trim(), iban: ENV.payoutFromIban.trim(), bic: ENV.payoutFromBic.trim().toUpperCase() };
  return { debtor, problem: debtorProblem(debtor) };
}

export type PreparedRunView = {
  id: number;
  vendorId: number | null;
  vendorName: string;
  total: string;
  iban: string | null;
  preparedAt: Date | null;
  fileId: number | null;
  fileReference: string | null;
};

/** Runs frozen and not yet sent, oldest first: what is waiting on somebody at the bank. */
export async function preparedPayouts(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<PreparedRunView> & { unfiled: number }> {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  const pageSize = clampPageSize(request.pageSize ?? 50);
  if (!db) return { rows: [], total: 0, page: 1, pageSize, unfiled: 0 };
  const waiting = eq(payoutRuns.status, "prepared");
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int`, unfiled: sql<number>`(count(*) filter (where ${payoutRuns.fileId} is null))::int` })
    .from(payoutRuns)
    .where(waiting);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ run: payoutRuns, fileCreatedAt: payoutFiles.createdAt })
    .from(payoutRuns)
    .leftJoin(payoutFiles, eq(payoutRuns.fileId, payoutFiles.id))
    .where(waiting)
    .orderBy(asc(payoutRuns.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return {
    rows: rows.map(({ run, fileCreatedAt }) => ({
      id: run.id,
      vendorId: run.vendorId,
      vendorName: run.vendorName,
      total: run.total,
      iban: run.ibanUsed,
      preparedAt: run.preparedAt,
      fileId: run.fileId,
      fileReference: run.fileId !== null && fileCreatedAt ? fileReference(run.fileId, fileCreatedAt) : null,
    })),
    total,
    page,
    pageSize,
    unfiled: counted?.unfiled ?? 0,
  };
}

export type PayoutFileView = {
  id: number;
  reference: string;
  createdAt: Date;
  /** Runs in the file by where they are now. */
  waiting: number;
  sent: number;
  cancelled: number;
  /** What the file asks the bank to send: every run in it but the cancelled. */
  total: string;
};

/** Bank files, newest first, and whether NetLet's own account is set up for the ISO 20022 format. */
export async function payoutFileList(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<PayoutFileView> & { pain001: DebtorProblem | null }> {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  const pageSize = clampPageSize(request.pageSize ?? 20);
  const pain001Problem = debtorNow().problem;
  if (!db) return { rows: [], total: 0, page: 1, pageSize, pain001: pain001Problem };
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(payoutFiles);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const files = await db.select().from(payoutFiles).orderBy(desc(payoutFiles.id)).limit(pageSize).offset(offsetFor(page, pageSize));
  const tallies = files.length
    ? await db
        .select({ fileId: payoutRuns.fileId, status: payoutRuns.status, n: sql<number>`count(*)::int`, sum: sql<string>`sum(${payoutRuns.total})` })
        .from(payoutRuns)
        .where(inArray(payoutRuns.fileId, files.map(file => file.id)))
        .groupBy(payoutRuns.fileId, payoutRuns.status)
    : [];
  return {
    rows: files.map(file => {
      const mine = tallies.filter(tally => tally.fileId === file.id);
      const count = (status: "prepared" | "sent" | "cancelled") => mine.find(tally => tally.status === status)?.n ?? 0;
      const sum = mine.filter(tally => tally.status !== "cancelled").reduce((acc, tally) => acc + toFils(tally.sum), 0n);
      return { id: file.id, reference: fileReference(file.id, file.createdAt), createdAt: file.createdAt, waiting: count("prepared"), sent: count("sent"), cancelled: count("cancelled"), total: fromFils(sum) };
    }),
    total,
    page,
    pageSize,
    pain001: pain001Problem,
  };
}

/**
 * A bank file's contents, in the format asked for.
 *
 * Built from the frozen rows every time, so the same file downloads the same
 * — same message id, same transfers — except that a run cancelled since drops
 * out, which is what somebody re-downloading after the bank refused one wants.
 * Every download is audited: the file carries every seller's account number.
 */
export async function payoutFileContent(actor: Actor, fileId: number, format: PayoutFormat, now = new Date()) {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [file] = await db.select().from(payoutFiles).where(eq(payoutFiles.id, fileId)).limit(1);
  if (!file) throw new PayoutRefused("payouts.notFound");
  const runs = await db
    .select({ id: payoutRuns.id, vendorName: payoutRuns.vendorName, iban: payoutRuns.ibanUsed, total: payoutRuns.total })
    .from(payoutRuns)
    .where(and(eq(payoutRuns.fileId, fileId), ne(payoutRuns.status, "cancelled")))
    .orderBy(asc(payoutRuns.id));
  if (runs.length === 0) throw new PayoutRefused("payouts.fileEmpty");
  /* Every run in a file was prepared with a valid account (`payeeIban`). */
  const transfers: FileTransfer[] = runs.map(run => ({ runId: run.id, vendorName: run.vendorName, iban: run.iban ?? "", amount: run.total }));
  const reference = fileReference(file.id, file.createdAt);

  let content: string;
  if (format === "pain001") {
    const { debtor, problem } = debtorNow();
    if (problem) throw new PayoutRefused(problem);
    /* Never a date before the file was made, and never one already past. */
    const executionDate = kuwaitDate(now) > kuwaitDate(file.createdAt) ? kuwaitDate(now) : kuwaitDate(file.createdAt);
    content = pain001({ reference, createdAt: file.createdAt, executionDate, debtor: { ...debtor, bic: debtor.bic || null }, transfers });
  } else {
    content = payoutCsv(transfers);
  }

  await recordAudit(await auditActor(actor), {
    action: "payout.download",
    subjectType: "payoutFile",
    subjectId: file.id,
    subjectLabel: reference,
    after: { format, transfers: transfers.length },
  });
  return {
    filename: `${reference}.${format === "pain001" ? "xml" : "csv"}`,
    mimeType: format === "pain001" ? "application/xml" : "text/csv",
    content,
  };
}

/**
 * Mark prepared runs sent — one run, or every run still waiting in a file —
 * with the bank's reference. It changes no amount: the figure was frozen when
 * the run was prepared, and that is the figure that left the bank.
 */
export async function markPayoutSent(actor: Actor, target: { runId: number } | { fileId: number }, bankReference: string, now = new Date()) {
  assertCan(actor, "payouts.record");
  const reference = bankReference.trim();
  if (!reference || reference.length > MAX_BANK_REFERENCE) throw new PayoutRefused("payouts.noReference");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const which = "runId" in target ? eq(payoutRuns.id, target.runId) : eq(payoutRuns.fileId, target.fileId);
  const sent = await db
    .update(payoutRuns)
    .set({ status: "sent", bankReference: reference, paidBy: actor.userId, paidAt: now })
    .where(and(which, eq(payoutRuns.status, "prepared")))
    .returning({ id: payoutRuns.id, vendorId: payoutRuns.vendorId, vendorName: payoutRuns.vendorName, total: payoutRuns.total });
  if (sent.length === 0) throw new PayoutRefused("payouts.nothingPrepared");
  const who = await auditActor(actor);
  for (const run of sent) {
    await recordAudit(who, {
      action: "payout.record",
      subjectType: "payout",
      subjectId: run.id,
      subjectLabel: run.vendorName,
      vendorId: run.vendorId,
      after: { total: run.total, bankReference: reference },
    });
  }
  return { runs: sent.length, total: fromFils(sent.reduce((sum, run) => sum + toFils(run.total), 0n)) };
}

/**
 * Cancel a prepared run the bank refused or nobody sent. Its lines are
 * removed in the same transaction, so whatever it carried is owed again and
 * lands in the seller's next batch; the run itself stays, cancelled, and the
 * trail records what it was.
 */
export async function cancelPayout(actor: Actor, runId: number) {
  assertCan(actor, "payouts.record");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const run = await db.transaction(async tx => {
    const [cancelled] = await tx
      .update(payoutRuns)
      .set({ status: "cancelled" })
      .where(and(eq(payoutRuns.id, runId), eq(payoutRuns.status, "prepared")))
      .returning({ id: payoutRuns.id, vendorId: payoutRuns.vendorId, vendorName: payoutRuns.vendorName, total: payoutRuns.total });
    if (!cancelled) throw new PayoutRefused("payouts.nothingPrepared");
    await tx.delete(payoutRunItems).where(eq(payoutRunItems.runId, runId));
    return cancelled;
  });
  await recordAudit(await auditActor(actor), {
    action: "payout.cancel",
    subjectType: "payout",
    subjectId: run.id,
    subjectLabel: run.vendorName,
    vendorId: run.vendorId,
    before: { total: run.total },
  });
  return { id: run.id };
}

export type PayoutRunView = {
  id: number;
  vendorId: number | null;
  vendorName: string;
  total: string;
  status: "prepared" | "sent";
  bankReference: string | null;
  iban: string | null;
  preparedAt: Date | null;
  paidAt: Date | null;
  lines: { reference: string; amount: string }[];
};

/**
 * Payouts prepared or sent, newest first, each with the orders it settled. A
 * cancelled run is left out: it moved no money, and the trail keeps it.
 */
export async function payoutHistory(actor: Actor, request: { page?: number; pageSize?: number } = {}): Promise<Page<PayoutRunView>> {
  const scope = scopeOf(actor);
  const db = await getDb();
  const pageSize = clampPageSize(request.pageSize ?? 20);
  if (!db) return { rows: [], total: 0, page: 1, pageSize };
  const filter = and(ne(payoutRuns.status, "cancelled"), scope === undefined ? undefined : eq(payoutRuns.vendorId, scope));
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(payoutRuns).where(filter);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const runs = await db
    .select()
    .from(payoutRuns)
    .where(filter)
    .orderBy(sql`coalesce(${payoutRuns.paidAt}, ${payoutRuns.preparedAt}) desc nulls last`, desc(payoutRuns.id))
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
      status: run.status === "prepared" ? "prepared" : "sent",
      bankReference: run.bankReference,
      iban: actor.kind === "admin" ? run.ibanUsed : maskIban(run.ibanUsed),
      preparedAt: run.preparedAt,
      paidAt: run.paidAt,
      lines: items.filter(item => item.runId === run.id).map(item => ({ reference: item.reference, amount: item.amount })),
    })),
    total,
    page,
    pageSize,
  };
}
