/**
 * Invoices and credit notes (3.6.6), the database half. The rules are in
 * `Shared/commerce/invoice.ts`.
 *
 * ## Gap-free, by transaction
 *
 * The number and the document are written in one transaction, and the number
 * comes from a counter row incremented inside it. The row lock orders two
 * concurrent issues; a rollback — the order already had an invoice, the insert
 * failed — gives the number back. A Postgres sequence would have been simpler
 * and would leave a hole every time an insert failed, which is the one thing
 * an invoice series must not have.
 *
 * ## Issued where the sale completes, and repaired where it is read
 *
 * `issueInvoice` is called the moment the cash is recorded and `issueCreditNote`
 * the moment a refund is, each after that write has landed. Neither may undo
 * the act it documents — a driver's cash recorded is recorded — so a failure
 * there is logged, not thrown. What makes that safe is `ensureDocuments`: every
 * read of an order's invoices first issues whatever is missing, idempotently,
 * so a document a failed write left out appears the next time anybody looks,
 * and an order paid before invoices existed gets one too.
 *
 * ## Who reads one
 *
 * The shopper whose order it is, and an administrator. Not a seller: an
 * invoice for a basket names every seller on it and the buyer's address, and a
 * seller already sees their own lines and the address they deliver to on
 * their own desk. Scope is in the `WHERE`, and anything else is "not found".
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { invoiceCounters, invoices, orderItems, orders, products, returnRequests, vendors } from "../../database/schema.js";
import {
  buildCreditNote,
  buildInvoice,
  invoiceNumber,
  seriesFor,
  type FrozenOrderLine,
  type InvoiceDocument,
  type InvoiceIssuer,
  type InvoiceKind,
  type SellerDetails,
} from "../../../Shared/commerce/invoice.js";
import type { FrozenDelivery } from "../../../Shared/commerce/delivery.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../../../Shared/pagination.js";
import { describeError, violatesUnique } from "../core/describeError.js";
import { ENV } from "../core/env.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A verification code: ten characters from the order reference's alphabet,
 * which drops the letters people misread off paper. Fifty bits of chance, so a
 * code cannot be guessed for a number somebody can.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
export function newVerifyCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export type InvoiceSummary = { number: string; kind: InvoiceKind; total: string; issuedAt: Date };

/** NetLet as the issuer, read from configuration at the moment of issue. */
function issuer(): InvoiceIssuer {
  const clean = (value: string) => value.trim() || null;
  return {
    name: clean(ENV.invoiceIssuerName) ?? "NetLet",
    nameAr: clean(ENV.invoiceIssuerNameAr),
    licence: clean(ENV.invoiceIssuerLicence),
    address: clean(ENV.invoiceIssuerAddress),
  };
}

async function nextNumber(tx: Tx, kind: InvoiceKind, at: Date): Promise<string> {
  const series = seriesFor(kind, at);
  const [row] = await tx
    .insert(invoiceCounters)
    .values({ series, last: 1 })
    .onConflictDoUpdate({ target: invoiceCounters.series, set: { last: sql`${invoiceCounters.last} + 1` } })
    .returning({ last: invoiceCounters.last });
  return invoiceNumber(series, row.last);
}

/** The order's lines as an invoice reads them, with the Arabic title where the product has one. */
async function frozenLines(db: Db | Tx, orderId: number): Promise<(FrozenOrderLine & { id: number })[]> {
  const rows = await db
    .select({
      id: orderItems.id,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      destination: orderItems.destination,
      productTitle: orderItems.productTitle,
      productTitleAr: products.titleAr,
      variantTitle: orderItems.variantTitle,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      lineTotal: orderItems.lineTotal,
      fulfilment: orderItems.fulfilment,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);
  return rows.map(({ destination, ...row }) => ({
    ...row,
    destinationLabel: (destination as { label?: string | null } | null)?.label ?? null,
  }));
}

/** An order that was sold and paid for — not a replacement sent for an exchange. */
async function invoiceable(db: Db | Tx, orderId: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.paymentCollectedAt === null || (order.status !== "paid" && order.status !== "refunded")) return null;
  const [replacement] = await db
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(eq(returnRequests.replacementOrderId, orderId))
    .limit(1);
  return replacement ? null : order;
}

/**
 * Issue the invoice for an order whose money has been collected. Idempotent:
 * an order that already has one gets that one back, and an order that is not
 * invoiceable gets null.
 */
