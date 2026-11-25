/**
 * The ways each store lets its shoppers pay, on the owner's word ("the vendor
 * can choose what payment method they want users to buy their products with").
 *
 * Pure and shared, for the reason `payment.ts` is: what it decides is whether
 * a basket can be paid at all, and the page must never offer a way the API
 * would refuse.
 *
 * ## The owner's four answers
 *
 * - **All four, at least one.** Cash on delivery, KNET, a card (Visa or
 *   Mastercard) and Apple Pay; a store ticks any of them and keeps one at
 *   least (`storeMethodsProblem`). Cash is the store's cash-on-delivery switch
 *   and limit it always had (`vendors.accepts_cod`, `cod_ceiling`); the
 *   online three are migration 0093's row, and a store with no row takes all
 *   three, so nothing changes for a store until it chooses.
 * - **A cart is offered what all its stores accept** (`sharedMethods`). One
 *   basket is one payment, `payment.ts`'s rule, so a way one store refuses
 *   cannot be used for the others' goods either; when they share none, the
 *   first store that leaves nothing in common is named, and its items are
 *   checked out on their own.
 * - **Shown where somebody decides**: under a product's price, on the
 *   store's page and under each store's lines in the cart (`payLine`).
 * - **The store's owner and managers choose** (`vendor.payments`), and
 *   NetLet changes any store's on its page.
 *
 * ## Online payment is not live yet
 *
 * NetLet has no card gateway (3.2.1), so KNET, a card and Apple Pay are
 * "coming soon" at checkout. **What a store ticks is what its shoppers will be
 * offered once they are live**; until then only cash places an order, so a
 * store that turns cash off cannot be ordered from — its page says so before
 * it saves, and a shopper is told on the product page rather than at
 * checkout. `ONLINE_CHECKOUT_LIVE` is the one place that changes.
 */
import { ONLINE_METHODS, type OnlineMethod } from "./onlinePayment.js";

/** Every way a store can be paid, in the order they are drawn. */
export const STORE_METHODS = ["cod", "knet", "card", "apple_pay"] as const;
export type StoreMethod = (typeof STORE_METHODS)[number];

/** Whether checkout takes KNET, a card and Apple Pay yet. It does not. */
export const ONLINE_CHECKOUT_LIVE = false;

export function isStoreMethod(value: unknown): value is StoreMethod {
  return typeof value === "string" && (STORE_METHODS as readonly string[]).includes(value);
}

/** The online methods named, once each and in the shop's order; anything else dropped. */
export function cleanOnline(values: readonly unknown[] | null | undefined): OnlineMethod[] {
  const named = new Set((values ?? []).filter((value): value is string => typeof value === "string"));
  return ONLINE_METHODS.filter(method => named.has(method));
}

/**
 * The ways one store takes. `online` is its row's list; null is no row (or no
 * table yet), which is all three — a store opts out, the cash rule's
 * direction.
 */
export function storeMethods(acceptsCod: boolean, online: readonly OnlineMethod[] | null): StoreMethod[] {
  const taken = online === null ? ONLINE_METHODS : cleanOnline(online);
  return STORE_METHODS.filter(method => (method === "cod" ? acceptsCod : (taken as readonly string[]).includes(method)));
}

/** What saving this choice would be refused for: a store must keep one way. */
export type StoreMethodsProblem = "storePay.needOne";

export function storeMethodsProblem(cod: boolean, online: readonly unknown[]): StoreMethodsProblem | null {
  return cod || cleanOnline(online).length > 0 ? null : "storePay.needOne";
}

/**
 * What every store in a basket takes, and — when that is nothing — the store
 * that left nothing in common.
 *
 * The stores are walked in the basket's order, narrowing as they go; the
 * first whose ways share none with the stores before it is the one named.
 * Naming the first rather than every one is `codAvailability`'s reason: the
 * fix for it (checking its items out on their own) changes the rest anyway.
 */
export function sharedMethods<T extends { methods: readonly StoreMethod[] }>(stores: readonly T[]): {
  methods: StoreMethod[];
  differs: T | null;
} {
  let shared: StoreMethod[] = [...STORE_METHODS];
  for (const store of stores) {
    const next = shared.filter(method => store.methods.includes(method));
    if (next.length === 0) return { methods: [], differs: store };
    shared = next;
  }
  return { methods: stores.length ? shared : [...STORE_METHODS], differs: null };
}

/**
 * How a list of ways reads to a shopper today: those that work now, and
 * those that are coming. With online payment not live, cash is the only way
 * "now", and a store that takes no cash has nothing that works yet.
 */
export function payLine(methods: readonly StoreMethod[], live = ONLINE_CHECKOUT_LIVE): {
  now: StoreMethod[];
  soon: StoreMethod[];
} {
  const now = methods.filter(method => method === "cod" || live);
  const soon = methods.filter(method => method !== "cod" && !live);
  return { now, soon };
}

/** Whether anything this store takes can pay for an order today. */
export function payableNow(methods: readonly StoreMethod[], live = ONLINE_CHECKOUT_LIVE): boolean {
  return payLine(methods, live).now.length > 0;
}

/** The dictionary's word for each way. */
export function storeMethodKey(method: StoreMethod): `storePay.method.${StoreMethod}` {
  return `storePay.method.${method}`;
}
