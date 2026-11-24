/**
 * What the shopper can do with the items they chose on an opened order, on
 * the owner's word: "when you select a specific order, it should let you
 * choose the product, just like in the cart page, and it should give you all
 * the options". A circle beside each item and All, the cart's own, and a bar
 * with every act the chosen items allow — never one they do not.
 *
 * **The bar is the one way in, on the owner's word** ("remove all these 3
 * dot buttons; instead put their options here — when you select all, it
 * should show you all the options, and when you select individually, it
 * should show you the options as well"). Each item had a ⋯, and so did the
 * order. The bar also offers what only the whole order can have done
 * (`WholeOrder`): change the order, its address or its way to pay, its
 * receipt, and cancelling the order itself.
 *
 * **Those are offered whatever is chosen, one item included, on the owner's
 * word** ("these options should show even if one is selected; keep as many
 * options as there is for the user"). They waited for every item to be
 * chosen, so choosing one item of two offered Track, Buy again, Help and
 * Cancel, and choosing both offered eight. With one item chosen of several,
 * the bar offers both that item's acts and the order's: its quantity and the
 * order's change form, cancelling the item and cancelling the order. Only
 * with every item chosen do the order's stand in for the items' — the order's
 * change form for the quantity, cancelling the order for cancelling them all —
 * since there they would do the same.
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
 * - `modify`, `address`, `payment`, `receipt`, `cancelOrder`: the whole
 *   order's (`WholeOrder`), offered whatever is chosen. `modify` is the
 *   order's change form and `cancelOrder` cancels the order itself; with
 *   every item chosen they stand in for `quantity` and `cancelItems`.
 */
export const SELECTION_ACTIONS = [
  "track", "return", "refund", "warranty", "quantity", "modify", "rate", "buyAgain",
  "address", "payment", "receipt", "help", "cancelItems", "cancelOrder",
] as const;
export type SelectionAction = (typeof SELECTION_ACTIONS)[number];

/** An act and the chosen items it is about — some of them, or all. */
export type SelectionOffer = { action: SelectionAction; lineIds: number[] };

/** What the whole order allows now, from the server's own answer on `orders.get`. */
export type WholeOrder = {
  /** The order's change form has something it may still change (`change.changeable` and a line that may). */
  modifiable: boolean;
  /** The delivery address can still move (`changeAddress.changeable`). */
  address: boolean;
  /** The way to pay can still change (`paymentChange.open`). */
  payment: boolean;
  /** The order itself may be cancelled now (`cancel.cancellable`). */
  cancellable: boolean;
};

export function selectionOffers(
  chosen: readonly ChosenLine[],
  order: {
    cancelled: boolean;
    /** The order's own facts; without them only the items' acts are offered. */
    whole?: WholeOrder | null;
    /** Every item of the order is chosen, so the order's acts stand in for the items'. */
    everyChosen?: boolean;
  },
): SelectionOffer[] {
  if (chosen.length === 0) return [];
  const whole = order.whole ?? null;
  const all = Boolean(whole && order.everyChosen);
  const every = chosen.map(line => line.id);
  const offers: SelectionOffer[] = [];
  const add = (action: SelectionAction, test: (line: ChosenLine) => boolean) => {
    const lineIds = chosen.filter(test).map(line => line.id);
    if (lineIds.length > 0) offers.push({ action, lineIds });
  };
  const addWhole = (action: SelectionAction, allowed: boolean) => {
    if (allowed) offers.push({ action, lineIds: every });
  };
  /* A parcel to follow: anything still part of an order that was not cancelled whole. */
  if (!order.cancelled) add("track", line => line.fulfilment !== "cancelled");
  /* One item is its own form, which asks refund or exchange; several, a refund across them. */
  add(chosen.length === 1 ? "return" : "refund", line => line.returnable);
  add("warranty", line => line.warranty);
  /* Lowering a quantity needs more than one of it; the whole order's change
     form lowers or takes out any item that may still change, and stands in
     for it once every item is chosen. */
  if (!all) add("quantity", line => line.changeable && line.quantity > 1);
  if (whole) addWhole("modify", whole.modifiable);
  add("rate", line => line.rateable);
  add("buyAgain", line => line.rebuyable);
  if (whole) {
    addWhole("address", whole.address);
    addWhole("payment", whole.payment);
    /* Every order has its receipt. */
    addWhole("receipt", true);
  }
  /* Help is always there: about the one item, or about the order. */
  add("help", () => true);
  /* Cancelling the order is offered only with every item chosen — the All
     circle — and then stands in for cancelling them all; with some chosen,
     only those items are cancelled (the owner's "once I choose specific
     items, only give the option to cancel items, not the whole order"). */
  if (!(all && whole?.cancellable)) add("cancelItems", line => line.changeable);
  if (all && whole?.cancellable) addWhole("cancelOrder", true);
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
