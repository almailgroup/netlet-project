/**
 * A store's documents, the database half. The rules are
 * `Shared/inventory/storeDocuments.ts`; the upload and download routes are in
 * `Backend/src/core/app.ts`.
 *
 * **Who may reach a store's papers is asked of the row, never only of the
 * request.** Every read, download and removal looks the document up and asks
 * `can(actor, "vendor.editProfile", row.vendorId)` — NetLet's administrators,
 * and the owner of *that* store. Another store's id, a file marked NetLet
 * only and a number that names nothing are one answer, "not found", so the
 * reply never confirms that a civil ID exists at that number. The bytes leave
 * only through `readStoreDocument`; a list never carries a file.
 *
 * **Whose a file is comes from who uploaded it**: an administrator's account
 * is NetLet's, any other is the store's — only those two can upload at all.
 * A store removes what its own people added and never what NetLet did, so a
 * contract NetLet filed cannot be taken out of the record by the other party
 * to it; NetLet removes any.
 *
 * **Closed, not broken, until migration 0080 is pasted**: a missing table
 * reads as `ready: false` with nothing listed, and an upload says the section
 * is not open yet, so the order of the deploy and the paste does not matter.
 *
 * Outside `db.ts` for the reason every service is: a function inside it calls
 * that file's module-local `getDb`, which a test cannot redirect.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { users, vendorDocuments, vendors } from "../../database/schema.js";
import { documentProblem, safeFileName, sniffDocument, type DocumentProblem, type DocumentType } from "../../../Shared/inventory/applicationDocuments.js";
import {
  MAX_STORE_DOCUMENTS,
  MAX_STORE_DOCUMENT_UPLOADS_PER_HOUR,
  cleanDocumentTitle,
  expiryState,
  isStoreDocumentKind,
  mayRemoveDocument,
  readExpiry,
  type ExpiryState,
  type StoreDocumentKind,
} from "../../../Shared/inventory/storeDocuments.js";
import { assertCan, can, type Actor } from "../../../Shared/inventory/permissions.js";
import { kuwaitDay } from "../../../Shared/kuwaitDay.js";
import { isMissingTable } from "../core/describeError.js";
import { recordAudit } from "./audit.js";
import { getDb } from "./db.js";
import { auditActor } from "./inventory.js";
import { takeHourlyAllowance } from "./rateLimit.js";

export type StoreDocumentRefusal =
  | DocumentProblem
  | "documents.tooMany"
  | "documents.notFound"
  | "storeDocs.unavailable"
  | "storeDocs.tooManyFiles"
  | "storeDocs.chooseKind"
  | "storeDocs.badExpiry"
  | "storeDocs.notYours";

export class StoreDocumentRefused extends Error {
  constructor(readonly reason: StoreDocumentRefusal) {
    super(reason);
    this.name = "StoreDocumentRefused";
  }
}

async function handle() {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

export type StoreDocumentView = {
  id: number;
  kind: StoreDocumentKind;
  title: string | null;
  fileName: string;
  contentType: DocumentType;
  byteSize: number;
  /** The paper's own last day, a Kuwaiti calendar day, and where it stands today. */
  expiresOn: string | null;
  expiry: ExpiryState;
  /** A file the store is never shown. Only ever true in an administrator's list. */
  netletOnly: boolean;
  /** Whose upload it was; null once the account that made it is gone. */
  by: "netlet" | "store" | null;
  /** Who uploaded it: a name to NetLet, and to a store only for its own people's. */
  uploader: string | null;
  /** Whether the person asking may remove it: the buttons the page draws. */
  mayRemove: boolean;
  createdAt: Date;
};

export type StoreDocumentList = {
  /** False until the table exists (migration 0080): the section says it is not open yet. */
  ready: boolean;
  /** Whether the person asking is NetLet, who may also mark a file NetLet only. */
  netlet: boolean;
  /** How many more files this store can hold. */
  room: number;
  documents: StoreDocumentView[];
};

/* Every column but the bytes: a list never carries a file. */
const VIEW = {
  id: vendorDocuments.id,
  kind: vendorDocuments.kind,
  title: vendorDocuments.title,
  fileName: vendorDocuments.fileName,
  contentType: vendorDocuments.contentType,
  byteSize: vendorDocuments.byteSize,
  expiresOn: vendorDocuments.expiresOn,
  netletOnly: vendorDocuments.netletOnly,
  createdAt: vendorDocuments.createdAt,
  uploaderRole: users.role,
  uploaderName: users.name,
  uploaderEmail: users.email,
  uploadedBy: vendorDocuments.uploadedBy,
};

type Row = {
  id: number;
  kind: StoreDocumentKind;
  title: string | null;
  fileName: string;
  contentType: DocumentType;
  byteSize: number;
  expiresOn: string | null;
  netletOnly: boolean;
  createdAt: Date;
  uploaderRole: string | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  uploadedBy: number | null;
};

