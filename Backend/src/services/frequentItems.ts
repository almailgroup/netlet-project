/**
 * Frequently bought, the database half (migration 0073). The rules are
 * `Shared/commerce/frequentItems.ts`; the page is `/account/frequent`.
 *
 * Every query is scoped by the account inside the query, for the reason every
 * order read is: an item id is a serial, short enough to type, so "change
 * item 4" has to be refused by the `where` and not by a check a later caller
 * can skip. Another shopper's item is "not found", never "forbidden".
 *
 * **A product goes on the list only while the shop would show it**, asked of
 * `listProductsByIds` — `publishedCatalog`'s own rule — and only at a variant
 * that product has. The product id stored is the variant's own, read here,
 * never the request's.
 *
 * **Nothing here buys anything.** The list is read and written; reordering is
 * the page putting items in the bag through the bag's own door, and checkout
 * is still the shopper's press.
 *
 * Until the owner pastes migration 0073 the table is missing on a live
 * database, so a read answers "not ready" with nothing on it and a write is
 * refused in a sentence (`frequent.unavailable`) — the warranty table's rule.
 */
import { and, desc, eq, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { frequentItems, orderItems, orders, productVariants } from "../../database/schema.js";
import type { LocalePick } from "../../../Shared/commerce/fromInventory.js";
import type { Product } from "../../../Shared/commerce/types.js";
import {
  FREQUENT_SUGGESTIONS,
  frequentKey,
  frequentQuantity,
  MAX_FREQUENT_ITEMS,
  suggestFrequent,
} from "../../../Shared/commerce/frequentItems.js";
import { listProductsByIds } from "./catalog.js";
import { getDb } from "./db.js";
import { isMissingTable } from "../core/describeError.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export class FrequentRefused extends Error {
  constructor(public readonly reason: "frequent.notFound" | "frequent.full" | "frequent.unavailable") {
    super(reason);
    this.name = "FrequentRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

/** A write while the table is missing says so in a sentence rather than a 500. */
async function orUnavailable<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isMissingTable(error)) throw new FrequentRefused("frequent.unavailable");
    throw error;
  }
}

export type FrequentEntry = {
  id: number;
  productId: string;
  variantId: string;
  quantity: number;
  addedAt: Date;
  /** Today's product as the shop shows it, or null when it is no longer on sale. */
  product: Product | null;
};

/** The shopper's list, newest first, each with today's product. */
export async function listFrequent(userId: number, locale: LocalePick = "en"): Promise<{ ready: boolean; items: FrequentEntry[] }> {
  const db = await handle();
  let rows: { id: number; productId: number; variantId: number; quantity: number; createdAt: Date }[];
  try {
    rows = await db
      .select({
        id: frequentItems.id,
        productId: frequentItems.productId,
        variantId: frequentItems.variantId,
        quantity: frequentItems.quantity,
        createdAt: frequentItems.createdAt,
      })
      .from(frequentItems)
      .where(eq(frequentItems.userId, userId))
      .orderBy(desc(frequentItems.createdAt), desc(frequentItems.id))
      .limit(MAX_FREQUENT_ITEMS);
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, items: [] };
    throw error;
  }
  const products = await listProductsByIds([...new Set(rows.map(row => row.productId))], locale);
  const byId = new Map(products.map(product => [product.id, product]));
  return {
    ready: true,
    items: rows.map(row => ({
      id: row.id,
      productId: String(row.productId),
      variantId: String(row.variantId),
      quantity: row.quantity,
      addedAt: row.createdAt,
      product: byId.get(String(row.productId)) ?? null,
    })),
  };
}

/** The list's entries for one product — what the product page's button reads. */
export async function frequentForProduct(
  userId: number,
  productId: number,
): Promise<{ ready: boolean; entries: { id: number; variantId: string; quantity: number }[] }> {
  const db = await handle();
  try {
    const rows = await db
      .select({ id: frequentItems.id, variantId: frequentItems.variantId, quantity: frequentItems.quantity })
      .from(frequentItems)
      .where(and(eq(frequentItems.userId, userId), eq(frequentItems.productId, productId)));
    return { ready: true, entries: rows.map(row => ({ id: row.id, variantId: String(row.variantId), quantity: row.quantity })) };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, entries: [] };
    throw error;
  }
}

/**
 * Put a product on the list at a variant and an amount, or change the amount
 * if it is already there. Only a product the shop shows, at a variant it has.
 */
