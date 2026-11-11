/**
 * A store's own documents, kept with the store — on the owner's word ("for
 * the vendors there should be a section that will allow to upload documents
 * for the vendor. Store documents"): the trade licence, the commercial
 * registration, the signatory's civil ID, the bank's IBAN letter, an
 * authorisation to sign, the contract with NetLet, the Ministry's discount
 * permit, and anything else worth keeping beside the store.
 *
 * Pure and shared, for the password floor's reason: the form refuses what the
 * upload route would refuse, before a file is sent.
 *
 * ## Who
 *
 * NetLet's administrators and the store's owner, the owner's choice. An
 * owner and not a manager, because these are the papers the payout account
 * and the licence rest on (`vendor.editProfile`, the rank that edits them).
 * Each side sees what the other uploaded — except a file an administrator
 * marks **NetLet only**, which the store is never shown, listed or handed.
 *
 * ## What a file is
 *
 * The application documents' rule, reused whole
 * (`Shared/inventory/applicationDocuments.ts`): a PDF, JPEG, PNG or WebP by
 * its own first bytes, at most 4 MB, stored under a cleaned name and only
 * ever handed back as an attachment.
 *
 * ## A paper's last day
 *
 * A licence and a permit end on a date, and the commonest question about a
 * store's papers is which of them has. `expires_on` is optional and is a
 * Kuwaiti calendar day; `expiryState` says whether it has passed, ends within
 * `EXPIRY_SOON_DAYS`, or stands — worked out on the read from today's
 * Kuwaiti day, so nothing has to run for a paper to read as expired.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { DAY_ONLY } from "../kuwaitDay.js";

export const STORE_DOCUMENT_KINDS = [
  "trade_licence",
  "commercial_registration",
  "signatory_id",
  "iban_letter",
  "authorisation",
  "contract",
  "discount_permit",
  "other",
] as const;
export type StoreDocumentKind = (typeof STORE_DOCUMENT_KINDS)[number];

/** Each kind's name. The papers an application also asks for keep its words for them. */
export const STORE_DOCUMENT_KIND_LABEL: Record<StoreDocumentKind, MessageKey> = {
  trade_licence: "documents.kindTradeLicence",
  commercial_registration: "storeDocs.kindRegistration",
  signatory_id: "documents.kindSignatoryId",
  iban_letter: "documents.kindIbanLetter",
  authorisation: "documents.kindAuthorisation",
  contract: "storeDocs.kindContract",
  discount_permit: "storeDocs.kindDiscountPermit",
  other: "documents.kindOther",
};

export function isStoreDocumentKind(value: unknown): value is StoreDocumentKind {
  return typeof value === "string" && (STORE_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** How many files one store may hold. */
export const MAX_STORE_DOCUMENTS = 60;
/** How many one account may upload in an hour, counted in Postgres. */
export const MAX_STORE_DOCUMENT_UPLOADS_PER_HOUR = 30;
/** The column's width. */
export const STORE_DOCUMENT_TITLE_MAX = 120;
/** A paper ending within this many days is said to be ending soon. */
export const EXPIRY_SOON_DAYS = 30;

/**
 * The name somebody gave a file, as it is stored: nothing invisible (a
 * control or a direction mark), runs of space as one, at most the column's
 * width; nothing left is no title.
 */
export function cleanDocumentTitle(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STORE_DOCUMENT_TITLE_MAX)
    .trim();
  return cleaned || null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number | null {
  if (!DAY_ONLY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const at = Date.UTC(year, month - 1, date);
  /* 2026-02-30 parses, as the second of March: a real day reads back as itself. */
  return new Date(at).toISOString().slice(0, 10) === day ? Math.round(at / DAY_MS) : null;
}

/**
 * A last day as sent — `yyyy-mm-dd`, or nothing — or what is wrong with it.
 * A day already gone is allowed: recording a licence that has expired is how
 * somebody finds out it needs renewing.
 */
export function readExpiry(raw: string | null | undefined): { ok: true; day: string | null } | { ok: false } {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, day: null };
  const number = dayNumber(value);
  if (number === null) return { ok: false };
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return { ok: false };
  return { ok: true, day: value };
}

export type ExpiryState =
  /** No last day recorded. */
  | { kind: "none" }
  /** It ended `days` days ago; zero is never this — a paper is good for the whole of its last day. */
  | { kind: "expired"; days: number }
  /** It ends in `days` days, today being zero. */
  | { kind: "soon"; days: number }
  | { kind: "valid" };

/** Where a paper stands against today's Kuwaiti day (`kuwaitDay(new Date())`). */
export function expiryState(expiresOn: string | null | undefined, today: string): ExpiryState {
  const end = expiresOn ? dayNumber(expiresOn) : null;
  const now = dayNumber(today);
  if (end === null || now === null) return { kind: "none" };
  const left = end - now;
  if (left < 0) return { kind: "expired", days: -left };
  if (left <= EXPIRY_SOON_DAYS) return { kind: "soon", days: left };
  return { kind: "valid" };
}

/**
 * What a store's person may do with one file, which the server answers on
 * every row so the page draws exactly the buttons the API accepts. NetLet
 * removes any; a store removes what its own people uploaded, never NetLet's.
 */
export function mayRemoveDocument(viewer: "netlet" | "store", document: { byStore: boolean; netletOnly: boolean }): boolean {
  if (viewer === "netlet") return true;
  return document.byStore && !document.netletOnly;
}
