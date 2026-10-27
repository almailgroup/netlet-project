/**
 * The bag drawn by store: each store's lines together, with that store's own
 * delivery beside them rather than in a list under the total.
 *
 * Each store charges its own delivery and the shopper pays each (3.2.4), so a
 * bag from three shops is three parcels — and the line that says what a
 * parcel costs, or what to add for it to cost nothing, belongs next to the
 * things in that parcel. A store can have more than one parcel (a fast line
 * rides on its own; a line can go to another door), so a group carries every
 * delivery row the server priced for that store.
 *
 * Grouped by the store's address (`slug`) rather than its id, because a line
 * the bag draws before the server has answered (`ghostLine`) knows the store
 * only by the card's product, which carries the slug and not the id. A bag
 * with any line that names no store at all — the demo build's — is not
 * grouped, and is drawn as one list as it always was.
 */
import { toFils } from "@shared/money";
import type { Cart, CartDeliveryLine, CartItem } from "@shared/commerce/types";

export type BagStore = NonNullable<CartItem["vendor"]>;

export type BagGroup = {
  key: string;
  store: BagStore;
  items: CartItem[];
  /** The parcels the server priced for this store, regular first. */
  delivery: CartDeliveryLine[];
};

export function bagGroups(cart: Pick<Cart, "items" | "delivery">): BagGroup[] | null {
  if (!cart.items.length || cart.items.some(item => !item.vendor)) return null;
  const groups = new Map<string, BagGroup>();
  for (const item of cart.items) {
    const store = item.vendor!;
    const group = groups.get(store.slug);
    if (!group) {
      groups.set(store.slug, { key: store.slug, store, items: [item], delivery: [] });
      continue;
    }
    group.items.push(item);
    /* A line the server has answered for knows the store's id; one drawn
       ahead of the answer may not. */
    if (group.store.id == null && store.id != null) group.store = store;
  }
  for (const group of groups.values()) {
    group.delivery = cart.delivery.perVendor
      .filter(row => row.vendorId != null && row.vendorId === group.store.id)
      .sort((a, b) => Number(a.choice === "fast") - Number(b.choice === "fast"));
  }
  return [...groups.values()];
}

/**
 * How far this parcel is toward its free delivery, from 0 to 1, or null when
 * there is no threshold left to reach. Display only: the sum it draws is the
 * server's `goods` and `toFree`, never one worked out here.
 */
export function freeDeliveryProgress(row: Pick<CartDeliveryLine, "goods" | "toFree">): number | null {
  if (!row.toFree) return null;
  const goods = toFils(row.goods.amount);
  const threshold = goods + toFils(row.toFree.amount);
  if (threshold <= 0n) return null;
  return Math.min(1, Math.max(0, Number(goods) / Number(threshold)));
}
