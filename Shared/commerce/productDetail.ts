/**
 * Derived product-detail values.
 *
 * The product page shows a few things the normalized `Product` shape does not
 * carry as fields — a saving percentage, a star rating, express eligibility,
 * a specification list. Each is derived here from data the catalog genuinely
 * supplies, rather than added to the type as something no backend populates.
 * Every helper degrades to "absent" so a sparsely configured product renders
 * without holes.
 */
import { DEPARTMENTS } from "./departments.js";
import { fieldFor, shownOption } from "./attributeSchema.js";
import type { Money, Product, ProductAttribute } from "./types.js";

/** Attributes that describe the product rather than the review score. */
const REVIEW_NAMESPACE = "reviews";

export type ProductRating = {
  value: number;
  scaleMax: number;
  /** Null when the store publishes a score but no count. */
  count: number | null;
};

export type SpecificationRow = { label: string; value: string };

/**
 * What to render under the Specifications tab.
 *
 * Both halves, not one or the other. A store can have a couple of structured
 * metafields AND a spec block written into the description; showing only the
 * metafields would silently drop the longer list, which is the half a shopper
 * actually came to read. `rows` is empty when no metafields are configured and
 * `text` is empty when the description is blank — both empty means nothing to
 * show.
 */
export type Specifications = { rows: SpecificationRow[]; text: string };

function toAmount(money: Money | null | undefined): number | null {
  if (!money) return null;
  const amount = Number.parseFloat(money.amount);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Whole-percent saving against the compare-at price, or 0 when there is none.
 *
 * Rounded rather than floored so 399.90 against 444.90 reads as the 10% the
 * merchant advertises instead of 9%.
 */
export function savingsPercent(price: Money, compareAtPrice: Money | null | undefined): number {
  const now = toAmount(price);
  const was = toAmount(compareAtPrice);
  if (now === null || was === null || now <= 0 || was <= now) return 0;
  return Math.round((1 - now / was) * 100);
}

function findAttribute(attributes: ProductAttribute[], key: string): ProductAttribute | undefined {
  return attributes.find(
    (attribute) => attribute.namespace === REVIEW_NAMESPACE && attribute.key === key,
  );
}

/**
 * The store's review score, from the `reviews` attribute namespace.
 *
 * `reviews.rating` is a rating-type metafield, so its value is JSON carrying
 * the score and the scale it was recorded on — a store on a 1–10 scale would
 * otherwise render five stars for a 5. A plain numeric string is accepted too,
 * since an app writing a single-line-text metafield is just as common.
 */
export function productRating(attributes: ProductAttribute[]): ProductRating | null {
  const rating = findAttribute(attributes, "rating");
  if (!rating) return null;

  let value: number | null = null;
  let scaleMax = 5;

  try {
    const parsed: unknown = JSON.parse(rating.value);
    if (parsed && typeof parsed === "object") {
      const shape = parsed as { value?: unknown; scale_max?: unknown };
      const parsedValue = Number.parseFloat(String(shape.value));
      const parsedScale = Number.parseFloat(String(shape.scale_max));
      if (Number.isFinite(parsedValue)) value = parsedValue;
      if (Number.isFinite(parsedScale) && parsedScale > 0) scaleMax = parsedScale;
    }
  } catch {
    // Not JSON — fall through to the plain-number reading below.
  }

  if (value === null) {
    const parsedValue = Number.parseFloat(rating.value);
    if (Number.isFinite(parsedValue)) value = parsedValue;
  }
  if (value === null || value < 0) return null;

  const countAttribute = findAttribute(attributes, "rating_count");
  const parsedCount = countAttribute ? Number.parseInt(countAttribute.value, 10) : Number.NaN;

  return {
    value,
    scaleMax,
    count: Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null,
  };
}

/**
 * The score a product's stars draw, wherever they are drawn — the card, the
 * preview, the product page, the rating filter and the search preview's
 * structured data — so no two of them can disagree.
 *
 * **The shop's own reviews first**: the visible reviews of this product,
 * measured on the read (`reviewSummary`), out of five with their count. Only
 * a product nobody has reviewed falls back to a score its listing carries
 * (`productRating`), which is what every card showed before reviews were
 * counted for it.
 */
export function productStars(product: Pick<Product, "attributes" | "reviewSummary">): ProductRating | null {
  const measured = product.reviewSummary;
  if (measured && measured.count > 0 && Number.isFinite(measured.average)) {
    return { value: measured.average, scaleMax: 5, count: measured.count };
  }
  return productRating(product.attributes);
}

export type StarFill = "full" | "half" | "empty";

/** How many stars a row draws. */
export const STAR_COUNT = 5;

/**
 * Five stars for a score, each full, half or empty: the score put out of five
 * and rounded to the nearest half, the way a row of stars is read. 4.3 draws
 * four and a half, 4.2 four. The app's `StarFill.row` is the same rule.
 */
export function starFills(value: number, scaleMax = 5): StarFill[] {
  const outOfFive = scaleMax > 0 ? (value / scaleMax) * STAR_COUNT : 0;
  const halves = Math.round(Math.min(Math.max(outOfFive, 0), STAR_COUNT) * 2);
  return Array.from({ length: STAR_COUNT }, (_, index) => {
    const left = halves - index * 2;
    return left >= 2 ? "full" : left === 1 ? "half" : "empty";
  });
}

/**
 * Whether the product is flagged for NetLet Express.
 *
 * Keyed off a tag because tags are free-form: a vendor flags a product for
 * Express by typing one, with no schema change and no admin involvement.
 */
export function isExpressEligible(product: Pick<Product, "tags">): boolean {
  return product.tags.some((tag) => tag.trim().toLowerCase().replace(/^netlet\s+/, "") === "express");
}

/** Specification content: structured metafields first, then the description. */
export function specifications(
  product: Pick<Product, "attributes" | "description"> & { productType?: string | null },
  options: { arabic?: boolean } = {},
): Specifications {
  const department = DEPARTMENTS.find(entry => entry.name === product.productType)?.slug ?? null;
  return {
    rows: product.attributes
      .filter((attribute) => attribute.namespace !== REVIEW_NAMESPACE)
      .map((attribute) => {
        /* A row the department's schema knows takes the schema's label in the
           page's language and the field's own unit: "Memory: 12" was the
           seller typing the number into a field whose unit is GB. */
        const field = fieldFor(department, attribute.key);
        const label = field ? (options.arabic ? field.labelAr : field.label) : attribute.label;
        /* A chosen answer in the page's language: "Type: الهواتف". */
        return { label, value: withUnit(shownOption(field, attribute.value, Boolean(options.arabic)), field?.unit ?? null) };
      }),
    text: product.description.trim(),
  };
}

/**
 * A value with its field's unit after it, unless the seller already wrote one
 * — "12" becomes "12 GB", and "12 GB", "12GB" and "1 TB" stay as they are.
 */
export function withUnit(value: string, unit: string | null): string {
  const trimmed = value.trim();
  if (!unit || !trimmed) return trimmed;
  /* Only a bare number takes the unit; anything with a letter in it already says what it is. */
  return /^[\d٠-٩.,\s]+$/.test(trimmed) ? `${trimmed} ${unit}` : trimmed;
}

export type DescriptionBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: { label: string | null; text: string }[] };

