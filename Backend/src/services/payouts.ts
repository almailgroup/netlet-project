/**
 * The weekly payout report's reads.
 *
 * The arithmetic is pure in `Shared/commerce/payouts.ts`. This is the half
 * that cannot be: pulling the frozen lines out of `order_items` and joining
 * them to the order that says whether the money moved.
 *
 * Outside `db.ts` for the reason `finance.ts` and `orders.ts` are: functions
 * inside it reach its module-local `getDb`, which nothing outside can
 * redirect, so anything living there cannot be tested against a real database.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { orderItems, orders, payoutRunItems, payoutRuns, vendors } from "../../database/schema.js";
import { payoutsByVendor, totalOwed, type PayoutLine } from "../../../Shared/commerce/payouts.js";
import { payoutDue } from "../../../Shared/commerce/payoutSchedule.js";
import { lineOutcome } from "../../../Shared/commerce/finance.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { getDb } from "./db.js";

/** The same ceiling the finance panel uses, and it says when it hit it. */
const LINE_CEILING = 20_000;

/**
 * What every seller is owed, by week.
 *
 * Scoped in the query: an administrator sees every seller, a vendor member
 * sees their own company and nothing else. A vendor reading the whole payout
 * run would be reading their competitors' revenue.
 */
export async function payoutReport(
  actor: Actor,
  range: { from?: Date | null; to?: Date | null } = {},
) {
  /* A vendor may read their own; anything wider needs `platform.viewAll`. */
  const scoped = actor.kind === "vendor" ? actor.vendorId : undefined;
  if (scoped === undefined) assertCan(actor, "platform.viewAll");
  else assertCan(actor, "product.view", scoped);

  const db = await getDb();
  if (!db) return { vendors: [], owed: "0.000", truncated: false };

  const rows = await db
    .select({
      orderStatus: orders.status,
      placedAt: orders.placedAt,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      lineTotal: orderItems.lineTotal,
      commissionAmount: orderItems.commissionAmount,
      vendorNet: orderItems.vendorNet,
      fulfilment: orderItems.fulfilment,
      /* What decides when this money is actually due (3.3.21). */
      paymentMethod: orders.paymentMethod,
      paymentCollectedAt: orders.paymentCollectedAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        inArray(orders.status, ["paid", "refunded"]),
        scoped === undefined ? undefined : eq(orderItems.vendorId, scoped),
        range.from ? gte(orders.placedAt, range.from) : undefined,
        range.to ? lte(orders.placedAt, range.to) : undefined,
      ),
    )
    .limit(LINE_CEILING + 1);

  const truncated = rows.length > LINE_CEILING;
  const lines = (truncated ? rows.slice(0, LINE_CEILING) : rows) as PayoutLine[];
  const byVendor = payoutsByVendor(lines);

  return { vendors: byVendor, owed: totalOwed(byVendor), truncated };
}

/**
 * Which sellers trade under NetLet's own licence.
 *
 * Admin-only: it names companies, and one seller learning that another has no
 * licence of their own is not a fact NetLet should be handing out.
 */
export async function sellersUnderPlatformLicence(actor: Actor) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: vendors.id, name: vendors.name, licenceNumber: vendors.licenceNumber })
    .from(vendors)
    .where(eq(vendors.underPlatformLicence, true))
    .orderBy(vendors.name);
}

/**
 * When each completed order's money is due to its seller (3.3.21).
 *
 * Per order rather than per week, because the schedule runs from when the
 * money *arrived* and two orders in one week can settle a fortnight apart —
 * a cash order collected on the Sunday and one still uncollected on the
 * Thursday are not the same obligation.
 *
 * Scoped like the report it sits beside: a vendor sees their own, an admin
 * every seller's.
 */