export async function issueInvoice(orderId: number, now = new Date()): Promise<InvoiceSummary | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await invoiceFor(db, orderId);
  if (existing) return existing;
  /* Outside the transaction: most orders read are not paid yet, and an order
     never stops being paid once it is, so there is nothing to race. */
  const order = await invoiceable(db, orderId);
  if (!order) return null;

  try {
    return await db.transaction(async tx => {
      const lines = await frozenLines(tx, orderId);
      const vendorIds = [...new Set(lines.map(line => line.vendorId).filter((id): id is number => id !== null))];
      const sellers = new Map<number, SellerDetails>();
      if (vendorIds.length > 0) {
        const rows = await tx
          .select({ id: vendors.id, name: vendors.name, nameAr: vendors.nameAr, licence: vendors.licenceNumber, underPlatformLicence: vendors.underPlatformLicence })
          .from(vendors)
          .where(inArray(vendors.id, vendorIds));
        for (const row of rows) sellers.set(row.id, row);
      }

      const number = await nextNumber(tx, "invoice", now);
      const document = buildInvoice({
        number,
        issuedAt: now,
        issuer: issuer(),
        order: { ...order, deliveryBreakdown: order.deliveryBreakdown as FrozenDelivery | null },
        lines,
        sellers,
      });
      const [row] = await tx
        .insert(invoices)
        .values({ number, kind: "invoice", orderId, total: document.total, issuedAt: now, document, verifyCode: newVerifyCode() })
        .returning({ number: invoices.number, total: invoices.total, issuedAt: invoices.issuedAt });
      return { number: row.number, kind: "invoice" as const, total: row.total, issuedAt: row.issuedAt };
    });
  } catch (error) {
    /* Issued by somebody else between the read and the insert: theirs stands,
       and this transaction's number went back with the rollback. */
    if (violatesUnique(error, "invoices_one_per_order")) return invoiceFor(db, orderId);
    throw error;
  }
}

async function invoiceFor(db: Db, orderId: number): Promise<InvoiceSummary | null> {
  const [row] = await db
    .select({ number: invoices.number, total: invoices.total, issuedAt: invoices.issuedAt })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), eq(invoices.kind, "invoice")))
    .limit(1);
  return row ? { ...row, kind: "invoice" } : null;
}

/**
 * Issue the credit note for a refunded return. Idempotent per return, and it
 * issues the invoice first when the order somehow has none — a credit note
 * must have something to correct.
 */
export async function issueCreditNote(returnRequestId: number, now = new Date()): Promise<InvoiceSummary | null> {
  const db = await getDb();
  if (!db) return null;
  const [request] = await db.select().from(returnRequests).where(eq(returnRequests.id, returnRequestId)).limit(1);
  if (!request || request.status !== "refunded" || request.refundAmount === null) return null;

  const [already] = await db
    .select({ number: invoices.number, total: invoices.total, issuedAt: invoices.issuedAt })
    .from(invoices)
    .where(eq(invoices.returnRequestId, returnRequestId))
    .limit(1);
  if (already) return { ...already, kind: "credit_note" };

  const invoiced = await issueInvoice(request.orderId, now);
  if (!invoiced) return null;
  const [original] = await db.select().from(invoices).where(eq(invoices.number, invoiced.number)).limit(1);
  const line = (await frozenLines(db, request.orderId)).find(entry => entry.id === request.orderItemId);
  if (!original || !line) return null;

  try {
    return await db.transaction(async tx => {
      const number = await nextNumber(tx, "credit_note", now);
      const document = buildCreditNote({
        number,
        issuedAt: now,
        invoice: original.document as InvoiceDocument,
        line,
        amount: request.refundAmount!,
        reason: request.kind === "exchange" ? "invoice.reasonExchangeRefund" : "invoice.reasonReturn",
      });
      const [row] = await tx
        .insert(invoices)
        .values({ number, kind: "credit_note", orderId: request.orderId, creditsInvoiceId: original.id, returnRequestId, total: document.total, issuedAt: now, document, verifyCode: newVerifyCode() })
        .returning({ number: invoices.number, total: invoices.total, issuedAt: invoices.issuedAt });
      return { ...row, kind: "credit_note" as const };
    });
  } catch (error) {
    if (violatesUnique(error, "invoices_one_per_return")) return issueCreditNote(returnRequestId, now);
    throw error;
  }
}

/**
 * Issue after an act that has already landed, without undoing it on failure.
 * The read path repairs anything this misses.
 */
