/**
 * Seller application documents (3.3.1), the database half. The rules are
 * `shared/inventory/applicationDocuments.ts`; the upload and download routes
 * are in `server/_core/app.ts`.
 *
 * **Who may read one is decided in the query.** The applicant reaches a
 * document through their own application's `user_id`, an administrator
 * through `platform.manageUsers`; anybody else's id is "not found", never
 * "forbidden", so the answer does not confirm a civil ID exists at that
 * number. The bytes leave only through `readDocument`, never in a list.
 *
 * Outside `db.ts` for the reason `applications.ts` is: a function inside it
 * calls that file's module-local `getDb`, which a test cannot redirect.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { applicationDocuments, vendorApplications } from "../drizzle/schema.js";
import {
  DOCUMENT_NOTE_MAX,
  MAX_DOCUMENTS_PER_APPLICATION,
  MAX_DOCUMENT_UPLOADS_PER_HOUR,
  documentProblem,
  safeFileName,
  sniffDocument,
  type DocumentKind,
  type DocumentProblem,
  type DocumentStatus,
  type DocumentType,
} from "../shared/inventory/applicationDocuments.js";
import { editableByApplicant, type ApplicationState } from "../shared/inventory/sellerApplication.js";
import { assertCan, can, type Actor } from "../shared/inventory/permissions.js";
import { getDb } from "./db.js";

export type DocumentRefusal =
  | DocumentProblem
  | "documents.saveFirst"
  | "documents.locked"
  | "documents.tooMany"
  | "documents.tooManyFiles"
  | "documents.notFound"
  | "documents.notWaiting"
  | "documents.needsNote";

export class DocumentRefused extends Error {
  constructor(readonly reason: DocumentRefusal) {
    super(reason);
    this.name = "DocumentRefused";
  }
}

async function handle() {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

export type DocumentView = {
  id: number;
  kind: DocumentKind;
  fileName: string;
  contentType: DocumentType;
  byteSize: number;
  status: DocumentStatus;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

/* Every column but the bytes: a list never carries a file. */
const VIEW = {
  id: applicationDocuments.id,
  kind: applicationDocuments.kind,
  fileName: applicationDocuments.fileName,
  contentType: applicationDocuments.contentType,
  byteSize: applicationDocuments.byteSize,
  status: applicationDocuments.status,
  reviewNote: applicationDocuments.reviewNote,
  reviewedAt: applicationDocuments.reviewedAt,
  createdAt: applicationDocuments.createdAt,
};

/** The applicant's newest application, which is the one documents attach to. */
async function ownApplication(userId: number) {
  const db = await handle();
  const [row] = await db
    .select({ id: vendorApplications.id, status: vendorApplications.status })
    .from(vendorApplications)
    .where(eq(vendorApplications.userId, userId))
    .orderBy(desc(vendorApplications.createdAt), desc(vendorApplications.id))
    .limit(1);
  return row ?? null;
}

/**
 * Store one file against the applicant's own application. Only while they can
 * still edit it: a submitted application is in a reviewer's hands, and a file
 * that arrives under the reviewer mid-read is one they never saw.
 */
export async function uploadDocument(
  userId: number,
  request: { kind: DocumentKind; fileName: string | null; declaredType: string; bytes: Uint8Array },
  now = new Date(),
): Promise<DocumentView> {
  const problem = documentProblem(request.bytes, request.declaredType);
  if (problem) throw new DocumentRefused(problem);
  const type = sniffDocument(request.bytes)!;

  const application = await ownApplication(userId);
  if (!application) throw new DocumentRefused("documents.saveFirst");
  if (!editableByApplicant(application.status as ApplicationState)) throw new DocumentRefused("documents.locked");

  const db = await handle();
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.uploadedBy, userId), gt(applicationDocuments.createdAt, new Date(now.getTime() - 60 * 60 * 1000))));
  if (recent >= MAX_DOCUMENT_UPLOADS_PER_HOUR) throw new DocumentRefused("documents.tooMany");
  const [{ held }] = await db
    .select({ held: sql<number>`count(*)::int` })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.applicationId, application.id));
  if (held >= MAX_DOCUMENTS_PER_APPLICATION) throw new DocumentRefused("documents.tooManyFiles");

  const [row] = await db
    .insert(applicationDocuments)
    .values({
      applicationId: application.id,
      kind: request.kind,
      fileName: safeFileName(request.fileName, type),
      contentType: type,
      byteSize: request.bytes.length,
      sha256: createHash("sha256").update(request.bytes).digest("hex"),
      bytes: request.bytes,
      uploadedBy: userId,
      createdAt: now,
    })
    .returning(VIEW);
  return row;
}

/** The applicant's own documents, newest first. */
export async function myDocuments(userId: number): Promise<DocumentView[]> {
  const db = await getDb();
  if (!db) return [];
  const application = await ownApplication(userId);
  if (!application) return [];
  return db
    .select(VIEW)
    .from(applicationDocuments)
    .where(eq(applicationDocuments.applicationId, application.id))
    .orderBy(desc(applicationDocuments.createdAt), desc(applicationDocuments.id));
}

