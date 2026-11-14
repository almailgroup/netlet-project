/**
 * A product's catalogue — on the owner's word ("add Product catalogue for
 * products. That shows below the product … the admin and the vendor can add
 * product catalogues"): a PDF the maker or the store put out about the
 * product, a brochure, a spec sheet or a manual, listed under the product on
 * its page with its name and size, to view or keep.
 *
 * Pure and shared, for the password floor's reason: the editor refuses what
 * the upload route would refuse before a byte is sent, and both apps say the
 * same limits.
 *
 * ## A PDF, by its own bytes, of at most 5 MB
 *
 * The owner's choice of size. A Vercel function refuses a request body much
 * over 4.5 MB, so a file is sent in parts of `CATALOGUE_PART_BYTES` and the
 * server joins them (`bytes || part`, in order, under the uploader's own
 * row). A file over the limit is made smaller on the device first — its
 * pictures shrunk and re-encoded, the text left as it is — and refused only
 * if that is not enough. A PDF is one by its first bytes (`%PDF-`) and whole
 * when its last kilobyte holds `%%EOF`.
 *
 * ## Shown when the store's own products would be
 *
 * The owner's choice: a catalogue follows the store's publish rule. An
 * administrator's goes on the page at once, and so does a store's that
 * publishes without review (`vendors.auto_publish`); any other waits for
 * NetLet to look at it — a PDF can carry a phone number or another shop's
 * address, and nobody reads one but a person. Declining says why.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { contactFindings } from "../commerce/contactFilter.js";

/** The owner's 5 MB, as the phone and the computer count it (5 × 1024 × 1024), so a file a picker calls "5 MB" is never refused. */
export const MAX_CATALOGUE_BYTES = 5 * 1024 * 1024;
/** One request's share of a file — well under the 4.5 MB Vercel takes in a body. */
export const CATALOGUE_PART_BYTES = 3_000_000;
/**
 * The largest file its own address hands over whole. A Vercel function's
 * answer, like its request, stops at about 4.5 MB unless it streams, so a
 * larger catalogue is read in parts (`?part=`) and put together on the
 * device — the website and the app both — before it is opened.
 */
export const CATALOGUE_DIRECT_BYTES = 4_000_000;
/** How many catalogues one product may carry. */
export const MAX_CATALOGUES_PER_PRODUCT = 5;
/** How many one account may start in an hour, counted in Postgres. */
export const MAX_CATALOGUE_UPLOADS_PER_HOUR = 30;
/** The title columns' width. */
export const CATALOGUE_TITLE_MAX = 120;
/** How long NetLet's reason for turning one down may be. */
export const CATALOGUE_NOTE_MAX = 500;
/** A file whose parts stopped coming this long ago is thrown away. */
export const CATALOGUE_UPLOAD_STALE_MS = 60 * 60 * 1000;

/**
 * Where a catalogue stands. `uploading` while its parts are coming (never
 * listed); `pending` while NetLet has not looked at it; `live` on the product
 * page; `declined`, with NetLet's reason, for the store to read.
 */
export const CATALOGUE_STATUSES = ["uploading", "pending", "live", "declined"] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

export function isCatalogueStatus(value: unknown): value is CatalogueStatus {
  return typeof value === "string" && (CATALOGUE_STATUSES as readonly string[]).includes(value);
}

/** What the store's publish rule makes a finished upload: shown at once, or waiting for NetLet. */
export function statusOnUpload(who: { admin: boolean; autoPublish: boolean }): "live" | "pending" {
  return who.admin || who.autoPublish ? "live" : "pending";
}

const PDF_START = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_END = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF

/** Whether these are a PDF's first bytes. */
export function startsLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_START.length && PDF_START.every((byte, index) => bytes[index] === byte);
}

/** Whether a PDF's last kilobyte holds its end marker — a file cut short does not. */
export function endsLikePdf(tail: Uint8Array): boolean {
  const from = Math.max(0, tail.length - 1024);
  outer: for (let index = tail.length - PDF_END.length; index >= from; index -= 1) {
    for (let at = 0; at < PDF_END.length; at += 1) if (tail[index + at] !== PDF_END[at]) continue outer;
    return true;
  }
  return false;
}

export type CatalogueSizeProblem = "catalogue.empty" | "catalogue.tooLarge";

/** What is wrong with a file's size, or null. */
export function catalogueSizeProblem(size: number): CatalogueSizeProblem | null {
  if (!Number.isInteger(size) || size <= 0) return "catalogue.empty";
  if (size > MAX_CATALOGUE_BYTES) return "catalogue.tooLarge";
  return null;
}

/** How many parts a file of this size is sent in. */
export function partCount(size: number): number {
  return Math.max(1, Math.ceil(size / CATALOGUE_PART_BYTES));
}

/**
 * A title as it is stored: nothing invisible, runs of space as one, at most
 * the column's width; nothing left is no title, and the file's name stands
 * in for it.
 */
export function cleanCatalogueTitle(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CATALOGUE_TITLE_MAX)
    .trim();
  return cleaned || null;
}

/**
 * What is wrong with a title a shopper will read, or null: a phone number,
 * an email, a link or a handle is the contact filter's refusal, as on a
 * review's reply and a banner's headline.
 */
export function catalogueTitleProblem(title: string | null | undefined): MessageKey | null {
  if (!title) return null;
  return contactFindings(title).length > 0 ? "catalogue.offPlatform" : null;
}

/** The note NetLet writes when it turns one down, cleaned as a title is; a decline needs one. */
export function cleanReviewNote(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CATALOGUE_NOTE_MAX)
    .trim();
  return cleaned || null;
}

/**
 * The name a shopper reads: the title in the page's language where there is
 * one, the other language's otherwise, and the file's own name without its
 * ending when neither was given.
 */
export function catalogueName(
  catalogue: { title: string | null; titleAr: string | null; fileName: string },
  locale: "en" | "ar",
): string {
  const own = locale === "ar" ? catalogue.titleAr : catalogue.title;
  const other = locale === "ar" ? catalogue.title : catalogue.titleAr;
  return own || other || catalogue.fileName.replace(/\.pdf$/i, "") || catalogue.fileName;
}

/** Where one catalogue is read from: the page's own address, `download` asking for a file to keep. */
export function catalogueHref(id: number, download = false): string {
  return `/api/catalogues/${id}${download ? "?download=1" : ""}`;
}

/** One part of a catalogue, for a file too large to be handed over whole. */
export function cataloguePartHref(id: number, part: number): string {
  return `/api/catalogues/${id}?part=${part}`;
}

/** Whether a file this size is read in parts rather than by its own address. */
export function readInParts(size: number): boolean {
  return size > CATALOGUE_DIRECT_BYTES;
}
