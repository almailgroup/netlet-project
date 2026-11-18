/**
 * Paying online for an order placed as cash on delivery — the database half
 * of `Shared/commerce/onlinePayment.ts`, on the owner's word (migration 0086).
 *
 * **Only NetLet's test page takes a payment today** ("build a mockup"): no
 * money moves, so a test payment never marks the order `paid` — the finance
 * panel, payouts, invoices and referral points read nothing from it. It does
 * move the order off cash (`payment_method` becomes the method chosen), so
 * nobody records cash against it and the driver's board stops asking for any.
 * Behind the `testPayments` switch, which starts off.
 *
 * **Nothing is charged at a figure the shopper did not see**: the start sends
 * what the page showed (`expectOwed`) and is refused if the order now owes
 * something else, and paying asks the window and the figure again under a
 * lock on the order, so a store cancelling a line between the two presses
 * cannot leave a payment for goods that are no longer coming.
 *
 * **A missing table reads as nothing paid** (`isMissingTable`), so the code can
 * be deployed before 0086 is pasted: until then the order page offers no
 * payment and the board reads as before. Inside a transaction the table is
 * asked about first (`to_regclass`), because a failed read there would abort
 * the transaction it sits in.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orderPayments, orders } from "../../database/schema.js";
import { compareMoney } from "../../../Shared/money.js";
import {
  isOnlineMethod,
  onlinePayWindow,
  type OnlineMethod,
  type PaidOnline,
  type PayRefusal,
} from "../../../Shared/commerce/onlinePayment.js";
import { isMissingTable } from "../core/describeError.js";
import { getDb } from "./db.js";
import { stillOwedFor } from "./owed.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** Refused for a reason the shopper can act on, as a message key. */
export class PaymentRefused extends Error {
  constructor(public readonly reason: PayRefusal | "orders.payMoved" | "orders.payNothingOwed" | "orders.payUnavailable" | "orders.payNotFound") {
    super(reason);
    this.name = "PaymentRefused";
  }
}

/** Whether 0086 is in the database, asked in a way that cannot abort a transaction. */
export async function paymentsTableReady(db: Db): Promise<boolean> {
  const rows = await db.execute(sql`select to_regclass('public.order_payments') is not null as ready`);
  const first = (rows as unknown as { ready: boolean }[])[0] ?? (rows as unknown as { rows?: { ready: boolean }[] }).rows?.[0];
  return Boolean(first?.ready);
}

/** The paid payment on each of these orders, if any. A missing table is none. */
export async function paidOnlineFor(db: Db, orderIds: number[]): Promise<Map<number, PaidOnline>> {
  const out = new Map<number, PaidOnline>();
  if (orderIds.length === 0) return out;
  try {
    const rows = await db
      .select({
        orderId: orderPayments.orderId,
        method: orderPayments.method,
        amount: orderPayments.amount,
        paidAt: orderPayments.paidAt,
        provider: orderPayments.provider,
      })
      .from(orderPayments)
      .where(and(inArray(orderPayments.orderId, orderIds), eq(orderPayments.status, "paid")));
    for (const row of rows) {
      if (!isOnlineMethod(row.method)) continue;
      out.set(row.orderId, {
        method: row.method,
        amount: row.amount,
        paidAt: (row.paidAt ?? new Date()).toISOString(),
        test: row.provider === "test",
      });
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return out;
}

/** Whether online payment can be offered at all: the table is there. */
export async function onlinePaymentsReady(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.select({ id: orderPayments.id }).from(orderPayments).limit(1);
    return true;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

async function lockedOrder(tx: Db, where: ReturnType<typeof and>) {
  const [order] = await tx
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      grandTotal: orders.grandTotal,
      deliveryBreakdown: orders.deliveryBreakdown,
      currency: orders.currency,
    })
    .from(orders)
    .where(where)
    .for("update")
    .limit(1);
  if (!order) return null;
  const lines = await tx.select({ fulfilment: orderItems.fulfilment }).from(orderItems).where(eq(orderItems.orderId, order.id));
  const owed = (await stillOwedFor(tx, [order])).get(order.id)?.owed ?? order.grandTotal;
  return { order, lines, owed };
}

export type StartedPayment = { paymentId: number; reference: string; method: OnlineMethod; amount: string; currency: string };

/**
 * The press on "Pay KWD X now": a payment started at the figure the page
 * showed, for NetLet's test page to finish. An earlier attempt still open on
 * the order is closed as failed, so only the newest can be paid.
 */
export async function startTestPayment(
  userId: number,
  reference: string,
  method: OnlineMethod,
  expectOwed: string,
): Promise<StartedPayment> {
  const db = await handle();
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    if (!(await paymentsTableReady(tx))) throw new PaymentRefused("orders.payUnavailable");
    const found = await lockedOrder(tx, and(eq(orders.reference, reference), eq(orders.userId, userId)));
    if (!found) throw new PaymentRefused("orders.payNotFound");
    const window = onlinePayWindow(found.order, found.lines);
    if (!window.open) throw new PaymentRefused(window.reason);
    if (compareMoney(found.owed, "0") <= 0) throw new PaymentRefused("orders.payNothingOwed");
    if (compareMoney(found.owed, expectOwed) !== 0) throw new PaymentRefused("orders.payMoved");

    await tx
      .update(orderPayments)
      .set({ status: "failed" })
      .where(and(eq(orderPayments.orderId, found.order.id), eq(orderPayments.status, "started")));
    const [row] = await tx
      .insert(orderPayments)
      .values({
        orderId: found.order.id,
        provider: "test",
        method,
        amount: found.owed,
        status: "started",
        providerRef: `test_${randomBytes(12).toString("base64url")}`,
      })
      .returning({ id: orderPayments.id });
    return { paymentId: row!.id, reference: found.order.reference, method, amount: found.owed, currency: found.order.currency };
  });
}

