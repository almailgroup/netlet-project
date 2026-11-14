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
import { translate, type LocaleCode } from "../i18n/dictionary.js";
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
  /** A warranty plan's length (`WARRANTY_MONTHS`); null for any other kind. */
  warrantyMonths?: number | null;
};

/** An add-on as the shopper chose it, frozen or live. */
export type ChosenAddon = { id: number; label: string; kind: AddonKind; price: string; warrantyMonths?: number | null };

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

/* ------------------------------------------- warranty and installation --- */

/**
 * The lengths an extended warranty plan is sold for, in months — on the
 * owner's word ("warranty plans, length such as 1 or 2 years, plus a price").
 * A closed list rather than a number box, so "2 years" is one plan whoever
 * typed it and a shopper compares like with like across stores.
 */
export const WARRANTY_MONTHS = [6, 12, 24, 36, 48, 60] as const;

/** At most this many extras on one product, the router's own ceiling. */
export const MAX_ADDONS = 10;

/** The longest name a seller may give an extra, in either language (the column's). */
export const ADDON_NAME_MAX = 160;

export function isWarrantyLength(months: unknown): months is number {
  return typeof months === "number" && (WARRANTY_MONTHS as readonly number[]).includes(months);
}

/** "2 years", "6 months" — a plan's length in words, counted in the page's language. */
export function warrantyLengthWords(months: number, locale: LocaleCode): string {
  return months % 12 === 0
    ? translate(locale, "addon.lengthYears", { count: months / 12 })
    : translate(locale, "addon.lengthMonths", { count: months });
}

/**
 * What an extra is called when its seller gave it no name of their own:
 * "Installation", or "2-year extended warranty". Null for an extra that needs
 * the seller's own words — an "other" one, or a warranty with no length.
 */
export function defaultAddonName(kind: string, warrantyMonths: number | null | undefined, locale: LocaleCode): string | null {
  if (kind === "installation") return translate(locale, "addon.installationName");
  if (kind === "warranty" && isWarrantyLength(warrantyMonths)) {
    return warrantyMonths % 12 === 0
      ? translate(locale, "addon.warrantyYearsName", { count: warrantyMonths / 12 })
      : translate(locale, "addon.warrantyMonthsName", { count: warrantyMonths });
  }
  return null;
}

type Named = { kind: string; label: string; labelAr?: string | null; warrantyMonths?: number | null };

/**
 * Whether the stored names are the ones `defaultAddonName` wrote — a seller
 * who left the name blank. **A blank name is stored as the default in both
 * languages** rather than as nothing, so every page that reads an extra's
 * name (the bag, the order desk, an order frozen last year, an app installed
 * before plans had lengths) reads a real one; the editor shows such a name as
 * blank again, so changing the length renames the plan with it.
 */
export function hasDefaultName(addon: Named): boolean {
  const en = defaultAddonName(addon.kind, addon.warrantyMonths, "en");
  if (en === null || addon.label.trim() !== en) return false;
  const ar = addon.labelAr?.trim() ?? "";
  return ar === "" || ar === defaultAddonName(addon.kind, addon.warrantyMonths, "ar");
}

/**
 * The name a shopper reads, in their language: the seller's own words, or
 * the default. **A warranty plan always says how long it runs** — a plan the
 * seller named "Gold care" reads "Gold care, 2 years", because a price with
 * no length is not a plan anybody can compare.
 */
export function addonTitle(addon: Named, locale: LocaleCode): string {
  const own = locale === "ar" ? addon.labelAr?.trim() || addon.label.trim() : addon.label.trim() || addon.labelAr?.trim() || "";
  if (hasDefaultName(addon)) return defaultAddonName(addon.kind, addon.warrantyMonths, locale) ?? own;
  if (addon.kind === "warranty" && isWarrantyLength(addon.warrantyMonths)) {
    return translate(locale, "addon.namedWithLength", { name: own, length: warrantyLengthWords(addon.warrantyMonths, locale) });
  }
  return own;
}

/** One extra as a seller fills it in: the names may be blank, the length is a warranty's alone. */
export type AddonDraft = {
  kind: AddonKind;
  label: string;
  labelAr: string;
  price: string;
  warrantyMonths: number | null;
};

export type AddonProblem = "price" | "name" | "warrantyLength" | "warrantyTwice" | "nameLong";

