/**
 * What the bag looks like the moment a button is pressed, before the server
 * has answered.
 *
 * Every press on Add, plus, minus or the bin used to wait for the round trip
 * before anything moved — a spinner in the pill, the stepper greyed out, the
 * header's count still on the old number — so on a phone each tap took a
 * third of a second to be believed. The bag now changes at once by these
 * rules, the server's answer replaces the guess when it lands, and a refusal
 * puts the bag back as the server has it.
 *
 * Only what the press itself decides is guessed: the quantity, the line, and
 * the line total and subtotal that follow from the bag's own unit prices. A
 * delivery fee depends on each seller's threshold and is the server's to
 * answer, so the total carries the old delivery until it does, and the page
 * draws the money as updating while it is (`syncing`).
 *
 * Pure, so the rules are tested apart from the network.
 */
import type { Cart, CartItem, Product } from "@shared/commerce/types";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";
import { EACH } from "@shared/commerce/units";
import { addMoney, multiplyMoney } from "@shared/money";

export type BagOp =
  | { kind: "add"; variantId: string; quantity: number; ghost: CartItem | null; addonIds?: string[]; bundleId?: number }
  | { kind: "set"; lineId: string; quantity: number }
  | { kind: "remove"; lineId: string };

/**
 * A line the press drew before the server made it. Its id says which variant
 * it is for, so a plus pressed on it before the answer can be sent to the
 * real line once there is one.
 */
const GHOST = "pending:";
export const ghostLineId = (variantId: string) => `${GHOST}${variantId}`;
export const ghostVariant = (lineId: string) => (lineId.startsWith(GHOST) ? lineId.slice(GHOST.length) : null);

/** The bag before there is one, so the first item has somewhere to be drawn. */
export const NO_BAG: Cart = {
  id: "",
  checkoutUrl: "/checkout",
  items: [],
  itemCount: 0,
  subtotal: { amount: "0.000", currencyCode: "KWD" },
  delivery: { perVendor: [], total: { amount: "0.000", currencyCode: "KWD" }, memberWaived: null },
  cod: { available: true },
  recovery: { remind: false },
  total: { amount: "0.000", currencyCode: "KWD" },
};

/**
 * The line a card's Add makes, drawn from the card's own product: the plain
 * line, at the shelf price. Null for a variant the product does not have.
 */
export function ghostLine(product: Product, variantId: string, quantity: number): CartItem | null {
  const variant = product.variants.find(entry => entry.id === variantId);
  if (!variant) return null;
  return withQuantity({
    lineId: ghostLineId(variantId),
    variantId,
    productHandle: product.handle,
    /* Already in the page's language: the catalogue was read in it. */
    productTitle: product.title,
    productTitleAr: null,
    variantTitle: variant.title,
    image: product.images[0] ?? null,
    unitPrice: variant.price,
    agreedFrom: null,
    priceReason: null,
    quantity,
    addons: [],
    addonsTotal: null,
    bundleName: null,
    destination: null,
    /* The card knows its store by address only; the server's answer adds the id. */
    vendor: product.vendorSlug ? { id: null, name: product.vendor ?? "", nameAr: null, slug: product.vendorSlug } : null,
    lineTotal: variant.price,
    measure: variant.measure ?? EACH,
  }, quantity);
}

/** A line at another quantity, its total from its own unit price and extras — the server's sum. */
function withQuantity(item: CartItem, quantity: number): CartItem {
  const currencyCode = item.unitPrice.currencyCode;
  const extras = addMoney("0", ...(item.addons ?? []).map(addon => addon.price.amount));
  return {
    ...item,
    quantity,
    addonsTotal: item.addons?.length ? { amount: multiplyMoney(extras, quantity), currencyCode } : item.addonsTotal ?? null,
    lineTotal: { amount: multiplyMoney(addMoney(item.unitPrice.amount, extras), quantity), currencyCode },
  };
}

const counted = (items: CartItem[]) => items.reduce((count, item) => count + item.quantity, 0);

/**
 * The bag with new lines, its count and subtotal following. A count the lines
 * do not explain — an Add whose line cannot be drawn yet — is carried over,
 * so the header's number does not drop back while it waits.
 */
function withItems(cart: Cart, items: CartItem[]): Cart {
  const currencyCode = cart.subtotal.currencyCode;
  const unexplained = Math.max(0, cart.itemCount - counted(cart.items));
  const subtotal = addMoney("0", ...items.map(item => item.lineTotal.amount));
  return {
    ...cart,
    items,
    itemCount: counted(items) + unexplained,
    subtotal: { amount: subtotal, currencyCode },
    total: { amount: addMoney(subtotal, cart.delivery.total.amount), currencyCode },
  };
}

/** One press applied to the bag. The server keeps one line per variant, so an Add onto one adds to it. */
export function applyBagOp(cart: Cart | null, op: BagOp): Cart | null {
  if (op.kind === "add") {
    const bag = cart ?? NO_BAG;
    const existing = bag.items.find(item => item.variantId === op.variantId);
    if (existing) {
      const quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + op.quantity);
      return withItems(bag, bag.items.map(item => (item === existing ? withQuantity(item, quantity) : item)));
    }
    if (op.ghost) return withItems(bag, [...bag.items, op.ghost]);
    return { ...bag, itemCount: bag.itemCount + op.quantity };
  }
  if (!cart) return cart;
  /* A press on a drawn-ahead line follows it to the real one once that exists. */
  const target = realLineId(cart, op.lineId);
  if (op.kind === "set") {
    return withItems(cart, cart.items.map(item => (item.lineId === target ? withQuantity(item, op.quantity) : item)));
  }
  return withItems(cart, cart.items.filter(item => item.lineId !== target));
}

/** The line an op names, once the server has made it: a drawn-ahead line becomes the variant's real one. */
export function realLineId(cart: Cart | null, lineId: string): string | null {
  const variantId = ghostVariant(lineId);
  if (variantId === null) return lineId;
  return cart?.items.find(item => item.variantId === variantId)?.lineId ?? null;
}