export async function addFrequent(
  userId: number,
  input: { productId: number; variantId: number; quantity: number },
): Promise<{ id: number; quantity: number }> {
  const db = await handle();
  const [product] = await listProductsByIds([input.productId]);
  if (!product || !product.variants.some(variant => variant.id === String(input.variantId))) {
    throw new FrequentRefused("frequent.notFound");
  }
  /* The product id is the variant's own row's, never the request's. */
  const [variant] = await db
    .select({ productId: productVariants.productId })
    .from(productVariants)
    .where(eq(productVariants.id, input.variantId))
    .limit(1);
  if (!variant || variant.productId !== input.productId) throw new FrequentRefused("frequent.notFound");
  const quantity = frequentQuantity(input.quantity);

  return orUnavailable(async () => {
    const [existing] = await db
      .select({ id: frequentItems.id })
      .from(frequentItems)
      .where(and(eq(frequentItems.userId, userId), eq(frequentItems.productId, variant.productId), eq(frequentItems.variantId, input.variantId)))
      .limit(1);
    if (!existing) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(frequentItems)
        .where(eq(frequentItems.userId, userId));
      if (count >= MAX_FREQUENT_ITEMS) throw new FrequentRefused("frequent.full");
    }
    const [row] = await db
      .insert(frequentItems)
      .values({ userId, productId: variant.productId, variantId: input.variantId, quantity })
      .onConflictDoUpdate({
        target: [frequentItems.userId, frequentItems.productId, frequentItems.variantId],
        set: { quantity },
      })
      .returning({ id: frequentItems.id, quantity: frequentItems.quantity });
    return row;
  });
}

/** Change the usual amount of one of the shopper's own items. */
export async function setFrequentQuantity(userId: number, id: number, quantity: number): Promise<{ id: number; quantity: number }> {
  const db = await handle();
  return orUnavailable(async () => {
    const [row] = await db
      .update(frequentItems)
      .set({ quantity: frequentQuantity(quantity) })
      .where(and(eq(frequentItems.id, id), eq(frequentItems.userId, userId)))
      .returning({ id: frequentItems.id, quantity: frequentItems.quantity });
    if (!row) throw new FrequentRefused("frequent.notFound");
    return row;
  });
}

/** Take one of the shopper's own items off the list. */
export async function removeFrequent(userId: number, id: number): Promise<void> {
  const db = await handle();
  await orUnavailable(async () => {
    const [row] = await db
      .delete(frequentItems)
      .where(and(eq(frequentItems.id, id), eq(frequentItems.userId, userId)))
      .returning({ id: frequentItems.id });
    if (!row) throw new FrequentRefused("frequent.notFound");
  });
}

export type FrequentSuggestionEntry = {
  productId: string;
  variantId: string;
  timesBought: number;
  lastQuantity: number;
  lastBought: Date;
  product: Product;
};

/**
 * What the shopper has bought before and not put on the list — so setting it
 * up never means going back through their orders. Only their own orders, only
 * lines that were not cancelled, returned or an exchange's free replacement
 * (the bestsellers' rule), and only what the shop still shows at a variant it
 * still has.
 */
export async function frequentSuggestions(userId: number, locale: LocalePick = "en"): Promise<FrequentSuggestionEntry[]> {
  const db = await handle();
  let onList: { productId: number; variantId: number }[];
  try {
    onList = await db
      .select({ productId: frequentItems.productId, variantId: frequentItems.variantId })
      .from(frequentItems)
      .where(eq(frequentItems.userId, userId));
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    onList = [];
  }
  const lines = await db
    .select({
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      orderId: orderItems.orderId,
      placedAt: orders.placedAt,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      eq(orders.userId, userId),
      ne(orders.status, "cancelled"),
      isNotNull(orderItems.productId),
      isNotNull(orderItems.variantId),
      notInArray(orderItems.fulfilment, ["cancelled", "returned"]),
      sql`${orderItems.lineTotal} > 0`,
    ))
    .orderBy(desc(orders.placedAt), desc(orderItems.id))
    .limit(500);
  const ranked = suggestFrequent(
    lines.map(line => ({
      productId: line.productId!,
      variantId: line.variantId!,
      orderId: line.orderId,
      placedAt: line.placedAt,
      quantity: line.quantity,
    })),
    new Set(onList.map(row => frequentKey(row.productId, row.variantId))),
    /* Room for some to have left the shelf since. */
    MAX_FREQUENT_ITEMS,
  );
  if (!ranked.length) return [];
  const products = await listProductsByIds([...new Set(ranked.map(entry => entry.productId))], locale);
  const byId = new Map(products.map(product => [product.id, product]));
  const out: FrequentSuggestionEntry[] = [];
  for (const entry of ranked) {
    const product = byId.get(String(entry.productId));
    if (!product || !product.variants.some(variant => variant.id === String(entry.variantId))) continue;
    out.push({
      productId: String(entry.productId),
      variantId: String(entry.variantId),
      timesBought: entry.timesBought,
      lastQuantity: entry.lastQuantity,
      lastBought: entry.lastBought,
      product,
    });
    if (out.length >= FREQUENT_SUGGESTIONS) break;
  }
  return out;
}
