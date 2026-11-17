/**
 * Tax's database half (migration 0087). The rule is `Shared/commerce/tax.ts`:
 * added at checkout, on the goods, one shop rate, on every product or only the
 * ones NetLet marked, each product's own mark winning over the default.
 *
 * **Closed, not broken, until 0087 is pasted.** Every read answers "no tax"
 * while either table is missing, so the shop sells exactly as it did, and
 * marking a product refuses with `tax.unavailable` rather than failing.
 * `ready` says which, so the features page can say what it waits for.
 *
 * **The switch is read first and alone.** The cart is read on every visit to
 * it, so while tax is off — which is how every shop starts — this costs one
 * small read and nothing else.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { orderItemTaxes, productTax, products } from "../../database/schema.js";
import { addMoney, fromFils, toFils } from "../../../Shared/money.js";
import {
  choiceFromRow,
  NO_TAX,
  rateText,
  rowRateFor,
  taxLines,
  type ProductTaxChoice,
  type TaxRules,
} from "../../../Shared/commerce/tax.js";
import { assertCan, can, type Actor } from "../../../Shared/inventory/permissions.js";
import { isMissingTable } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { featureOn } from "./features.js";
import { auditActor } from "./inventory.js";
import { settingValue } from "./settings.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** The rules as they stand, and whether 0087 is there to record any of it. */
export type TaxStanding = TaxRules & { ready: boolean; switchedOn: boolean };

/** Whether both of 0087's tables exist: one read, no exception to catch. */
export async function taxTablesReady(db: Db): Promise<boolean> {
  const [row] = await db.execute<{ ready: boolean }>(
    sql`select (to_regclass('public.product_tax') is not null and to_regclass('public.order_item_taxes') is not null) as ready`,
  ).then(result => (Array.isArray(result) ? result : (result as { rows: { ready: boolean }[] }).rows));
  return Boolean(row?.ready);
}

/**
 * The shop's tax rules now. Off — `NO_TAX` — while the switch is off or 0087
 * is not pasted; `switchedOn` still says which, for the features page.
 */
export async function taxRules(db?: Db | null): Promise<TaxStanding> {
  const handle = db ?? (await getDb());
  if (!handle) return { ...NO_TAX, ready: false, switchedOn: false };
  const switchedOn = await featureOn("tax");
  if (!switchedOn) return { ...NO_TAX, ready: true, switchedOn };
  const [ready, allProducts, ratePercent] = await Promise.all([
    taxTablesReady(handle),
    featureOn("taxAllProducts"),
    settingValue("tax.ratePercent", handle),
  ]);
  return { on: ready, ratePercent: rateText(ratePercent), allProducts, ready, switchedOn };
}

/** Each product's own mark, where NetLet made one. Missing table: none. */
export async function productTaxChoices(db: Db, productIds: readonly number[]): Promise<Map<number, ProductTaxChoice>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  try {
    const rows = await db.select({ productId: productTax.productId, rate: productTax.rate }).from(productTax).where(inArray(productTax.productId, ids));
    return new Map(rows.map(row => [row.productId, choiceFromRow(row.rate, true)!]));
  } catch (error) {
    if (isMissingTable(error)) return new Map();
    throw error;
  }
}

export type LineForTax = { productId: number | null; lineTotal: string };

/**
 * The tax on each line, in the order given, by the rules now — the one reader
 * the bag and the order both ask, so what the cart says is what the order
 * freezes. A line whose product has gone is not taxed.
 */
export async function taxForLines(db: Db, lines: readonly LineForTax[], standing?: TaxStanding) {
  const rules = standing ?? (await taxRules(db));
  if (!rules.on || lines.length === 0) return { rules, amounts: lines.map(() => "0.000"), total: "0.000" };
  const choices = await productTaxChoices(db, lines.flatMap(line => (line.productId === null ? [] : [line.productId])));
  const { amounts, total } = taxLines(
    rules,
    lines.map(line => ({
      lineTotal: line.lineTotal,
      choice: line.productId === null ? "exempt" : choices.get(line.productId) ?? null,
    })),
  );
  return { rules, amounts, total };
}

/** Freezes each order line's tax beside it, inside the order's own transaction. */
export async function freezeLineTaxes(
  db: Db,
  orderId: number,
  rows: readonly { orderItemId: number; amount: string }[],
  ratePercent: string,
): Promise<void> {
  const charged = rows.filter(row => toFils(row.amount) > 0n);
  if (charged.length === 0) return;
  await db.insert(orderItemTaxes).values(charged.map(row => ({
    orderItemId: row.orderItemId,
    orderId,
    rate: rateText(ratePercent),
    amount: row.amount,
    included: false,
  })));
}

export type FrozenLineTax = { orderId: number; rate: string; amount: string };

/**
 * What each line of these orders was taxed, as frozen. Missing table: nothing.
 * Asked whether the table is there first rather than catching, because it is
 * read inside transactions (changing an order, a refund), where a failed
 * read aborts everything after it.
 */
