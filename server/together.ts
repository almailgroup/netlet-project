/**
 * Frequently bought together: the part that needs a database.
 *
 * The ranking is `shared/commerce/together.ts` and is pure. What is here is
 * gathering the baskets — and one decision that is neither: **which baskets
 * count as evidence.**
 *
 * **Orders and carts both, weighted.** Nothing places a paid order in NetLet
 * yet, so an order-only implementation would be a feature that renders nothing
 * until payments land. Carts are populated today and are real evidence of
 * intent, just weaker — so a purchase counts three and a basket counts one,
 * the same ordering `taste.ts` uses and for the same reason. The rail works on
 * day one and gets better the moment money starts moving, with no code change.
 *
 * **A basket is a set of products, not a list of lines.** Two variants of one
 * shirt in a cart is one shopper saying one thing, and counting it twice would
 * double the evidence for every pairing that basket contains. `cart_items` is
 * keyed on the variant and `order_items` can repeat a product across lines, so
 * both are collapsed to distinct products per basket before anything is
 * counted — which is what `collapseObservations` is for and why it is tested
 * on its own.
 *
 * Outside `db.ts` for the reason `profile.ts`, `orders.ts`, `recommendations.ts`,
 * `wishlists.ts` and `reviews.ts` are: functions inside `db.ts` call its
 * module-local `getDb`, which nothing outside can redirect, so they cannot be
 * tested against a real database.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { cartItems, orderItems, orders, productVariants } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { listProducts } from "./catalog.js";
import {
  collapseObservations,
  complementsFor,
  PAIR_WEIGHT,
  type Complement,
  type PairKind,
  type Pairing,
} from "../shared/commerce/together.js";
import type { LocalePick } from "../shared/commerce/fromInventory.js";

/**
 * How many baskets are read before ranking.
 *
 * A ceiling rather than the whole history, because this runs on a product page
 * and the query is the expensive half. Newest first, so the association tracks
 * what the shop is selling now rather than what it sold two years ago — a
 * complement for a discontinued phone is not a complement.
 */
const BASKET_LIMIT = 2000;

type Basket = { id: string; productIds: Set<string> };

/** Every recent basket, as a set of distinct product ids. */
async function recentBaskets(): Promise<{ baskets: Basket[]; observations: Array<{ basketId: string; productId: string; kind: PairKind }> }> {
  const db = await getDb();
  if (!db) return { baskets: [], observations: [] };

  const observations: Array<{ basketId: string; productId: string; kind: PairKind }> = [];

  /*
   * Paid orders only. An order sitting in `pending_payment` is an intention
   * that may still fail, and counting it as a purchase would let an abandoned
   * checkout carry three times the weight of the cart it came from.
   */
  const bought = await db
    .select({ basketId: orderItems.orderId, productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(inArray(orders.status, ["paid", "refunded"]))
    .orderBy(sql`${orderItems.orderId} desc`)
    .limit(BASKET_LIMIT);

  for (const row of bought) {
    if (row.productId === null) continue;
    observations.push({ basketId: `o${row.basketId}`, productId: String(row.productId), kind: "bought" });
  }

  const bagged = await db
    .select({ basketId: cartItems.cartId, productId: productVariants.productId })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .orderBy(sql`${cartItems.id} desc`)
    .limit(BASKET_LIMIT);

  for (const row of bagged) {
    observations.push({ basketId: `c${row.basketId}`, productId: String(row.productId), kind: "bagged" });
  }

  // Collapse to distinct products per basket. See the file comment.
  const byBasket = new Map<string, Set<string>>();
  for (const observation of observations) {
    const set = byBasket.get(observation.basketId) ?? new Set<string>();
    set.add(observation.productId);
    byBasket.set(observation.basketId, set);
  }

  return {
    baskets: [...byBasket].map(([id, productIds]) => ({ id, productIds })),
    observations,
  };
}

/**
 * The complements of one product.
 *
 * Every number handed to the pure ranker is weighted the same way, so the lift
 * it computes is a ratio of like for like: a basket contributes its kind's
 * weight to the anchor total, to each pairing, and to the universe.
 */
export async function boughtTogether(
  productId: string,
  options: { limit?: number; locale?: LocalePick } = {},
): Promise<Complement[]> {
  const { baskets, observations } = await recentBaskets();
  if (baskets.length === 0) return [];

  /*
   * One weight per basket, taken from the strongest observation in it. A
   * basket that was bought is worth three wherever it appears — in the
   * universe, in the anchor's total and in every pairing — so the three
   * numbers lift divides are measured on one scale.
   */
  const basketWeight = new Map<string, number>();
  for (const observation of observations) {
    const weight = PAIR_WEIGHT[observation.kind];
    basketWeight.set(observation.basketId, Math.max(basketWeight.get(observation.basketId) ?? 0, weight));
  }

  let universe = 0;
  let anchorTotal = 0;
  const together = new Map<string, number>();
  const totals = new Map<string, number>();

  for (const basket of baskets) {
    const weight = basketWeight.get(basket.id) ?? PAIR_WEIGHT.bagged;
    universe += weight;

    for (const id of basket.productIds) totals.set(id, (totals.get(id) ?? 0) + weight);

    if (!basket.productIds.has(productId)) continue;
    anchorTotal += weight;
    for (const id of basket.productIds) {
      if (id === productId) continue;
      together.set(id, (together.get(id) ?? 0) + weight);
    }
  }

  if (anchorTotal === 0) return [];

  const pairings: Pairing[] = [...together].map(([id, count]) => ({
    productId: id,
    together: count,
    total: totals.get(id) ?? 0,
  }));

  /*
   * `listProducts` reads `publishedCatalog`, so a draft or a suspended
   * vendor's product is absent from this rail for the same reason it is absent
   * from the shop — even if half the town bought it last month.
   */
  const catalog = await listProducts({ first: 200, locale: options.locale ?? "en" });
  const byId = new Map(catalog.map(product => [product.id, product]));

  const anchor = byId.get(productId);
  if (!anchor) return [];

  return complementsFor(anchor, anchorTotal, universe, pairings, byId, options.limit ?? 4);
}

/** Exposed for tests: the weight collapsing, without the database. */
export { collapseObservations };