export async function payoutDueList(actor: Actor, limit = 200) {
  const scoped = actor.kind === "vendor" ? actor.vendorId : undefined;
  if (scoped === undefined) assertCan(actor, "platform.viewAll");
  else assertCan(actor, "product.view", scoped);

  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      status: orders.status,
      placedAt: orders.placedAt,
      paymentMethod: orders.paymentMethod,
      paymentCollectedAt: orders.paymentCollectedAt,
      vendorId: orderItems.vendorId,
      vendorName: orderItems.vendorName,
      vendorNet: orderItems.vendorNet,
      fulfilment: orderItems.fulfilment,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      /*
       * Wider than the weekly report on purpose. That one counts money that
       * moved; this one answers "when does it arrive", and a cash order placed
       * but not yet collected is exactly what a seller needs to see coming —
       * it is the whole point of a fourteen-day cash schedule. `payoutDue`
       * reports it as `unpaid`, which is unreachable if the query excludes it.
       */
      inArray(orders.status, ["paid", "refunded", "pending_payment"]),
      scoped === undefined ? undefined : eq(orderItems.vendorId, scoped),
    ))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(limit);

  /*
   * What this order owes its seller.
   *
   * Nothing on an order nobody has paid for: the figure is what *would* be due,
   * and inventing it before the money exists is how a seller plans around a
   * number that may never arrive.
   *
   * And nothing on a refunded one either, which is the half that was wrong. It
   * read `-net`, as a reversal — but there is no payout-run ledger for it to
   * reverse against, so a refund did not cancel a payment, it invented a debt:
   * the "When it is due" table showed a seller owing NetLet 210 for an order
   * whose money had gone straight back to the shopper. `finance.ts` states the
   * rule this now follows: a refunded line adds no commission and no vendor net.
   */
  /* And nothing on a line that never sold or came back — `lineOutcome`, the
     rule the finance report and the weekly table use, so a seller is never told
     a cancelled sofa is coming to them. */
  const owedOn = (status: string, fulfilment: string, net: bigint) =>
    (lineOutcome(status, fulfilment) === "sold" ? net : 0n);

  const now = new Date();
  /* One row per order per seller: an order spanning three sellers is three
     obligations with three different owners, even though it settled once. */
  const byKey = new Map<string, { orderId: number; reference: string; vendorId: number | null; vendorName: string | null; owed: bigint; due: ReturnType<typeof payoutDue> }>();
  for (const row of rows) {
    const key = `${row.orderId}:${row.vendorId}`;
    const held = byKey.get(key);
    const net = toFils(row.vendorNet);
    if (held) {
      held.owed += owedOn(row.status, row.fulfilment, net);
      continue;
    }
    byKey.set(key, {
      orderId: row.orderId,
      reference: row.reference,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      owed: owedOn(row.status, row.fulfilment, net),
      due: payoutDue(row, now),
    });
  }

  /* What has already been sent against each (3.3.21), so an order paid out is
     not still listed as coming — the schedule and the ledger answer one
     question and must not disagree on one page. */
  const orderIds = [...new Set([...byKey.values()].map(entry => entry.orderId))];
  /* Split by where the run is: a prepared run is committed but has not left
     the bank, and "Sent" over money still waiting on somebody's upload is a
     seller told to check an account that has nothing in it yet. */
  const paidRows = orderIds.length
    ? await db
        .select({
          orderId: payoutRunItems.orderId,
          vendorId: payoutRunItems.vendorId,
          paid: sql<string>`coalesce(sum(${payoutRunItems.amount}) filter (where ${payoutRuns.status} = 'sent'), 0)`,
          sending: sql<string>`coalesce(sum(${payoutRunItems.amount}) filter (where ${payoutRuns.status} = 'prepared'), 0)`,
        })
        .from(payoutRunItems)
        .innerJoin(payoutRuns, eq(payoutRunItems.runId, payoutRuns.id))
        .where(inArray(payoutRunItems.orderId, orderIds))
        .groupBy(payoutRunItems.orderId, payoutRunItems.vendorId)
    : [];
  const paid = new Map(paidRows.map(row => [`${row.orderId}:${row.vendorId}`, toFils(row.paid)]));
  const sending = new Map(paidRows.map(row => [`${row.orderId}:${row.vendorId}`, toFils(row.sending)]));

  return [...byKey.values()].map(entry => ({
    orderId: entry.orderId,
    reference: entry.reference,
    vendorId: entry.vendorId,
    vendorName: entry.vendorName?.trim() || `#${entry.vendorId ?? "—"}`,
    owed: fromFils(entry.owed),
    paid: fromFils(paid.get(`${entry.orderId}:${entry.vendorId}`) ?? 0n),
    sending: fromFils(sending.get(`${entry.orderId}:${entry.vendorId}`) ?? 0n),
    due: entry.due,
  }));
}
