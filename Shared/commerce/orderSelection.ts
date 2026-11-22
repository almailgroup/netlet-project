/**
 * What the shopper can do with the items they chose on an opened order, on
 * the owner's word: "when you select a specific order, it should let you
 * choose the product, just like in the cart page, and it should give you all
 * the options". A circle beside each item and All, the cart's own, and a bar
 * with every act the chosen items allow — never one they do not.
 *
 * Pure, and the app's `OrderSelection` is the same rule on the same cases, so
 * a choice offers the same acts on both. **It decides nothing the server does
 * not decide again**: each fact it reads is the server's own answer about the
 * line on `orders.get` (its return window, its warranty and review
 * eligibility, whether it can still change before a driver has it), and every
 * act is asked again under a lock when it is pressed.
 */

/** One chosen item, as the page already knows it. */
export type ChosenLine = {
  id: number;
  fulfilment: string;
  quantity: number;
  /** A return may be asked on it now (`mayRequestReturn`). */
  returnable: boolean;
  /** Its warranty may be claimed (`warrantyEligibility.allowed`). */
  warranty: boolean;
  /** It may change before a driver has it — on an order that may (`change.changeable`). */
  changeable: boolean;
  /** It can be rated, or its review changed. */
  rateable: boolean;
  /** Still a product the shop knows (`variantId`), so it can go in the bag again. */
  rebuyable: boolean;
};

/**
 * The acts, in the order the bar draws them — the cancel last, apart, being
 * the one that takes something away.
 *
 * - `return`: one item, its return or exchange form.
 * - `refund`: several, one refund asked across the ones that can go back.
 */
export const SELECTION_ACTIONS = ["track", "return", "refund", "warranty", "quantity", "rate", "buyAgain", "help", "cancelItems"] as const;
export type SelectionAction = (typeof SELECTION_ACTIONS)[number];

/** An act and the chosen items it is about — some of them, or all. */
export type SelectionOffer = { action: SelectionAction; lineIds: number[] };

export function selectionOffers(chosen: readonly ChosenLine[], order: { cancelled: boolean }): SelectionOffer[] {
  if (chosen.length === 0) return [];
  const offers: SelectionOffer[] = [];
  const add = (action: SelectionAction, test: (line: ChosenLine) => boolean) => {
    const lineIds = chosen.filter(test).map(line => line.id);
    if (lineIds.length > 0) offers.push({ action, lineIds });
  };
  /* A parcel to follow: anything still part of an order that was not cancelled whole. */
  if (!order.cancelled) add("track", line => line.fulfilment !== "cancelled");
  /* One item is its own form, which asks refund or exchange; several, a refund across them. */
  add(chosen.length === 1 ? "return" : "refund", line => line.returnable);
  add("warranty", line => line.warranty);
  /* Lowering a quantity needs more than one of it. */
  add("quantity", line => line.changeable && line.quantity > 1);
  add("rate", line => line.rateable);
  add("buyAgain", line => line.rebuyable);
  /* Help is always there: about the one item, or about the order. */
  add("help", () => true);
  add("cancelItems", line => line.changeable);
  return offers;
}

/** All, some or none of the order's items chosen — the All circle beside "In this order". */
export function chosenState(all: readonly number[], chosen: readonly number[]): "all" | "none" | "some" {
  const picked = all.filter(id => chosen.includes(id)).length;
  return picked === 0 ? "none" : picked === all.length ? "all" : "some";
}

/**
 * Which item "Rate" opens among those it is about: the first not yet
 * reviewed, else the first — a review already written is changed there.
 */
export function firstToRate(lines: readonly { id: number; reviewed: boolean }[], lineIds: readonly number[]): number | null {
  const among = lines.filter(line => lineIds.includes(line.id));
  return (among.find(line => !line.reviewed) ?? among[0])?.id ?? null;
}