export type PaymentView = {
  paymentId: number;
  reference: string;
  method: OnlineMethod;
  amount: string;
  currency: string;
  status: "started" | "paid" | "failed" | "refunded";
  test: boolean;
};

/** One of the shopper's own payments, for the test page to draw. Null for anybody else's. */
export async function paymentForShopper(userId: number, paymentId: number): Promise<PaymentView | null> {
  const db = await handle();
  try {
    const [row] = await db
      .select({
        id: orderPayments.id,
        reference: orders.reference,
        method: orderPayments.method,
        amount: orderPayments.amount,
        currency: orders.currency,
        status: orderPayments.status,
        provider: orderPayments.provider,
      })
      .from(orderPayments)
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .where(and(eq(orderPayments.id, paymentId), eq(orders.userId, userId)))
      .limit(1);
    if (!row || !isOnlineMethod(row.method)) return null;
    return {
      paymentId: row.id,
      reference: row.reference,
      method: row.method,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      test: row.provider === "test",
    };
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/**
 * The test page's answer: paid, or the shopper backed out.
 *
 * Asked again under a lock on the order — the window and the figure — so a
 * payment started before a store cancelled a line is closed as failed rather
 * than paid at a figure the order no longer owes. Pressing it twice answers
 * what the first press did. A paid one moves the order off cash.
 */
export async function finishTestPayment(
  userId: number,
  paymentId: number,
  outcome: "paid" | "cancelled",
): Promise<PaymentView> {
  const db = await handle();
  /* A refusal is returned from the transaction, not thrown in it: the
     attempt is closed as failed, and that write has to be kept. */
  const refused = await db.transaction(async (raw): Promise<PaymentRefused["reason"] | null> => {
    const tx = raw as unknown as Db;
    if (!(await paymentsTableReady(tx))) return "orders.payUnavailable";
    const [payment] = await tx
      .select({ id: orderPayments.id, orderId: orderPayments.orderId, status: orderPayments.status, amount: orderPayments.amount, method: orderPayments.method, provider: orderPayments.provider })
      .from(orderPayments)
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .where(and(eq(orderPayments.id, paymentId), eq(orders.userId, userId)))
      .limit(1);
    if (!payment || payment.provider !== "test") return "orders.payNotFound";
    if (payment.status !== "started") return null;

    const found = await lockedOrder(tx, eq(orders.id, payment.orderId));
    if (!found) return "orders.payNotFound";

    if (outcome === "cancelled") {
      await tx.update(orderPayments).set({ status: "failed" }).where(and(eq(orderPayments.id, payment.id), eq(orderPayments.status, "started")));
      return null;
    }

    const window = onlinePayWindow(found.order, found.lines);
    const moved = compareMoney(found.owed, payment.amount) !== 0;
    if (!window.open || moved) {
      await tx.update(orderPayments).set({ status: "failed" }).where(and(eq(orderPayments.id, payment.id), eq(orderPayments.status, "started")));
      return window.open ? "orders.payMoved" : window.reason;
    }

    await tx
      .update(orderPayments)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(orderPayments.id, payment.id), eq(orderPayments.status, "started")));
    await tx
      .update(orders)
      .set({ paymentMethod: payment.method })
      .where(and(eq(orders.id, found.order.id), eq(orders.status, "pending_payment")));
    return null;
  }).catch(error => {
    /* The partial unique index: another tab paid this order first. */
    if (String((error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code) === "23505") {
      throw new PaymentRefused("orders.payAlready");
    }
    throw error;
  });
  if (refused) throw new PaymentRefused(refused);
  const view = await paymentForShopper(userId, paymentId);
  if (!view) throw new PaymentRefused("orders.payNotFound");
  return view;
}

/**
 * Give a test payment back when its order closes with nothing left coming —
 * the shopper's cancel or the last line a store cancels. Runs inside the
 * closing transaction, so it asks about the table first. A real gateway's
 * payment would be refunded through the gateway here; only a test one exists.
 */
export async function refundTestPayment(tx: Db, orderId: number): Promise<void> {
  if (!(await paymentsTableReady(tx))) return;
  await tx
    .update(orderPayments)
    .set({ status: "refunded" })
    .where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.status, "paid"), eq(orderPayments.provider, "test")));
}

