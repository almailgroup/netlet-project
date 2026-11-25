/**
 * The ways each store lets its shoppers pay (migration 0093,
 * `Shared/commerce/storePayments.ts`), on the owner's word.
 *
 * Cash stays where it always was — `vendors.accepts_cod` and its ceiling —
 * and the online three are `vendor_payment_methods`, one row per store; no
 * row is all three. **Closed, not broken, until 0093 is pasted**: a missing
 * table reads as every store taking all three, the page says the online
 * choices are not open yet, and a save still writes the cash.
 *
 * Choosing is `vendor.payments` — a store's owner and managers, on the
 * owner's word, and NetLet's people whose role reaches stores or money —
 * asked of the store named, and on the trail as `vendor.setPayments`.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { vendorPaymentMethods, vendors } from "../../database/schema.js";
import { ONLINE_METHODS, type OnlineMethod } from "../../../Shared/commerce/onlinePayment.js";
import {
  cleanOnline,
  ONLINE_CHECKOUT_LIVE,
  storeMethods,
  storeMethodsProblem,
  type StoreMethod,
  type StoreMethodsProblem,
} from "../../../Shared/commerce/storePayments.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { isMissingTable } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";
import { auditActor } from "./inventory.js";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class StorePaymentsRefused extends Error {
  constructor(readonly reason: StoreMethodsProblem | "storePay.notFound") {
    super(reason);
  }
}

/* Asked once and kept once found; while missing, asked again a minute later,
   so the paste is noticed without a deploy. */
const ASK_AGAIN_MS = 60_000;
let present = false;
let checkedAt = 0;

export async function paymentTableReady(database: Database | Tx): Promise<boolean> {
  if (present) return true;
  if (checkedAt !== 0 && Date.now() - checkedAt < ASK_AGAIN_MS) return false;
  const result = await database.execute<{ ready: boolean }>(
    sql`select to_regclass('public.vendor_payment_methods') is not null as ready`,
  );
  const rows = Array.isArray(result) ? result : (result as { rows: { ready: boolean }[] }).rows;
  present = Boolean(rows[0]?.ready);
  checkedAt = Date.now();
  return present;
}

/** For tests that rename the table away and back. */
export function forgetPaymentTableReadiness(): void {
  present = false;
  checkedAt = 0;
}

/**
 * Each store's online methods, for the stores that have chosen; a store not
 * in the map takes all three. Before 0093, nobody has chosen.
 */
export async function onlineMethodsFor(database: Database | Tx, vendorIds: readonly number[]): Promise<Map<number, OnlineMethod[]>> {
  const found = new Map<number, OnlineMethod[]>();
  const ids = [...new Set(vendorIds)];
  if (ids.length === 0 || !(await paymentTableReady(database))) return found;
  try {
    const rows = await database
      .select({ vendorId: vendorPaymentMethods.vendorId, online: vendorPaymentMethods.onlineMethods })
      .from(vendorPaymentMethods)
      .where(inArray(vendorPaymentMethods.vendorId, ids));
    for (const row of rows) found.set(row.vendorId, cleanOnline(row.online));
  } catch (error) {
    /* Renamed away after it was found: as though it was never pasted. */
    if (!isMissingTable(error)) throw error;
    forgetPaymentTableReadiness();
  }
  return found;
}

/** Every way each store takes, cash included, for the stores given. */
export async function methodsForStores(
  database: Database | Tx,
  stores: readonly { id: number; acceptsCod: boolean }[],
): Promise<Map<number, StoreMethod[]>> {
  const online = await onlineMethodsFor(database, stores.map(store => store.id));
  return new Map(stores.map(store => [store.id, storeMethods(store.acceptsCod, online.get(store.id) ?? null)]));
}

