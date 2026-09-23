/**
 * The extras a seller offers with a product, and what they cost.
 *
 * Requirement 3.1.2: optional installation fees and extended warranty. Pure,
 * for the reason the order arithmetic is — what this decides is money somebody
 * pays, and a rule you can only exercise by buying a washing machine is one
 * nobody checks.
 *
 * ## An add-on is charged per unit
 *
 * Two fridges need two installations, and two washing machines carry two
 * warranties. Charging per *line* would make a shopper buying three pay for
 * one fitting and then argue about it on the doorstep. It is the same reason
 * the line total is `unitPrice × quantity` rather than a figure typed once.
 *
 * ## It is the seller's service, on the seller's line
 *
 * An add-on's money goes into the line it belongs to, so `lineTotal` still
 * covers everything that line is worth and the commission split still holds
 * `commission + vendorNet === lineTotal` exactly. A separate pot for services
 * would need its own rate, its own report and its own refund rule, to describe
 * the same transaction — the fitter and the fridge come from one shop.
 *
 * ## Nothing is chosen by default
 *
 * Every add-on is opt-in, always. A pre-ticked warranty is how a shopper ends
 * up paying for something they did not ask for and did not notice, which is
 * the one thing this feature could do that would be worse than not having it.
 */
import { addMoney, multiplyMoney, toFils } from "../money.js";

/**
 * What kind of extra this is.
 *
 * A closed list rather than free text, because the two the requirement names
 * carry real meaning a shopper reads differently — an installation is a
 * visit, a warranty is a promise — and `other` exists so a seller with a third
 * thing is not forced to mislabel it as one of the two.
 */
export const ADDON_KINDS = ["installation", "warranty", "other"] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

export type Addon = {
  id: number;
  kind: AddonKind;
  /** The seller's own words, shown as typed. */
  label: string;
  labelAr: string | null;
  price: string;
  position: number;
};

/** An add-on as the shopper chose it, frozen or live. */
export type ChosenAddon = { id: number; label: string; kind: AddonKind; price: string };

/**
 * What the extras add to one line.
 *
 * Per unit, so a shopper buying three fridges pays for three fittings. The
 * arithmetic is in fils through `multiplyMoney` and `addMoney` for the reason
 * every price here is: the dinar has three decimal places and a binary
 * fraction cannot hold 24.375.
 */
export function addonsTotal(chosen: ChosenAddon[], quantity: number): string {
  if (chosen.length === 0) return "0.000";
  const perUnit = addMoney(...chosen.map(addon => addon.price));
  return multiplyMoney(perUnit, Math.max(0, Math.trunc(quantity)));
}

/**
 * The add-ons a shopper picked, from the ids they sent and what the seller
 * actually offers.
 *
 * **The price comes from the catalog, never from the caller**, which is the
 * whole point of resolving rather than trusting: an id is all the client may
 * send, and anything it says about money is discarded. Unknown ids are dropped
 * rather than refused — a seller may have withdrawn an extra between the page
 * rendering and the button, and refusing the order over it would lose a sale
 * to fix nothing the shopper did.
 */
export function resolveAddons(offered: Addon[], chosenIds: number[]): ChosenAddon[] {
  const wanted = new Set(chosenIds);
  return offered
    .filter(addon => wanted.has(addon.id))
    .map(addon => ({ id: addon.id, label: addon.label, kind: addon.kind, price: addon.price }));
}

/**
 * Whether an add-on is worth offering at all.
 *
 * A free extra is not an add-on, it is a feature of the product, and a
 * check box that adds nothing to the total is the dead-control rule again —
 * the seller should write it in the description instead.
 */
export function isSellableAddon(addon: { label: string; price: string }): boolean {
  return addon.label.trim().length > 0 && toFils(addon.price) > 0n;
}
