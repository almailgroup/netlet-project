/**
 * Reading a product before a human does, and saying what is wrong with it.
 *
 * Requirement 3.6.2: the review queue was entirely human, so every listing got
 * the same amount of attention whether it was a well-made page or a blank one
 * with a phone number in the title. Pure, because what this decides is which
 * listings an administrator looks at hardest, and a triage you can only
 * exercise by submitting a real product is one nobody checks.
 *
 * ## It flags and never refuses
 *
 * Nothing here blocks a publish. `assertPriced` and the discount permit are
 * the two doors onto the shelf and they refuse on their own; adding a third
 * gate whose rules are heuristics would mean a seller's listing rejected by a
 * word list. Every finding is a **reason to look**, carried with the evidence
 * that produced it, and a human decides — the same argument `vendorHealth`
 * makes for carrying its raw counts rather than only a score.
 *
 * ## Every finding says what and why, as keys
 *
 * A message key, never a sentence: this is read on an Arabic page too. And the
 * thing the finding is about travels with it, so "there is a phone number in
 * the title" can show *which* number rather than asking somebody to hunt.
 *
 * ## The seller's own words are data
 *
 * A description is typed by a merchant, so it is the one input an attacker
 * controls. Nothing here interprets it as an instruction: the checks are
 * regular expressions and counts. The optional model pass that reads it is in
 * `Backend/src/services/productReview.ts`, fenced the way the assistant's brief is, and it
 * can only *add* a finding — it cannot clear one, and with no key it is simply
 * absent rather than a panel saying "not configured".
 */

import { contactFindings } from "../commerce/contactFilter.js";

/** What is wrong, as a key the client translates. */
export const REVIEW_FINDINGS = [
  "noImages",
  "zeroPrice",
  "noCategory",
  "thinDescription",
  "contactInText",
  "shoutingTitle",
  "bannedClaim",
  "modelConcern",
] as const;
export type ReviewFinding = (typeof REVIEW_FINDINGS)[number];

/**
 * How hard to look.
 *
 * `serious` is something that would be wrong on the shelf — a claim NetLet
 * cannot stand behind, a way around the platform. `minor` is untidy: a thin
 * description sells badly and breaks nothing.
 */
export type Severity = "serious" | "minor";

export type Flag = {
  finding: ReviewFinding;
  severity: Severity;
  /** The evidence, when there is a specific thing to point at. */
  detail?: string;
};

export type ReviewableProduct = {
  title: string;
  description: string | null;
  categoryId: number | null;
  imageCount: number;
  /** Every variant's price, so "any at zero" is answerable here. */
  prices: string[];
};

/**
 * Claims a marketplace cannot let a seller make about goods.
 *
 * Deliberately short and about *medicine and money*, which is where a false
 * claim does real harm — not a profanity list, which would flag a seller for
 * writing plainly. Matched on a word boundary so "cures" in "manicures" is not
 * a finding.
 */
const BANNED_CLAIMS = [
  "cure", "cures", "treats cancer", "miracle", "fda approved", "medically approved",
  "guaranteed profit", "risk free", "100% safe",
  "يعالج", "يشفي", "معجزة", "مضمون الربح",
];

/** A phone number, an email or a link — the three ways off the platform. */
const CONTACT_SHAPES: { shape: RegExp; name: string }[] = [
  { shape: /\b(?:\+?965[\s-]?)?[569]\d{3}[\s-]?\d{4}\b/, name: "phone" },
  { shape: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, name: "email" },
  { shape: /\b(?:https?:\/\/|www\.)\S+/i, name: "link" },
  { shape: /\b(?:whatsapp|واتساب|انستقرام|instagram)\b/i, name: "channel" },
];

/** Under this, a description is not a description. */
export const THIN_DESCRIPTION = 40;

/**
 * How many submissions one account's listings are read by the model in an
 * hour before the rest simply wait for a person (3.3.6). Each reading is a
 * call NetLet pays for, and a seller pressing Publish and Draft in a loop
 * should cost a queue entry rather than a bill.
 */
export const MAX_LISTING_SCREENS_PER_HOUR = 30;

/**
 * Everything wrong with one listing.
 *
 * Ordered serious first, because an administrator reads the top of a list and
 * the ordering is the only prioritising this does.
 */
export function reviewProduct(product: ReviewableProduct): Flag[] {
  const flags: Flag[] = [];
  const text = `${product.title} ${product.description ?? ""}`;

  /*
   * A seller putting their own number in a listing is asking the shopper to
   * buy off the platform, which takes the order out of NetLet's protection as
   * well as out of its books. Serious, and pointed at the match so nobody has
   * to hunt for it.
   */
  const shown = CONTACT_SHAPES.map(({ shape, name }) => ({ name, found: shape.exec(text) })).find(hit => hit.found);
  if (shown?.found) {
    flags.push({ finding: "contactInText", severity: "serious", detail: `${shown.name}: ${shown.found[0]}` });
  } else {
    /* The contact filter, for everything the plain shapes above cannot see:
       Arabic-Indic digits, a number spelled out or broken up with invisible
       characters, "noura at gmail dot com". A listing is the same way off the
       platform as a message, and the seller typing one knows the tricks just
       as well. Named by kind, because there is no single match to quote. */
    /* Except a barcode or a model number: an unbroken run of nine or more
       plain digits is a product code in a listing, where the chat would rightly
       call it a number — a review queue that flags every EAN is one reviewers
       learn to skip. A Kuwaiti number is eight digits, and the plain shapes
       above already catch it with or without the 965. */
    const productCode = /(?<!\d)\d{9,}(?!\d)/.test(text);
    const kinds = contactFindings(text).filter(kind => !(kind === "phone" && productCode));
    if (kinds.length) flags.push({ finding: "contactInText", severity: "serious", detail: kinds.join(", ") });
  }

  const lower = text.toLowerCase();
  const claim = BANNED_CLAIMS.find(word =>
    new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}([^\\p{L}]|$)`, "iu").test(lower),
  );
  if (claim) flags.push({ finding: "bannedClaim", severity: "serious", detail: claim });

  /* The same money rule the two doors onto the shelf already enforce, surfaced
     here so the queue says *why* a publish will be refused rather than letting
     somebody press approve and read an error. */
  if (product.prices.some(price => Number.parseFloat(price) <= 0)) {
    flags.push({ finding: "zeroPrice", severity: "serious" });
  }

  if (product.imageCount === 0) flags.push({ finding: "noImages", severity: "minor" });
  if (product.categoryId === null) flags.push({ finding: "noCategory", severity: "minor" });
  if ((product.description ?? "").trim().length < THIN_DESCRIPTION) {
    flags.push({ finding: "thinDescription", severity: "minor" });
  }

  /*
   * A title in capitals is a seller shouting over the others on the page, and
   * it is checked on the *letters* rather than the string: "SONY 4K" is a
   * brand and a spec, while "BEST DEAL EVER BUY NOW" is not. Short titles are
   * exempt, because "TV" and "USB" are simply how those are written.
   */
  const letters = product.title.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) {
    flags.push({ finding: "shoutingTitle", severity: "minor" });
  }

  return [...flags].sort((a, b) => Number(b.severity === "serious") - Number(a.severity === "serious"));
}

/** Whether this listing is worth an administrator's attention before the rest. */
export function needsAttention(flags: Flag[]): boolean {
  return flags.some(flag => flag.severity === "serious");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
