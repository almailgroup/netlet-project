/**
 * The guided "Add a product" form's rules, pure and shared.
 *
 * The server holds the same lines with zod and the database, and this is what
 * lets the form say so *while somebody types* rather than after they press
 * Create — the password floor's arrangement: one rule, asked on both sides, so
 * the button is never one that produces an error.
 *
 * Every answer is a message key naming what to do, never "invalid": a seller
 * told "Enter a price like 12.500" can fix it, one told "Invalid input" goes
 * looking for which of nine boxes is wrong.
 */
import { acceptableImageUrl } from "../commerce/media.js";
import type { MessageKey } from "../i18n/dictionary.js";

/** Three decimal places, because the dinar has three. Matches the router. */
const MONEY = /^\d{1,9}(\.\d{1,3})?$/;

export const MAX_TITLE = 255;
export const MAX_SKU = 120;
export const MAX_STOCK = 1_000_000;
export const MAX_DESCRIPTION = 20_000;
export const MAX_PHOTOS = 12;

/** Where a search result cuts a title and a snippet, roughly. Advice, not a limit. */
export const SEARCH_TITLE_FITS = 60;
export const SEARCH_SNIPPET_FITS = 160;

export type ProductDraft = {
  title: string;
  titleAr: string;
  price: string;
  compareAtPrice: string;
  sku: string;
  stock: string;
  description: string;
  /** The seller's warranty, asked for where the department requires one. */
  warranty?: string;
};

export type DraftField = keyof ProductDraft;

/** Which fields are wrong, and what each needs. Absent means fine. */
export function draftProblems(draft: ProductDraft, options: { departmentSlug?: string | null } = {}): Partial<Record<DraftField, MessageKey>> {
  const problems: Partial<Record<DraftField, MessageKey>> = {};
  const title = draft.title.trim();
  if (!title) problems.title = "admin.newTitleRequired";
  else if (title.length > MAX_TITLE) problems.title = "admin.newTooLong";
  /* Required: the Arabic page showed the English name for every product whose
     seller skipped this box, which was every product. */
  if (!draft.titleAr.trim()) problems.titleAr = "admin.newTitleArRequired";
  else if (draft.titleAr.trim().length > MAX_TITLE) problems.titleAr = "admin.newTooLong";

  if (warrantyRequired(options.departmentSlug) && !(draft.warranty ?? "").trim()) problems.warranty = "admin.newWarrantyRequired";
  else if ((draft.warranty ?? "").trim().length > 200) problems.warranty = "admin.newTooLong";

  const price = draft.price.trim();
  if (!price) problems.price = "admin.newPriceRequired";
  else if (!MONEY.test(price)) problems.price = "admin.newPriceShape";
  /* A product at zero is buyable for nothing the moment it is live, which is
     why publishing refuses one (`assertPriced`). Asked here so the form never
     makes a product that cannot be published. */
  else if (Number(price) <= 0) problems.price = "admin.newPricePositive";

  const was = draft.compareAtPrice.trim();
  if (was) {
    if (!MONEY.test(was)) problems.compareAtPrice = "admin.newPriceShape";
    /* Equal or lower is not a saving, and the shop would draw a strikethrough
       over a price that is not higher. */
    else if (MONEY.test(price) && Number(was) <= Number(price)) problems.compareAtPrice = "admin.newWasHigher";
  }

  if (draft.sku.trim().length > MAX_SKU) problems.sku = "admin.newTooLong";

  const stock = draft.stock.trim();
  if (stock && (!/^\d+$/.test(stock) || Number(stock) > MAX_STOCK)) problems.stock = "admin.newStockShape";

  if (draft.description.length > MAX_DESCRIPTION) problems.description = "admin.newTooLong";
  return problems;
}

/** Whether a pasted address can be a product picture: the gallery's own rule. */
export function photoUrlProblem(url: string): MessageKey | null {
  const value = url.trim();
  if (!value) return null;
  return acceptableImageUrl(value) ? null : "admin.newPhotoUrl";
}

/**
 * The readable part of a product's address: the title, lower-cased,
 * hyphenated, ASCII. The server makes the real handle from this and adds a
 * number when it is taken, so the preview can be one digit short and never
 * otherwise wrong — which is why it lives here rather than in the server alone.
 */
export function handleBase(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150) || "product";
}

/**
 * Departments where a listing must say what warranty the seller gives.
 *
 * A KWD 320 phone read "This seller has not recorded a warranty", which is the
 * honest answer and the wrong state for an electronics listing to go live in:
 * it is the first thing somebody buying a phone asks. The seller's own words,
 * whatever they are — "12 months", "سنتان", "No warranty" — satisfy it; the
 * rule is that the question was answered, not what the answer is.
 */
export const WARRANTY_REQUIRED_DEPARTMENTS: readonly string[] = ["electronics"];

export function warrantyRequired(departmentSlug: string | null | undefined): boolean {
  return Boolean(departmentSlug && WARRANTY_REQUIRED_DEPARTMENTS.includes(departmentSlug));
}
