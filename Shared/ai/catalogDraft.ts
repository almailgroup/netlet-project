/**
 * What the catalogue assistant may hand a seller, and the shape it is asked
 * for.
 *
 * The model is asked for JSON against `CATALOG_RESPONSE_SCHEMA`, and Gemini
 * holds to a schema well — but "well" is not "always", and what comes back is
 * a third party's text going into a seller's form. `draftFromModel` is the
 * rule that decides what of it survives, pure so it can be tested on every
 * bad shape without a key: a department NetLet does not have is no
 * department, a specification row the department does not ask for is
 * dropped, a unit typed into a number is taken back out (the field carries
 * the unit, so "16 GB" and "16" cannot split a facet), and anything carrying
 * a phone number, an address or a link is removed — the listing rule the
 * review queue applies, so a draft never puts in front of a seller what the
 * queue would flag.
 */
import { DEPARTMENTS } from "../commerce/departments.js";
import { ATTRIBUTE_SCHEMA, fieldsFor } from "../commerce/attributeSchema.js";
import { contactFindings } from "../commerce/contactFilter.js";
import { SEARCH_SNIPPET_FITS, SEARCH_TITLE_FITS } from "../inventory/productDraft.js";
import type { CatalogAssistRequest, CatalogDraft } from "./gateway.js";

export const DEPARTMENT_SLUGS: readonly string[] = DEPARTMENTS.map(department => department.slug);

/** Long enough for a real name; shorter than the column, because a name is not a description. */
export const DRAFT_TITLE = 120;
/** A generated description is a starting point, not a brochure. */
export const DRAFT_DESCRIPTION = 3000;
export const DRAFT_TAGS = 10;
const TAG_LENGTH = 30;
const VALUE_LENGTH = 120;

const ALL_FIELD_KEYS = [...new Set(Object.values(ATTRIBUTE_SCHEMA).flatMap(fields => fields.map(field => field.key)))];

/**
 * The answer's shape, in the OpenAPI subset Gemini's `responseSchema` takes.
 * Flat names rather than nested pairs: a model fills `titleAr` more reliably
 * than `title.ar`, and the nesting is ours to add afterwards.
 */
export const CATALOG_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    titleEn: { type: "STRING" },
    titleAr: { type: "STRING" },
    descriptionEn: { type: "STRING" },
    descriptionAr: { type: "STRING" },
    department: { type: "STRING", enum: [...DEPARTMENT_SLUGS, "none"] },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    attributes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { key: { type: "STRING", enum: ALL_FIELD_KEYS }, value: { type: "STRING" } },
        required: ["key", "value"],
      },
    },
    seoTitle: { type: "STRING" },
    seoDescription: { type: "STRING" },
  },
  required: ["titleEn", "titleAr", "descriptionEn", "descriptionAr", "department", "tags", "attributes", "seoTitle", "seoDescription"],
  propertyOrdering: ["titleEn", "titleAr", "department", "attributes", "descriptionEn", "descriptionAr", "tags", "seoTitle", "seoDescription"],
} as const;

/**
 * The listing rule for contact details: the chat's filter, except that an
 * unbroken run of nine or more digits is a barcode or a model number in a
 * listing rather than a phone (`Shared/inventory/productReview.ts`).
 */
export function carriesContact(text: string): boolean {
  const productCode = /(?<!\d)\d{9,}(?!\d)/.test(text);
  return contactFindings(text).some(kind => !(kind === "phone" && productCode));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/** One line, no surrounding quotes, no contact details. */
function line(value: unknown, limit: number): string {
  const flat = text(value).replace(/\s+/g, " ").replace(/^["'«»“”]+|["'«»“”]+$/g, "").trim();
  return flat && !carriesContact(flat) ? clip(flat, limit) : "";
}

/**
 * Paragraphs and "- " lists, the subset the product page draws. Other bullet
 * marks become "- ", headings and emphasis lose their marks, and a line
 * carrying contact details goes — the rest of the description is still good.
 */
export function descriptionFromModel(value: unknown): string {
  const lines = text(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(raw => raw.trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[*•·–—]|\d{1,2}[.)])\s+/, "- ")
      .replace(/\*\*|__/g, "")
      .replace(/^-\s+/, "- "))
    .filter(entry => !carriesContact(entry));
  return clip(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), DRAFT_DESCRIPTION);
}

/** The draft the seller is shown, or null when nothing usable came back. */
export function draftFromModel(raw: unknown, request: Pick<CatalogAssistRequest, "department">): CatalogDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;

  /* The seller's own choice of department stands; the model only fills a blank. */
  const proposed = text(answer.department);
  const department = request.department ?? (DEPARTMENT_SLUGS.includes(proposed) ? proposed : null);

  const fields = fieldsFor(department);
  const attributes: CatalogDraft["attributes"] = [];
  for (const row of Array.isArray(answer.attributes) ? answer.attributes : []) {
    if (!row || typeof row !== "object") continue;
    const field = fields.find(entry => entry.key === text((row as Record<string, unknown>).key));
    if (!field || attributes.some(entry => entry.key === field.key)) continue;
    let value = line((row as Record<string, unknown>).value, VALUE_LENGTH);
    if (field.unit) value = value.replace(new RegExp(`\\s*${field.unit}$`, "i"), "").trim();
    if (field.options) value = field.options.find(option => option.toLowerCase() === value.toLowerCase()) ?? "";
    if (value) attributes.push({ key: field.key, value });
  }

  const tags: string[] = [];
  for (const tag of Array.isArray(answer.tags) ? answer.tags : []) {
    const clean = text(tag).replace(/^#/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (clean && clean.length <= TAG_LENGTH && !carriesContact(clean) && !tags.includes(clean)) tags.push(clean);
    if (tags.length === DRAFT_TAGS) break;
  }

  const titleAr = line(answer.titleAr, DRAFT_TITLE);
  const draft: CatalogDraft = {
    title: {
      en: line(answer.titleEn, DRAFT_TITLE),
      /* An Arabic name with no Arabic letter in it is not one — `arabicTitle.ts`'s rule. */
      ar: /[؀-ۿ]/.test(titleAr) ? titleAr : "",
    },
    description: { en: descriptionFromModel(answer.descriptionEn), ar: descriptionFromModel(answer.descriptionAr) },
    department,
    tags,
    attributes,
    missing: fields.map(field => field.key).filter(key => !attributes.some(entry => entry.key === key)),
    seo: { title: line(answer.seoTitle, SEARCH_TITLE_FITS), description: line(answer.seoDescription, SEARCH_SNIPPET_FITS) },
  };
  return draft.title.en || draft.title.ar || draft.description.en || draft.description.ar ? draft : null;
}
