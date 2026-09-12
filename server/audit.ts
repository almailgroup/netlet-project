/**
 * The audit trail.
 *
 * Two rules, and both are what make it worth having:
 *
 * **It is written next to the operation, not at the router.** A router-level
 * wrapper misses any second caller added later — the same reasoning that puts
 * the permission guard in the data layer. An audit trail with a hole in it is
 * worse than none, because it is trusted.
 *
 * **It never fails the operation it records.** If writing the row throws — the
 * database is briefly unavailable, a column is missing after a bad migration —
 * the commission edit that was the point of the request still succeeds, and
 * the failure is logged instead. The alternative is an audit system that takes
 * the site down, which is how audit logging gets switched off.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { auditLog } from "../drizzle/schema.js";
import { describeError } from "./_core/describeError.js";
import { getDb } from "./db.js";

/** The sensitive operations the requirements name, and nothing else. */
export type AuditAction =
  | "vendor.create"
  | "vendor.update"
  | "vendor.setCommission"
  | "vendor.setStatus"
  | "vendor.addMember"
  | "vendor.removeMember"
  | "product.review"
  | "product.setStatus"
  | "product.priceChange"
  | "product.create"
  | "product.delete"
  | "user.setAdmin"
  | "user.sendPasswordReset"
  | "admin.signIn";

export type AuditActor = {
  id?: number | null;
  email?: string | null;
};

export type AuditRecord = {
  action: AuditAction;
  subjectType: "vendor" | "product" | "user" | "session" | "variant";
  subjectId?: number | null;
  subjectLabel?: string | null;
  vendorId?: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function recordAudit(actor: AuditActor, record: AuditRecord): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLog).values({
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId ?? null,
      subjectLabel: record.subjectLabel ?? null,
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      vendorId: record.vendorId ?? null,
      before: record.before ?? null,
      after: record.after ?? null,
    });
  } catch (error) {
    // Deliberately swallowed — see the note at the top of the file.
    console.error(`[audit] failed to record ${record.action}: ${describeError(error)}`);
  }
}

/**
 * Reading it back.
 *
 * Admin-only, enforced by the caller's `platform.viewAll` guard. Newest first,
 * because the question is almost always "what just happened".
 */
export async function listAudit(options: {
  action?: AuditAction;
  subjectType?: string;
  vendorId?: number;
  since?: Date;
  limit?: number;
} = {}) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        options.action ? eq(auditLog.action, options.action) : undefined,
        options.subjectType ? eq(auditLog.subjectType, options.subjectType) : undefined,
        options.vendorId ? eq(auditLog.vendorId, options.vendorId) : undefined,
        options.since ? gte(auditLog.createdAt, options.since) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(options.limit ?? 100);
}

/**
 * How many warnings a vendor has accumulated.
 *
 * The requirements suspend a vendor automatically after three violations, and
 * the audit trail is already the record of what they did — so the count comes
 * from here rather than from a second tally that could disagree with it.
 */
export async function violationCount(vendorId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.vendorId, vendorId), eq(auditLog.action, "product.review"), sql`${auditLog.after} ->> 'approved' = 'false'`));
  return row?.count ?? 0;
}
