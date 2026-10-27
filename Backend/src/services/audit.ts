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
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { auditLog, staffGrants, users } from "../../database/schema.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { describeError } from "../core/describeError.js";
import { getDb } from "./db.js";

/*
 * The sensitive operations the requirements name, and nothing else.
 *
 * A list rather than only a union, so a test can ask that every act the trail
 * records has words on the audit page — three of them were printed as their
 * raw names ("vendor.update") because a label was never written.
 */
export const AUDIT_ACTIONS = [
  "vendor.create",
  "vendor.update",
  "vendor.setCommission",
  "vendor.setStatus",
  "vendor.addMember",
  "vendor.removeMember",
  "product.review",
  /* A submission NetLet AI and the rule's checks both found nothing in, put on
     the shelf without a person (3.3.6) — on the trail so a person can take it down. */
  "product.autoApprove",
  "product.setStatus",
  "product.priceChange",
  "product.create",
  "product.delete",
  /* A product handed from one store to another, by an administrator. */
  "product.move",
  "user.setAdmin",
  "user.sendPasswordReset",
  "admin.signIn",
  /* Money assigned between two companies (3.4.2): who pays for a broken box. */
  "delivery.decideClaim",
  /* A feature switched on or off for the whole shop (2.3). */
  "platform.setFeature",
  /* An affiliate approved, suspended, or given a new rate (3.7). */
  "affiliate.update",
  /* Money sent to a seller (3.3.21): frozen, filed, downloaded, sent or cancelled. */
  "payout.prepare",
  "payout.file",
  /* The file carries every seller's account number, so reading it is recorded too. */
  "payout.download",
  "payout.record",
  "payout.cancel",
  /* A placement booked, or stopped (3.3.15): money the store commits to spend. */
  "ads.book",
  "ads.cancel",
  /* NetLet's answer on a home banner: what runs on its own front page. */
  "ads.bannerApprove",
  "ads.bannerReject",
  /* A guide published, taken down or deleted (3.5.3): NetLet speaking in public. */
  "guide.setStatus",
  "guide.delete",
  /* A person's hand on a return (3.6.3): a request no rule could decide, the
     item received and what became of it, the cash handed back. The decisions
     a rule makes the moment a shopper asks are the rule's, and are not here. */
  "return.decide",
  "return.receive",
  "return.refundPaid",
  /* An administrator's confirmation of an outcome a rule could not reach
     (3.5.2): only then is the shopper told. */
  "return.confirm",
  /* A number an administrator sets without a deploy — a referral rate (3.1.15). */
  "platform.setSetting",
  /* A store offering a product to affiliates at a rate it funds, or withdrawing it (3.7.1). */
  "product.setAffiliate",
  /* A commission proposal made, and NetLet's answer to it (3.3.2). */
  "commission.propose",
  "commission.decide",
  /* One capability granted to an account, or taken back, by an administrator (3.3.9). */
  "user.grant",
  "user.revokeGrant",
  /* A warning issued to a store, or withdrawn (3.3.18): the third standing one suspends it. */
  "vendor.warn",
  "vendor.withdrawWarning",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActor = {
  id?: number | null;
  email?: string | null;
  /** `admin`, `owner`, `manager`, `staff` — what they were at the time. */
  role?: string | null;
};

export type AuditRecord = {
  action: AuditAction;
  subjectType: "vendor" | "product" | "user" | "session" | "variant" | "claim" | "feature" | "setting" | "affiliate" | "payout" | "payoutFile" | "placement" | "guide" | "return" | "proposal";
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
  /* Admin-only and money, like commission: who authorised the decider matters. */
  "delivery.decideClaim",
  /* Admin-only, and it changes what every store and shopper can do. */
  "platform.setFeature",
  /* Who NetLet pays, and how much: the commission question again. */
  "affiliate.update",
  "payout.prepare",
  "payout.record",
  "payout.cancel",
  /* What a referral pays, and NetLet's answer on a commission: money again. */
  "platform.setSetting",
  "commission.decide",
  /* Who gave whom a capability, which is the chain 3.3.9 asks for by name. */
  "user.grant",
  "user.revokeGrant",
  /* A warning counts towards suspension, so who was allowed to issue it matters. */
  "vendor.warn",
  "vendor.withdrawWarning",
  "return.confirm",
]);