/** One application's documents, for an administrator reviewing it. */
export async function documentsFor(actor: Actor, applicationId: number): Promise<DocumentView[]> {
  assertCan(actor, "platform.manageUsers");
  const db = await handle();
  return db
    .select(VIEW)
    .from(applicationDocuments)
    .where(eq(applicationDocuments.applicationId, applicationId))
    .orderBy(desc(applicationDocuments.createdAt), desc(applicationDocuments.id));
}

/** Each listed application's documents still waiting, for the queue's rows. */
export async function pendingCounts(actor: Actor, applicationIds: number[]): Promise<Map<number, number>> {
  assertCan(actor, "platform.manageUsers");
  if (applicationIds.length === 0) return new Map();
  const db = await handle();
  const rows = await db
    .select({ applicationId: applicationDocuments.applicationId, n: sql<number>`count(*)::int` })
    .from(applicationDocuments)
    .where(and(inArray(applicationDocuments.applicationId, applicationIds), eq(applicationDocuments.status, "pending")))
    .groupBy(applicationDocuments.applicationId);
  return new Map(rows.map(row => [row.applicationId, row.n]));
}

/**
 * One file's bytes, for the download route: to the applicant whose
 * application it is, or to an administrator. Null for anybody else, and for
 * an id that does not exist — the same answer.
 */
export async function readDocument(actor: Actor, id: number): Promise<{ fileName: string; contentType: DocumentType; bytes: Uint8Array } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ fileName: applicationDocuments.fileName, contentType: applicationDocuments.contentType, bytes: applicationDocuments.bytes, owner: vendorApplications.userId })
    .from(applicationDocuments)
    .innerJoin(vendorApplications, eq(vendorApplications.id, applicationDocuments.applicationId))
    .where(eq(applicationDocuments.id, id))
    .limit(1);
  if (!row) return null;
  if (row.owner !== actor.userId && !can(actor, "platform.manageUsers")) return null;
  return { fileName: row.fileName, contentType: row.contentType, bytes: row.bytes };
}

/**
 * An administrator's decision on one file. Turning one down says why, on the
 * row the applicant reads. Accepting one deletes the older files of its kind,
 * which it replaces.
 *
 * Decided with "still pending" in the predicate, so two reviewers cannot both
 * decide it, and the clean-up is in the same transaction as the decision.
 */
export async function reviewDocument(
  actor: Actor,
  request: { id: number; decision: "accept" | "reject"; note?: string | null },
  now = new Date(),
): Promise<DocumentStatus> {
  assertCan(actor, "platform.manageUsers");
  const note = (request.note ?? "").replace(/\s+/g, " ").trim().slice(0, DOCUMENT_NOTE_MAX) || null;
  if (request.decision === "reject" && !note) throw new DocumentRefused("documents.needsNote");
  const db = await handle();
  const status: DocumentStatus = request.decision === "accept" ? "accepted" : "rejected";

  await db.transaction(async tx => {
    const [decided] = await tx
      .update(applicationDocuments)
      .set({ status, reviewNote: note, reviewedBy: actor.userId, reviewedAt: now })
      .where(and(eq(applicationDocuments.id, request.id), eq(applicationDocuments.status, "pending")))
      .returning({ applicationId: applicationDocuments.applicationId, kind: applicationDocuments.kind, createdAt: applicationDocuments.createdAt });
    if (!decided) {
      const [exists] = await tx.select({ id: applicationDocuments.id }).from(applicationDocuments).where(eq(applicationDocuments.id, request.id)).limit(1);
      throw new DocumentRefused(exists ? "documents.notWaiting" : "documents.notFound");
    }
    if (status === "accepted") {
      await tx
        .delete(applicationDocuments)
        .where(and(
          eq(applicationDocuments.applicationId, decided.applicationId),
          eq(applicationDocuments.kind, decided.kind),
          ne(applicationDocuments.id, request.id),
          lt(applicationDocuments.createdAt, decided.createdAt),
        ));
    }
  });
  return status;
}

/**
 * The applicant takes back a file nobody has accepted, while they can still
 * edit the application. An accepted one is replaced by uploading another,
 * never removed: it is what the reviewer already relied on.
 */
export async function deleteDocument(userId: number, id: number): Promise<void> {
  const application = await ownApplication(userId);
  if (!application) throw new DocumentRefused("documents.notFound");
  if (!editableByApplicant(application.status as ApplicationState)) throw new DocumentRefused("documents.locked");
  const db = await handle();
  const gone = await db
    .delete(applicationDocuments)
    .where(and(
      eq(applicationDocuments.id, id),
      eq(applicationDocuments.applicationId, application.id),
      ne(applicationDocuments.status, "accepted"),
    ))
    .returning({ id: applicationDocuments.id });
  if (gone.length === 0) throw new DocumentRefused("documents.notFound");
}

/** Every document an application holds, as the approval's check reads them. */
export async function documentFactsFor(applicationId: number) {
  const db = await handle();
  return db
    .select({ id: applicationDocuments.id, kind: applicationDocuments.kind, status: applicationDocuments.status, createdAt: applicationDocuments.createdAt })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.applicationId, applicationId))
    .orderBy(asc(applicationDocuments.id));
}