/** Whose upload a row was: an administrator's account is NetLet's, any other the store's. */
function sideOf(row: { uploadedBy: number | null; uploaderRole: string | null }): "netlet" | "store" | null {
  if (row.uploadedBy === null || row.uploaderRole === null) return null;
  return row.uploaderRole === "admin" ? "netlet" : "store";
}

function shape(row: Row, viewer: "netlet" | "store", today: string): StoreDocumentView {
  const by = sideOf(row);
  const person = row.uploaderName?.trim() || row.uploaderEmail || null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    expiresOn: row.expiresOn,
    expiry: expiryState(row.expiresOn, today),
    netletOnly: row.netletOnly,
    by,
    /* A store is told NetLet added a file, not which of NetLet's people did. */
    uploader: viewer === "netlet" || by === "store" ? person : null,
    mayRemove: mayRemoveDocument(viewer, { byStore: by === "store", netletOnly: row.netletOnly }),
    createdAt: row.createdAt,
  };
}

const viewerOf = (actor: Actor): "netlet" | "store" => (actor.kind === "admin" ? "netlet" : "store");

/**
 * One store's documents, newest first — to NetLet every one, to the store's
 * owner all but those marked NetLet only.
 */
export async function listStoreDocuments(actor: Actor, vendorId: number, now = new Date()): Promise<StoreDocumentList> {
  assertCan(actor, "vendor.editProfile", vendorId);
  const viewer = viewerOf(actor);
  const db = await getDb();
  if (!db) return { ready: false, netlet: viewer === "netlet", room: 0, documents: [] };
  try {
    const [rows, [held]] = await Promise.all([
      db
        .select(VIEW)
        .from(vendorDocuments)
        .leftJoin(users, eq(users.id, vendorDocuments.uploadedBy))
        .where(and(eq(vendorDocuments.vendorId, vendorId), viewer === "netlet" ? undefined : eq(vendorDocuments.netletOnly, false)))
        .orderBy(desc(vendorDocuments.createdAt), desc(vendorDocuments.id)),
      /* Every file counts toward the store's room, the ones it cannot see included. */
      db.select({ n: sql<number>`count(*)::int` }).from(vendorDocuments).where(eq(vendorDocuments.vendorId, vendorId)),
    ]);
    const today = kuwaitDay(now);
    return {
      ready: true,
      netlet: viewer === "netlet",
      room: Math.max(0, MAX_STORE_DOCUMENTS - (held?.n ?? 0)),
      documents: rows.map(row => shape(row as Row, viewer, today)),
    };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, netlet: viewer === "netlet", room: 0, documents: [] };
    throw error;
  }
}

/**
 * Store one file against a store. The bytes decide what it is; the kind, the
 * last day and the title are checked by the shared rule; and only an
 * administrator's "NetLet only" is kept — a store's own upload is always one
 * NetLet and the store both see.
 */
export async function uploadStoreDocument(
  actor: Actor,
  vendorId: number,
  request: {
    kind: string | null | undefined;
    title?: string | null;
    expiresOn?: string | null;
    netletOnly?: boolean;
    fileName: string | null;
    declaredType: string;
    bytes: Uint8Array;
  },
  now = new Date(),
): Promise<StoreDocumentView> {
  assertCan(actor, "vendor.editProfile", vendorId);
  if (!isStoreDocumentKind(request.kind)) throw new StoreDocumentRefused("storeDocs.chooseKind");
  const expiry = readExpiry(request.expiresOn);
  if (!expiry.ok) throw new StoreDocumentRefused("storeDocs.badExpiry");
  const problem = documentProblem(request.bytes, request.declaredType);
  if (problem) throw new StoreDocumentRefused(problem);
  const type = sniffDocument(request.bytes)!;
  const viewer = viewerOf(actor);
  const kind = request.kind;

  const db = await handle();
  try {
    const [store] = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    if (!store) throw new StoreDocumentRefused("documents.notFound");
    const [held] = await db.select({ n: sql<number>`count(*)::int` }).from(vendorDocuments).where(eq(vendorDocuments.vendorId, vendorId));
    if ((held?.n ?? 0) >= MAX_STORE_DOCUMENTS) throw new StoreDocumentRefused("storeDocs.tooManyFiles");
    /* Counted last, so a file refused for what it is does not spend the hour. */
    if (!(await takeHourlyAllowance(actor.userId, "storeDocument", MAX_STORE_DOCUMENT_UPLOADS_PER_HOUR))) throw new StoreDocumentRefused("documents.tooMany");

    const [inserted] = await db
      .insert(vendorDocuments)
      .values({
        vendorId,
        kind,
        title: cleanDocumentTitle(request.title),
        fileName: safeFileName(request.fileName, type),
        contentType: type,
        byteSize: request.bytes.length,
        sha256: createHash("sha256").update(request.bytes).digest("hex"),
        bytes: request.bytes,
        expiresOn: expiry.day,
        netletOnly: viewer === "netlet" && request.netletOnly === true,
        uploadedBy: actor.userId,
        createdAt: now,
      })
      .returning({ id: vendorDocuments.id });
    const [row] = await db
      .select(VIEW)
      .from(vendorDocuments)
      .leftJoin(users, eq(users.id, vendorDocuments.uploadedBy))
      .where(eq(vendorDocuments.id, inserted.id))
      .limit(1);
    const view = shape(row as Row, viewer, kuwaitDay(now));
    await recordAudit(await auditActor(actor), {
      action: "vendor.document.add",
      subjectType: "vendor",
      subjectId: vendorId,
      subjectLabel: store.name,
      vendorId,
      after: { documentId: view.id, kind: view.kind, title: view.title, fileName: view.fileName, byteSize: view.byteSize, expiresOn: view.expiresOn, netletOnly: view.netletOnly },
    });
    return view;
  } catch (error) {
    if (isMissingTable(error)) throw new StoreDocumentRefused("storeDocs.unavailable");
    throw error;
  }
}