/** The grantable capability each act is done under, for the chain of a granted employee. */
const GRANT_FOR: Partial<Record<AuditAction, string>> = {
  "vendor.setCommission": "vendor.setCommission",
  "commission.decide": "vendor.setCommission",
};

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
  actor: AuditActor,
  action: AuditAction,
): Promise<{ id: number | null; email: string | null }> {
  const actorId = actor.id;
  if (!actorId) return { id: null, email: null };
  /* Somebody who is not an administrator did this under a grant (3.3.9): the
     chain is the administrator who granted that one capability — "which admin
     granted that employee this specific permission". */
  const capability = GRANT_FOR[action];
  if (capability && actor.role !== "admin") {
    const [held] = await db
      .select({ id: staffGrants.grantedBy, email: users.email })
      .from(staffGrants)
      .leftJoin(users, eq(users.id, staffGrants.grantedBy))
      .where(and(eq(staffGrants.userId, actorId), eq(staffGrants.capability, capability)))
      .limit(1);
    if (held) return { id: held.id ?? null, email: held.email ?? null };
  }
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
      ? await authorisedBy(db, actor, record.action)
      : { id: null, email: null };
    await db.insert(auditLog).values({
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId ?? null,
      subjectLabel: record.subjectLabel ?? null,
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      actorRole: actor.role ?? null,
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
 * The ranks that are a seller rather than NetLet.
 *
 * A list rather than "not admin", because a null role — a row written before
 * the column existed, or by something with no actor at all — is not evidence
 * that a seller did it, and counting it as one would put NetLet's own
 * automatic acts in a report about vendors.
 */
const SELLER_ROLES = ["owner", "manager", "staff"] as const;

/** The acts a seller performs on their own catalogue, which an admin watches. */
const SELLER_ACTIONS: AuditAction[] = [
  "product.create",
  "product.delete",
  "product.priceChange",
  "product.setStatus",
  "product.setAffiliate",
  "commission.propose",
];

/**
 * What sellers changed, and how much of it is new to this administrator.
 *
 * Requirement 3.3.8 asks for a vendor's product changes to be *visible to an
 * admin*. They were already logged, which is not the same thing: a trail
 * nobody opens is a filing cabinet, and the requirement is about being told.
 *
 * `since` is the administrator's own last read rather than a fixed window, so
 * the count answers "what have I not seen" instead of "what happened this
 * week" — the second is a number that never reaches zero and therefore never
 * means anything.
 */
export async function sellerChanges(options: { since?: Date | null; vendorId?: number; limit?: number } = {}) {
  const db = await getDb();
  if (!db) return { rows: [], unseen: 0 };

  /* A listing NetLet AI put on the shelf is a seller's change no person has
     looked at, so it is counted with theirs: "an administrator can take it
     down" needs an administrator to be told it went up. */
  const scope = and(
    or(
      and(inArray(auditLog.actorRole, [...SELLER_ROLES]), inArray(auditLog.action, SELLER_ACTIONS)),
      eq(auditLog.action, "product.autoApprove"),
    ),
    options.vendorId ? eq(auditLog.vendorId, options.vendorId) : undefined,
  );

  const rows = await db
    .select()
    .from(auditLog)
    .where(scope)
    // Ends on the id for the reason `listAudit` does: `createdAt` ties.
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(options.limit ?? 100);

  /* Counted in SQL rather than over the page just fetched: a count taken from
     100 loaded rows silently stops at 100 and reports a shop that has been
     busy as one that has been quiet. */
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(options.since ? and(scope, gte(auditLog.createdAt, options.since)) : scope);

  return { rows, unseen: counted?.n ?? 0 };
}

/**
 * The seller changes waiting for this administrator, and how many are new.
 *
 * Guarded here rather than in the router alone, next to the query it protects
 * — the rule the whole data layer follows. `platform.viewAll`, because this is
 * every seller's activity and a vendor reading it would be reading their
 * competitors'.
 */
export async function sellerChangesForAdmin(actor: Actor, limit = 100) {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return { rows: [], unseen: 0, seenAt: null };

  const [me] = await db
    .select({ seenAt: users.auditSeenAt })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);

  const { rows, unseen } = await sellerChanges({ since: me?.seenAt ?? null, limit });
  return { rows, unseen, seenAt: me?.seenAt ?? null };
}

/**
 * Mark the trail read, up to now.
 *
 * Called when an administrator actually opens the page rather than when the
 * count is fetched: a badge that clears itself because a tile rendered
 * somewhere else is a badge that hides work.
 */
export async function markAuditSeen(actor: Actor): Promise<void> {
  assertCan(actor, "platform.viewAll");
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ auditSeenAt: new Date() }).where(eq(users.id, actor.userId));
}