/**
 * What is wrong with each extra, row by row — the same answer on the form,
 * under the row, and on the server, which refuses what this refuses.
 *
 * - **A price above nothing**: a free extra is a feature of the product, and a
 *   check box that changes no figure is the dead-control rule.
 * - **An "other" extra needs a name**; installation and a warranty plan are
 *   named for the seller when left blank.
 * - **A warranty plan needs its length**, unless it carries a name of its
 *   own — a plan written before plans had lengths, whose name says it.
 * - **One plan per length**: two "2 years" at two prices is a choice nobody
 *   can make.
 */
export function addonProblems(drafts: AddonDraft[]): AddonProblem[][] {
  const lengths = new Set<number>();
  return drafts.map(draft => {
    const problems: AddonProblem[] = [];
    const price = draft.price.trim();
    if (!/^\d{1,9}(\.\d{1,3})?$/.test(price) || toFils(price) <= 0n) problems.push("price");
    const named = draft.label.trim().length > 0 || draft.labelAr.trim().length > 0;
    if (draft.label.trim().length > ADDON_NAME_MAX || draft.labelAr.trim().length > ADDON_NAME_MAX) problems.push("nameLong");
    if (draft.kind === "other" && !named) problems.push("name");
    if (draft.kind === "warranty") {
      if (isWarrantyLength(draft.warrantyMonths)) {
        if (lengths.has(draft.warrantyMonths)) problems.push("warrantyTwice");
        lengths.add(draft.warrantyMonths);
      } else if (!named) {
        problems.push("warrantyLength");
      }
    }
    return problems;
  });
}

/**
 * The row to store for a draft that passed: names the seller left blank are
 * the defaults in both languages (see `hasDefaultName`), a name given in one
 * language only stands for both, and a length belongs to a warranty alone.
 */
export function storedAddon(draft: AddonDraft): { kind: AddonKind; label: string; labelAr: string | null; price: string; warrantyMonths: number | null } {
  const months = draft.kind === "warranty" && isWarrantyLength(draft.warrantyMonths) ? draft.warrantyMonths : null;
  const en = draft.label.trim();
  const ar = draft.labelAr.trim();
  const fallbackEn = defaultAddonName(draft.kind, months, "en");
  const fallbackAr = defaultAddonName(draft.kind, months, "ar");
  if (!en && !ar && fallbackEn) return { kind: draft.kind, label: fallbackEn, labelAr: fallbackAr, price: draft.price.trim(), warrantyMonths: months };
  return { kind: draft.kind, label: en || ar, labelAr: ar || null, price: draft.price.trim(), warrantyMonths: months };
}

/**
 * A stored extra as the editor shows it: a default name is blank again, so
 * the box says "named for you" and a new length renames the plan.
 */
export function draftOf(addon: { kind: string; label: string; labelAr?: string | null; price: string; warrantyMonths?: number | null }): AddonDraft {
  const kind = (ADDON_KINDS as readonly string[]).includes(addon.kind) ? (addon.kind as AddonKind) : "other";
  const months = kind === "warranty" && isWarrantyLength(addon.warrantyMonths) ? addon.warrantyMonths : null;
  if (hasDefaultName({ ...addon, kind, warrantyMonths: months })) return { kind, label: "", labelAr: "", price: addon.price, warrantyMonths: months };
  return { kind, label: addon.label, labelAr: addon.labelAr ?? "", price: addon.price, warrantyMonths: months };
}

/**
 * At most one warranty plan on a line: two lengths of one warranty are one
 * choice somebody made twice, and charging both would be charging for a
 * promise that is already made. The first the shopper sent stands, the
 * picker's own rule (choosing a plan unchooses the others).
 */
export function withOneWarranty<T extends { id: number; kind: string }>(chosen: T[], sent: readonly number[]): T[] {
  const warranties = chosen.filter(addon => addon.kind === "warranty");
  if (warranties.length < 2) return chosen;
  const rank = (id: number) => { const at = sent.indexOf(id); return at === -1 ? Number.MAX_SAFE_INTEGER : at; };
  const keep = warranties.reduce((best, addon) => (rank(addon.id) < rank(best.id) ? addon : best));
  return chosen.filter(addon => addon.kind !== "warranty" || addon.id === keep.id);
}