/** One row with what deciding about it needs, or null where there is none (or no table yet). */
async function findDocument(id: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select({
        id: vendorDocuments.id,
        vendorId: vendorDocuments.vendorId,
        kind: vendorDocuments.kind,
        title: vendorDocuments.title,
        fileName: vendorDocuments.fileName,
        contentType: vendorDocuments.contentType,
        netletOnly: vendorDocuments.netletOnly,
        uploadedBy: vendorDocuments.uploadedBy,
        uploaderRole: users.role,
        store: vendors.name,
      })
      .from(vendorDocuments)
      .innerJoin(vendors, eq(vendors.id, vendorDocuments.vendorId))
      .leftJoin(users, eq(users.id, vendorDocuments.uploadedBy))
      .where(eq(vendorDocuments.id, id))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/**
 * The store a document belongs to, so a caller can resolve who is asking
 * *for that store* — somebody who owns two stores acts for one at a time —
 * before asking anything else. Says nothing a refusal would not.
 */
export async function storeOfDocument(id: number): Promise<number | null> {
  return (await findDocument(id))?.vendorId ?? null;
}

/** Whether this actor may so much as know the row exists. */
function reaches(actor: Actor, row: { vendorId: number; netletOnly: boolean }): boolean {
  if (!can(actor, "vendor.editProfile", row.vendorId)) return false;
  return actor.kind === "admin" || !row.netletOnly;
}

/**
 * One file's bytes, for the download route: to NetLet, or to the owner of
 * the store it belongs to unless it is NetLet only. Null for anybody else and
 * for an id that names nothing — the same answer.
 */
export async function readStoreDocument(actor: Actor, id: number): Promise<{ fileName: string; contentType: DocumentType; bytes: Uint8Array } | null> {
  const row = await findDocument(id);
  if (!row || !reaches(actor, row)) return null;
  const db = await handle();
  const [file] = await db.select({ bytes: vendorDocuments.bytes }).from(vendorDocuments).where(eq(vendorDocuments.id, id)).limit(1);
  if (!file) return null;
  return { fileName: row.fileName, contentType: row.contentType, bytes: file.bytes };
}

/**
 * Take a file out of a store's documents, for good. NetLet removes any; a
 * store's owner removes what the store's own people uploaded, and is told
 * why when the file is NetLet's.
 */
export async function removeStoreDocument(actor: Actor, id: number): Promise<{ vendorId: number }> {
  const row = await findDocument(id);
  if (!row || !reaches(actor, row)) throw new StoreDocumentRefused("documents.notFound");
  const viewer = viewerOf(actor);
  if (!mayRemoveDocument(viewer, { byStore: sideOf(row) === "store", netletOnly: row.netletOnly })) throw new StoreDocumentRefused("storeDocs.notYours");
  const db = await handle();
  const gone = await db.delete(vendorDocuments).where(eq(vendorDocuments.id, id)).returning({ id: vendorDocuments.id });
  /* Somebody else removed it between the look and the press. */
  if (gone.length === 0) throw new StoreDocumentRefused("documents.notFound");
  await recordAudit(await auditActor(actor), {
    action: "vendor.document.remove",
    subjectType: "vendor",
    subjectId: row.vendorId,
    subjectLabel: row.store,
    vendorId: row.vendorId,
    before: { documentId: row.id, kind: row.kind, title: row.title, fileName: row.fileName, netletOnly: row.netletOnly },
  });
  return { vendorId: row.vendorId };
}