const BULLET = /^\s*(?:--+|[-–—•*·▪])\s+/;

/**
 * A seller's description as paragraphs and lists.
 *
 * Sellers write bullets the way a keyboard allows — "-- Display: 6.8 inch",
 * "• 120 Hz", "- Two-year warranty" — and the page printed the dashes. A run of
 * such lines is a list; a "Label: value" line in one is drawn with its label
 * bold, the way a specification sheet reads; everything else is a paragraph,
 * one per blank-line-separated block, as typed.
 */
export function descriptionBlocks(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  let list: { label: string | null; text: string }[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (BULLET.test(raw)) {
      flushParagraph();
      const body = raw.replace(BULLET, "").trim();
      const labelled = /^([^:：]{1,40})[:：]\s+(.+)$/.exec(body);
      list.push(labelled ? { label: labelled[1].trim(), text: labelled[2].trim() } : { label: null, text: body });
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/**
 * The warranty the merchant recorded, if they recorded one.
 *
 * Returned as the merchant typed it rather than parsed into months: "12
 * months", "سنتان", "2 years (parts only)" are all things a seller writes, and
 * a parser that understands the first and drops the third would quietly lose a
 * term the shopper is entitled to. The page shows the text and says who said
 * it; NetLet's own cover is stated separately and never merged with it.
 *
 * Any namespace, because this is a merchant fact rather than one NetLet writes
 * — unlike the review attributes, which the platform owns and which therefore
 * get a namespace of their own.
 */
export function merchantWarranty(attributes: ProductAttribute[]): string | null {
  const found = attributes.find(
    attribute =>
      attribute.namespace !== REVIEW_NAMESPACE &&
      attribute.key.trim().toLowerCase().replace(/[\s_-]+/g, "") === "warranty",
  );
  const value = found?.value.trim();
  return value ? value : null;
}