export async function frozenLineTaxes(db: Db, orderIds: readonly number[]): Promise<Map<number, FrozenLineTax>> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Map();
  if (!(await taxTablesReady(db))) return new Map();
  try {
    const rows = await db
      .select({ orderItemId: orderItemTaxes.orderItemId, orderId: orderItemTaxes.orderId, rate: orderItemTaxes.rate, amount: orderItemTaxes.amount })
      .from(orderItemTaxes)
      .where(inArray(orderItemTaxes.orderId, ids));
    return new Map(rows.map(row => [row.orderItemId, { orderId: row.orderId, rate: row.rate, amount: row.amount }]));
  } catch (error) {
    if (isMissingTable(error)) return new Map();
    throw error;
  }
}

/** Each order's tax, the sum of its lines', with the rate it was charged at. */
export async function orderTaxes(db: Db, orderIds: readonly number[]): Promise<Map<number, { amount: string; rate: string }>> {
  const out = new Map<number, { amount: string; rate: string }>();
  for (const line of (await frozenLineTaxes(db, orderIds)).values()) {
    const seen = out.get(line.orderId);
    out.set(line.orderId, { amount: addMoney(seen?.amount ?? "0.000", line.amount), rate: seen?.rate ?? line.rate });
  }
  return out;
}

/** The tax a line carried, or nothing: for the figures that read one line at a time. */
export function lineTaxOf(taxes: ReadonlyMap<number, FrozenLineTax>, orderItemId: number): string {
  return taxes.get(orderItemId)?.amount ?? "0.000";
}

/** Splits a line's frozen tax row when part of the line is cancelled (changing an order). */
export async function moveLineTax(db: Db, from: number, to: number, orderId: number, rate: string, kept: string, gone: string): Promise<void> {
  if (toFils(kept) > 0n) await db.update(orderItemTaxes).set({ amount: kept }).where(eq(orderItemTaxes.orderItemId, from));
  else await db.delete(orderItemTaxes).where(eq(orderItemTaxes.orderItemId, from));
  if (toFils(gone) > 0n) await db.insert(orderItemTaxes).values({ orderItemId: to, orderId, rate, amount: gone, included: false });
}

/** A product's tax as its editor shows it. */
export async function productTaxStatus(actor: Actor, productId: number) {
  assertCan(actor, "product.view");
  const db = await getDb();
  const standing = await taxRules(db);
  const choice = db ? (await productTaxChoices(db, [productId])).get(productId) ?? null : null;
  const defaultTaxed = standing.allProducts;
  return {
    ready: standing.ready,
    on: standing.switchedOn,
    ratePercent: standing.switchedOn ? standing.ratePercent : rateText(db ? await settingValue("tax.ratePercent", db) : "5.00"),
    allProducts: standing.switchedOn ? standing.allProducts : await featureOn("taxAllProducts"),
    choice,
    /** Taxed by today's rules — on or off, so the editor can say "would be". */
    taxed: choice ? choice === "taxed" : standing.switchedOn ? defaultTaxed : await featureOn("taxAllProducts"),
    mayChange: can(actor, "platform.configure"),
  };
}

/** A tax mark refused: 0087 not pasted, or a product that is not there. */
export class TaxRefused extends Error {
  constructor(key: "tax.unavailable" | "tax.noProduct") {
    super(key);
    this.name = "TaxRefused";
  }
}

/**
 * Marks a product taxed or not taxed on its own, or puts it back on the shop's
 * default (`follow`). NetLet's alone (`platform.configure`), on the owner's
 * word: NetLet issues the invoice, so declaring tax is NetLet's. On the trail.
 */
export async function setProductTax(actor: Actor, productId: number, choice: ProductTaxChoice | "follow"): Promise<void> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (!(await taxTablesReady(db))) throw new TaxRefused("tax.unavailable");
  const [product] = await db.select({ id: products.id, title: products.title }).from(products).where(eq(products.id, productId)).limit(1);
  if (!product) throw new TaxRefused("tax.noProduct");
  const before = (await productTaxChoices(db, [productId])).get(productId) ?? "follow";
  if (choice === "follow") {
    await db.delete(productTax).where(eq(productTax.productId, productId));
  } else {
    const rate = rowRateFor(choice);
    await db
      .insert(productTax)
      .values({ productId, rate, updatedAt: new Date() })
      .onConflictDoUpdate({ target: productTax.productId, set: { rate, updatedAt: new Date() } });
  }
  await recordAudit(await auditActor(actor), {
    action: "product.setTax",
    subjectType: "product",
    subjectId: productId,
    subjectLabel: product.title,
    before: { tax: before },
    after: { tax: choice },
  });
}

/** How many products NetLet marked taxed — the features page's note when only those are. */
export async function markedTaxedCount(db: Db): Promise<number> {
  try {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(productTax).where(sql`(${productTax.rate} is null or ${productTax.rate} > 0)`);
    return Number(row?.count ?? 0);
  } catch (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
}

/** Re-exported so callers sum a frozen line's tax the one way. */
export const taxFils = (amount: string) => toFils(amount);
export const taxFromFils = (fils: bigint) => fromFils(fils);
