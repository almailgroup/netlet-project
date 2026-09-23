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

/**
 * The acts that carry the authorisation chain as well as the actor.
 *
 * Deliberately a short list rather than every row. These are the acts no
 * vendor rank can reach at any level — the ones where "and who let them?" is
 * the real question, which is exactly how requirement 3.3.9 words it about
 * commission. Resolving the chain costs one extra query, and spending it on a
 * stock adjustment would be paying for an answer nobody asks.
 */
export const CHAIN_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "vendor.setCommission",
  "user.setAdmin",
  "vendor.setStatus",
]);

/**
 * Who made this actor an administrator.
 *
 * Read out of the trail's own `user.setAdmin` rows rather than from a second
 * table: the grant was already recorded, and a parallel record of the same
 * fact is one that eventually disagrees. The most recent grant wins, because
 * an administrator revoked and restored was authorised by whoever restored
 * them.
 *
 * Returns null rather than guessing. The first administrator of an
 * installation was made one by whoever ran the bootstrap, and there is no row
 * to point at — inventing "system" there would be asserting something the
 * trail does not know.
 */
async function authorisedBy(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  actorId: number | null | undefined,
): Promise<{ id: number | null; email: string | null }> {
  if (!actorId) return { id: null, email: null };
  const [grant] = await db
    .select({ id: auditLog.actorId, email: auditLog.actorEmail })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "user.setAdmin"),
        eq(auditLog.subjectId, actorId),
        /* The grant, not the revocation: `user.setAdmin` records both, and a
           demotion followed by a promotion would otherwise name whoever took
           the rights away as the person who conferred them. */
        sql`${auditLog.after} ->> 'role' = 'admin'`,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  return { id: grant?.id ?? null, email: grant?.email ?? null };
}

export async function recordAudit(actor: AuditActor, record: AuditRecord): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const chain = CHAIN_ACTIONS.has(record.action)
      ? await authorisedBy(db, actor.id)
      : { id: null, email: null };
    await db.insert(auditLog).values({
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId ?? null,
      subjectLabel: record.subjectLabel ?? null,
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      authorisedById: chain.id,
      authorisedByEmail: chain.email,
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
    /*
     * Ends on the id, which is unique. `createdAt` alone ties — several rows
     * written inside one request share a microsecond — and Postgres orders
     * ties freely between two queries, so "the most recent entry" was a coin
     * toss and the page could show the same act twice in a different order on
     * a refresh. The same rule every paged admin list already follows; this
     * one was missed because it is capped rather than paged.
     */
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
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
