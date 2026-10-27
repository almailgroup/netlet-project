/**
 * The documents a seller applies with (3.3.1), uploaded rather than linked:
 * the trade licence, the signatory's civil ID, the bank's IBAN letter, an
 * authorisation to sign for the business, and anything else the reviewer
 * asks for. Each is decided on by an administrator, one at a time.
 *
 * Pure and shared, for the password floor's reason: the form refuses the file
 * the upload route would refuse, before it is sent.
 *
 * ## The bytes say what a file is
 *
 * Never the name and never the declared type, which are whatever the sender
 * said. `sniffDocument` reads the first bytes — `%PDF-`, a JPEG, a PNG or a
 * WebP — and the declared type has to agree. Nothing else is stored, so
 * nothing kept here can be a page or a script, and every one is served as an
 * attachment besides (`Backend/src/core/app.ts`).
 *
 * ## At most 4 MB
 *
 * A Vercel function refuses a request body much over 4.5 MB, and a scan of a
 * licence fits well inside four. A bigger file is refused here with a
 * sentence, rather than by the platform with a bare 413.
 *
 * ## A replacement does not throw the old one away
 *
 * A kind's newest upload is the one being decided on. An accepted document
 * stays until its replacement is accepted — a seller replacing an expired
 * licence is not, for the days the new one waits, a seller with no licence —
 * and only then are the older ones of that kind deleted, because a civil ID
 * nobody needs any more is one more copy to lose.
 */
import type { MessageKey } from "../i18n/dictionary.js";

export const DOCUMENT_KINDS = ["trade_licence", "signatory_id", "iban_letter", "authorisation", "other", "contract", "signed_contract"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * The contract step (3.3.1: "the final contract is sent to the applicant, who
 * signs and uploads it"). NetLet attaches `contract` — its own document, so it
 * is accepted as it arrives — and the applicant answers with
 * `signed_contract`, which is reviewed like any other paper. Everything but the
 * contract is the applicant's to upload.
 */
export const APPLICANT_KINDS: readonly DocumentKind[] = DOCUMENT_KINDS.filter(kind => kind !== "contract");

/** Each kind's name, for the pages and for a notice naming the paper turned down. */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, MessageKey> = {
  trade_licence: "documents.kindTradeLicence",
  signatory_id: "documents.kindSignatoryId",
  iban_letter: "documents.kindIbanLetter",
  authorisation: "documents.kindAuthorisation",
  other: "documents.kindOther",
  contract: "documents.kindContract",
  signed_contract: "documents.kindSignedContract",
};

/**
 * Whether an application waits on its signed contract: NetLet attached one,
 * and no signed copy has been accepted. An application NetLet attached no
 * contract to is not held back by one.
 */
export function contractUnsigned(documents: DocumentFacts[]): boolean {
  return documents.some(document => document.kind === "contract")
    && !documents.some(document => document.kind === "signed_contract" && document.status === "accepted");
}

export const DOCUMENT_STATUSES = ["pending", "accepted", "rejected"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The most one file may weigh. */
export const MAX_DOCUMENT_BYTES = 4_000_000;
/** How many files one application may hold, every kind and every replacement together. */
export const MAX_DOCUMENTS_PER_APPLICATION = 20;
/** How many one account may upload in an hour, counted in Postgres. */
export const MAX_DOCUMENT_UPLOADS_PER_HOUR = 30;
export const DOCUMENT_NOTE_MAX = 400;

export type DocumentProblem = "documents.empty" | "documents.tooLarge" | "documents.notAccepted" | "documents.wrongType";

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) => prefix.every((value, index) => bytes[at + index] === value);

/** What a file is, from its own first bytes, or null for anything not taken here. */
export function sniffDocument(bytes: Uint8Array): DocumentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** What is wrong with a file as sent, or null. */
export function documentProblem(bytes: Uint8Array, declared: string): DocumentProblem | null {
  if (bytes.length === 0) return "documents.empty";
  if (bytes.length > MAX_DOCUMENT_BYTES) return "documents.tooLarge";
  const actual = sniffDocument(bytes);
  if (!actual) return "documents.notAccepted";
  if (actual !== declared.split(";")[0].trim().toLowerCase()) return "documents.wrongType";
  return null;
}

const EXTENSION: Record<DocumentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * A file name safe to store and to hand back in a download header: no path,
 * no control or direction characters, nothing but letters, digits, spaces and
 * `._-()`, at most 200 characters, and ending in the extension its bytes
 * earned — so "licence.pdf.exe" sent as a PDF downloads as a `.pdf`.
 */
export function safeFileName(name: string | null | undefined, type: DocumentType): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 180) || "document";
  return `${stem}.${EXTENSION[type]}`;
}

export type DocumentFacts = { id: number; kind: DocumentKind; status: DocumentStatus; createdAt: Date | string };

/**
 * Each kind's documents that still matter, newest first: the newest upload,
 * and an older accepted one it would replace. Everything else of that kind is
 * history the newest has made irrelevant.
 */
export function currentByKind<T extends DocumentFacts>(documents: T[]): Map<DocumentKind, { latest: T; replacing: T | null }> {
  const sorted = [...documents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);
  const current = new Map<DocumentKind, { latest: T; replacing: T | null }>();
  for (const document of sorted) {
    const held = current.get(document.kind);
    if (!held) current.set(document.kind, { latest: document, replacing: null });
    else if (held.latest.status !== "accepted" && !held.replacing && document.status === "accepted") held.replacing = document;
  }
  return current;
}

/** Whether any document still waits on a decision — which approving the application waits on too. */
export function documentsPending(documents: DocumentFacts[]): boolean {
  return [...currentByKind(documents).values()].some(entry => entry.latest.status === "pending");
}