/** What the store's page and NetLet's section show and edit. */
export type StorePaymentsView = {
  vendorId: number;
  name: string;
  nameAr: string | null;
  /** Whether the online choices can be saved: false until 0093 is pasted. */
  ready: boolean;
  cod: boolean;
  codCeiling: string | null;
  online: OnlineMethod[];
  /** Every way the store takes, in the shop's order. */
  methods: StoreMethod[];
  /** Whether checkout takes the online ways yet. */
  live: boolean;
};

async function viewOf(database: Database | Tx, vendorId: number): Promise<StorePaymentsView> {
  const [store] = await database
    .select({ id: vendors.id, name: vendors.name, nameAr: vendors.nameAr, acceptsCod: vendors.acceptsCod, codCeiling: vendors.codCeiling })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  if (!store) throw new StorePaymentsRefused("storePay.notFound");
  const ready = await paymentTableReady(database);
  const chosen = (await onlineMethodsFor(database, [vendorId])).get(vendorId) ?? null;
  const online = chosen ?? [...ONLINE_METHODS];
  return {
    vendorId: store.id,
    name: store.name,
    nameAr: store.nameAr?.trim() || null,
    ready,
    cod: store.acceptsCod,
    codCeiling: store.codCeiling,
    online,
    methods: storeMethods(store.acceptsCod, chosen),
    live: ONLINE_CHECKOUT_LIVE,
  };
}

export async function getStorePayments(actor: Actor, vendorId: number): Promise<StorePaymentsView> {
  assertCan(actor, "vendor.payments", vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return viewOf(db, vendorId);
}

export type StorePaymentsInput = { cod: boolean; codCeiling: string | null; online: readonly unknown[] };

/**
 * Saves the ways a store takes. At least one, asked again here: before 0093
 * the online three cannot be switched off, so the store keeps them whatever
 * was sent and only the cash is written.
 */
export async function setStorePayments(actor: Actor, vendorId: number, input: StorePaymentsInput): Promise<StorePaymentsView> {
  assertCan(actor, "vendor.payments", vendorId);
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const online = cleanOnline(input.online);
  const ceiling = input.cod ? input.codCeiling?.trim() || null : null;

  const { before, after } = await db.transaction(async tx => {
    /* The store's row locked, so two people saving at once land in turn. */
    const [locked] = await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).for("update").limit(1);
    if (!locked) throw new StorePaymentsRefused("storePay.notFound");
    const was = await viewOf(tx, vendorId);
    const problem = storeMethodsProblem(input.cod, was.ready ? online : ONLINE_METHODS);
    if (problem) throw new StorePaymentsRefused(problem);
    /* A ceiling is kept while cash is off, so turning cash back on finds it. */
    await tx
      .update(vendors)
      .set({ acceptsCod: input.cod, ...(input.cod ? { codCeiling: ceiling } : {}) })
      .where(eq(vendors.id, vendorId));
    if (was.ready) {
      await tx
        .insert(vendorPaymentMethods)
        .values({ vendorId, onlineMethods: online })
        .onConflictDoUpdate({ target: vendorPaymentMethods.vendorId, set: { onlineMethods: online, updatedAt: new Date() } });
    }
    return { before: was, after: await viewOf(tx, vendorId) };
  });

  await recordAudit(await auditActor(actor), {
    action: "vendor.setPayments",
    subjectType: "vendor",
    subjectId: vendorId,
    subjectLabel: after.name,
    vendorId,
    before: { methods: before.methods, codCeiling: before.codCeiling },
    after: { methods: after.methods, codCeiling: after.codCeiling },
  });
  return after;
}

/**
 * Whether turning cash off on a store's details (NetLet's older save, which an
 * installed app still sends) would leave the store with no way to be paid.
 */
export async function cashOffLeavesNothing(database: Database | Tx, vendorId: number): Promise<boolean> {
  if (!(await paymentTableReady(database))) return false;
  const chosen = (await onlineMethodsFor(database, [vendorId])).get(vendorId);
  return chosen !== undefined && chosen.length === 0;
}