export async function issueQuietly(work: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[invoices] could not issue ${what}; it will be issued when next read:`, describeError(error));
  }
}

/** Issue whatever an order should have and does not, then list what it has. */
export async function ensureDocuments(orderId: number): Promise<InvoiceSummary[]> {
  const db = await getDb();
  if (!db) return [];
  await issueInvoice(orderId);
  const refunded = await db
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(and(eq(returnRequests.orderId, orderId), eq(returnRequests.status, "refunded"), isNotNull(returnRequests.refundAmount)));
  for (const request of refunded) await issueCreditNote(request.id);
  const rows = await db
    .select({ number: invoices.number, kind: invoices.kind, total: invoices.total, issuedAt: invoices.issuedAt })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(invoices.issuedAt, invoices.id);
  return rows.map(row => ({ ...row, kind: row.kind as InvoiceKind }));
}

/** The shopper's own order's documents, by reference. Empty for anybody else's. */
export async function documentsForShopperOrder(userId: number, reference: string): Promise<InvoiceSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.reference, reference), eq(orders.userId, userId)))
    .limit(1);
  return order ? ensureDocuments(order.id) : [];
}

/**
 * One document, for whoever may read it: its shopper, or an administrator.
 * Null for anybody else, which the router answers as "not found".
 */
export async function documentFor(
  who: { userId: number; isAdmin: boolean },
  number: string,
): Promise<{ document: InvoiceDocument; credits: InvoiceSummary[]; verifyCode: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: invoices.id, document: invoices.document, verifyCode: invoices.verifyCode })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(and(eq(invoices.number, number), who.isAdmin ? sql`true` : eq(orders.userId, who.userId)))
    .limit(1);
  if (!row) return null;
  /* An invoice lists the credit notes against it, so a reader of the invoice
     learns it has been corrected without being told separately. */
  const credits = await db
    .select({ number: invoices.number, total: invoices.total, issuedAt: invoices.issuedAt })
    .from(invoices)
    .where(eq(invoices.creditsInvoiceId, row.id))
    .orderBy(invoices.issuedAt, invoices.id);
  return {
    document: row.document as InvoiceDocument,
    credits: credits.map(credit => ({ ...credit, kind: "credit_note" as const })),
    verifyCode: row.verifyCode ?? (await giveCode(db, row.id)),
  };
}

/** A code for a document issued before codes existed — once, whoever asks first. */
async function giveCode(db: Db, id: number): Promise<string> {
  await db.update(invoices).set({ verifyCode: newVerifyCode() }).where(and(eq(invoices.id, id), isNull(invoices.verifyCode)));
  const [row] = await db.select({ verifyCode: invoices.verifyCode }).from(invoices).where(eq(invoices.id, id)).limit(1);
  return row!.verifyCode!;
}

export type VerifiedDocument = {
  number: string;
  kind: "invoice" | "credit_note";
  issuedAt: string;
  total: string;
  currency: string;
  issuerName: string;
  issuerLicence: string | null;
  sellers: string[];
  /** Whether a later credit note corrects this invoice. */
  corrected: boolean;
};

/**
 * Confirm a printed document is genuine (3.6.6): the number and the code on
 * the paper, checked against what NetLet issued.
 *
 * Public, because whoever holds the paper — an accountant, a ministry, a
 * relative it was a gift for — is rarely the shopper. So it answers only what
 * is already printed beside the code and nothing the paper does not show: no
 * buyer, no address, no lines. A wrong code and an unknown number get the
 * same null, so the endpoint says nothing about which numbers exist.
 */
export async function verifyDocument(number: string, code: string): Promise<VerifiedDocument | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: invoices.id, kind: invoices.kind, document: invoices.document, verifyCode: invoices.verifyCode })
    .from(invoices)
    .where(eq(invoices.number, number))
    .limit(1);
  const given = Buffer.from(code.toUpperCase());
  const held = Buffer.from(row?.verifyCode ?? "");
  if (!row || held.length === 0 || held.length !== given.length || !timingSafeEqual(held, given)) return null;
  const document = row.document as InvoiceDocument;
  const [credit] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.creditsInvoiceId, row.id)).limit(1);
  return {
    number,
    kind: row.kind as "invoice" | "credit_note",
    issuedAt: document.issuedAt,
    total: document.total,
    currency: document.currency,
    issuerName: document.issuer.name,
    issuerLicence: document.issuer.licence,
    sellers: document.sellers.map(seller => seller.name),
    corrected: Boolean(credit),
  };
}

export type InvoiceListRow = InvoiceSummary & { orderReference: string };

/** Every document NetLet has issued, newest first, for an administrator. */
export async function listInvoices(actor: Actor, request: { page?: number; pageSize?: number; query?: string | null } = {}): Promise<Page<InvoiceListRow>> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  const pageSize = clampPageSize(request.pageSize);
  if (!db) return { rows: [], total: 0, page: 1, pageSize };

  const query = request.query?.trim().toUpperCase() ?? "";
  const filter = query
    ? or(sql`${invoices.number} like ${`%${query}%`}`, sql`upper(${orders.reference}) like ${`%${query}%`}`)
    : undefined;
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(filter);
  const total = counted?.n ?? 0;
  const page = clampPage(request.page ?? 1, total, pageSize);
  const rows = await db
    .select({ number: invoices.number, kind: invoices.kind, total: invoices.total, issuedAt: invoices.issuedAt, orderReference: orders.reference })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(filter)
    /* Ends on the id: several documents can share a microsecond. */
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));
  return { rows: rows.map(row => ({ ...row, kind: row.kind as InvoiceKind })), total, page, pageSize };
}
