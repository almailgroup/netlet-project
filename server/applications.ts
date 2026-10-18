/**
 * Seller self-registration, the half that needs a database.
 *
 * `Shared/inventory/sellerApplication.ts` is the rule set and is pure. This is
 * what cannot be: keeping one open application per account race-safely, and —
 * the part that matters — turning an approved one into a real store with its
 * owner attached, in a way that leaves nothing half-made if it fails.
 *
 * Outside `db.ts` for the reason `orders.ts`, `finance.ts` and `vouchers.ts`
 * are: functions inside it reach its module-local `getDb`, which nothing
 * outside can redirect, so anything living there cannot be tested against a
 * real database.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { users, vendorApplications, vendorMembers, vendors } from "../drizzle/schema.js";
import {
  AGREEMENT_VERSION,
  applicationProblems,
  editableByApplicant,
  readyToApprove,
  type ApplicationState,
  type SellerApplication,
  MAX_COMMISSION_NOTE,
} from "../Shared/inventory/sellerApplication.js";
import { storeSlug } from "../Shared/inventory/storeProfile.js";
import { assertCan, type Actor } from "../Shared/inventory/permissions.js";
import { clampPage, clampPageSize, offsetFor, type Page } from "../Shared/pagination.js";
import { getDb } from "./db.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { DEFAULT_COMMISSION_PERCENT } from "../Shared/inventory/commission.js";
import { documentsPending } from "../Shared/inventory/applicationDocuments.js";
import { documentFactsFor, pendingCounts } from "./applicationDocuments.js";

/** Every refusal is a key the router turns into a message, never a sentence. */
export class ApplicationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

type Row = typeof vendorApplications.$inferSelect;

/**
 * The applicant's own application, or null.
 *
 * Scoped by `ctx.user.id` inside the query rather than filtered in the router,
 * because an id is a serial and "show me application 4" has to be refused by
 * the query — the rule every order read already follows.
 */
export async function myApplication(userId: number): Promise<Row | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(vendorApplications)
    .where(eq(vendorApplications.userId, userId))
    .orderBy(desc(vendorApplications.createdAt), desc(vendorApplications.id))
    .limit(1);
  return row ?? null;
}

/**
 * Save a draft, or correct a rejected one.
 *
 * **Saving is easy**: only what is actively wrong is refused, and everything
 * merely absent is reported by the page. Refusing to save because a trade
 * licence is on a document nobody has scanned is the mistake the store record
 * already avoids.
 *
 * The open-application index is what stops a second one existing, and the
 * conflict is caught rather than pre-checked: two tabs beat a read-then-insert.
 */
export async function saveApplication(userId: number, input: SellerApplication): Promise<Row> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const problems = applicationProblems(input);
  if (problems.length) throw new ApplicationError(problems[0]);

  const existing = await myApplication(userId);
  if (existing && !editableByApplicant(existing.status as ApplicationState)) {
    throw new ApplicationError("application.locked");
  }

  const values = {
    userId,
    storeName: input.storeName.trim(),
    storeNameAr: input.storeNameAr?.trim() || null,
    contactEmail: input.contactEmail?.trim().toLowerCase() || null,
    contactPhone: input.contactPhone?.trim() || null,
    governorate: input.governorate?.trim() || null,
    addressLine: input.addressLine?.trim() || null,
    licenceNumber: input.licenceNumber?.trim() || null,
    licenceExpiresAt: input.licenceExpiresAt ? new Date(input.licenceExpiresAt) : null,
    licenceDocUrl: input.licenceDocUrl?.trim() || null,
    identityDocUrl: input.identityDocUrl?.trim() || null,
    /* Normalised the way the store record stores it, so the two cannot differ
       by a space once the application becomes a vendor. */
    payoutIban: input.payoutIban?.replace(/[\s-]/g, "").toUpperCase() || null,
    underPlatformLicence: input.underPlatformLicence ?? false,
    agreementVersion: input.agreementVersion === AGREEMENT_VERSION ? AGREEMENT_VERSION : null,
    agreedAt: input.agreementVersion === AGREEMENT_VERSION ? new Date() : null,
    proposedCommissionPercent: input.proposedCommissionPercent?.trim() || null,
    /* A reason with no proposal is a reason for nothing, so it is not kept. */
    commissionNote: input.proposedCommissionPercent?.trim()
      ? input.commissionNote?.replace(/\s+/g, " ").trim().slice(0, MAX_COMMISSION_NOTE) || null
      : null,
  };

  if (existing && editableByApplicant(existing.status as ApplicationState)) {
    const [updated] = await db
      .update(vendorApplications)
      /* Correcting a rejection sends it back to draft: the reason it carried
         is about the version that was refused, and leaving it on the row the
         applicant has just fixed reads as a second refusal. */
      .set({ ...values, status: "draft", rejectionReason: null })
      .where(eq(vendorApplications.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(vendorApplications).values(values).returning();
  return created;
}

/**
 * Hand it in.
 *
 * Deliberately a separate act from saving: an application somebody is still
 * filling in should not appear in a reviewer's queue every time they type, and
 * "I am finished" is a thing only the applicant can say.
 */
export async function submitApplication(userId: number): Promise<Row> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const existing = await myApplication(userId);
  if (!existing) throw new ApplicationError("application.none");
  if (!editableByApplicant(existing.status as ApplicationState)) throw new ApplicationError("application.locked");

  const verdict = readyToApprove(toShared(existing));
  /* The same function an administrator's approval runs, applied here so the
     applicant is told what is missing while they are still looking at the
     form rather than days later in a rejection. */
  if (!verdict.ok) throw new ApplicationError(verdict.problems[0] ?? "application.incomplete");

  const [updated] = await db
    .update(vendorApplications)
    .set({ status: "submitted", rejectionReason: null })
    .where(and(eq(vendorApplications.id, existing.id), inArray(vendorApplications.status, ["draft", "rejected"])))
    .returning();
  return updated ?? existing;
}

/* --------------------------------------------------------------- review --- */

export type ApplicationRow = Row & {
  applicantEmail: string;
  applicantName: string | null;
  /** Uploaded documents still waiting on a decision, which approving waits on too. */
  documentsWaiting: number;
};

/** The queue. Admin-only, and the guard is beside the query. */
export async function listApplications(
  actor: Actor,
  request: { status?: ApplicationState; page?: number; pageSize?: number } = {},
): Promise<Page<ApplicationRow>> {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) return { rows: [], total: 0, page: 1, pageSize: clampPageSize(request.pageSize) };

  const scope = request.status ? eq(vendorApplications.status, request.status) : undefined;
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendorApplications)
    .where(scope);
  const total = counted?.n ?? 0;

  const pageSize = clampPageSize(request.pageSize);
  const page = clampPage(request.page ?? 1, total, pageSize);

  const rows = await db
    .select({
      application: vendorApplications,
      applicantEmail: users.email,
      applicantName: users.name,
    })
    .from(vendorApplications)
    .innerJoin(users, eq(users.id, vendorApplications.userId))
    .where(scope)
    /* `createdAt` ties when a fixture writes several in one statement, and
       Postgres orders ties freely, so the page ends on the id — the rule every
       paged query here follows. */
    .orderBy(desc(vendorApplications.createdAt), desc(vendorApplications.id))
    .limit(pageSize)
    .offset(offsetFor(page, pageSize));

  const waiting = await pendingCounts(actor, rows.map(row => row.application.id));
  return {
    rows: rows.map(row => ({
      ...row.application,
      applicantEmail: row.applicantEmail,
      applicantName: row.applicantName,
      documentsWaiting: waiting.get(row.application.id) ?? 0,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Approve one, which is what creates the store.
 *
 * **One approval, not two.** The vendor is written `approved` rather than
 * `pending`: approving the application *is* approving the seller, and a second
 * state to clear afterwards is a step somebody forgets, leaving a store that
 * cannot sell and an applicant who was told they could.
 *
 * The slug is derived and then made unique, because a store called "Harbour
 * Lighting" may be the second one of that name and a collision at this point
 * would refuse an approval for a reason the administrator cannot act on.
 */
export async function approveApplication(
  actor: Actor,
  applicationId: number,
  /**
   * The store's rate (3.3.2), set here by the administrator — the standard
   * one when omitted. The applicant's proposal is shown beside it and never
   * applied by itself: commission is outside a vendor's control entirely.
   */
  commissionPercent?: string | null,
): Promise<{ vendorId: number }> {
  assertCan(actor, "platform.manageUsers");
  const rate = commissionPercent?.trim() || DEFAULT_COMMISSION_PERCENT;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate) || Number.parseFloat(rate) > 100) throw new ApplicationError("application.badCommission");
  const custom = Number.parseFloat(rate) !== Number.parseFloat(DEFAULT_COMMISSION_PERCENT);
  /* Already true of anybody who clears `platform.manageUsers`; asked anyway,
     because this is the act the commission rule is about. */
  if (custom) assertCan(actor, "vendor.setCommission");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const [row] = await db.select().from(vendorApplications).where(eq(vendorApplications.id, applicationId)).limit(1);
  if (!row) throw new ApplicationError("application.none");
  if (row.status !== "submitted") throw new ApplicationError("application.notWaiting");

  const verdict = readyToApprove(toShared(row));
  if (!verdict.ok) throw new ApplicationError("application.incomplete");
  /* A document nobody has looked at is not a document the store was approved on. */
  if (documentsPending(await documentFactsFor(applicationId))) throw new ApplicationError("application.documentsPending");

  /*
   * One transaction, and the application is claimed first — the update whose
   * predicate is "still submitted" — so two presses cannot both open a store.
   * It read the status, then made the store, then marked the application, so
   * a double click or two administrators at once gave the applicant two
   * stores. Anything failing after the claim rolls the whole of it back,
   * which is also what used to need a hand-written delete of the store.
   */
  const vendor = await db.transaction(async tx => {
    const [claimed] = await tx
      .update(vendorApplications)
      .set({ status: "approved", reviewedBy: actor.userId, reviewedAt: new Date(), rejectionReason: null })
      .where(and(eq(vendorApplications.id, applicationId), eq(vendorApplications.status, "submitted")))
      .returning({ id: vendorApplications.id });
    if (!claimed) throw new ApplicationError("application.notWaiting");

    const slug = await freeSlug(tx, storeSlug(row.storeName));
    const [created] = await tx
      .insert(vendors)
      .values({
        slug,
        name: row.storeName,
        nameAr: row.storeNameAr,
        status: "approved",
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        governorate: row.governorate,
        addressLine: row.addressLine,
        licenceNumber: row.licenceNumber,
        licenceExpiresAt: row.licenceExpiresAt,
        payoutIban: row.payoutIban,
        underPlatformLicence: row.underPlatformLicence,
        commissionPercent: rate,
      })
      .returning({ id: vendors.id });
    /* The applicant already has an account — that is the whole point of the
       self-serve path — so this attaches it rather than minting one. Owner,
       because it is their store. */
    await tx.insert(vendorMembers).values({ vendorId: created.id, userId: row.userId, role: "owner" });
    await tx.update(vendorApplications).set({ vendorId: created.id }).where(eq(vendorApplications.id, applicationId));
    return created;
  });

  /* A rate other than the standard one is a commission decision like any
     other, and is recorded as one — with the authorisation chain, and with
     what the applicant had asked for beside what they were given. */
  if (custom) {
    await recordAudit(await auditActor(actor), {
      action: "vendor.setCommission",
      subjectType: "vendor",
      subjectId: vendor.id,
      subjectLabel: row.storeName,
      vendorId: vendor.id,
      before: { commissionPercent: DEFAULT_COMMISSION_PERCENT },
      after: { commissionPercent: rate, proposedCommissionPercent: row.proposedCommissionPercent, atApproval: true },
    });
  }

  return { vendorId: vendor.id };
}

/**
 * Refuse one, with a reason.
 *
 * The reason is not optional in spirit, the way the product review queue's is
 * not: a rejection with no reason sends somebody back to guess, and they can
 * correct and resubmit — which is the only thing that makes rejecting better
 * than ignoring.
 */
export async function rejectApplication(actor: Actor, applicationId: number, reason: string): Promise<void> {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const trimmed = reason.trim();
  if (!trimmed) throw new ApplicationError("application.noReason");

  const updated = await db
    .update(vendorApplications)
    .set({ status: "rejected", rejectionReason: trimmed, reviewedBy: actor.userId, reviewedAt: new Date() })
    .where(and(eq(vendorApplications.id, applicationId), eq(vendorApplications.status, "submitted")))
    .returning({ id: vendorApplications.id });

  if (updated.length === 0) throw new ApplicationError("application.notWaiting");
}

/** How many are waiting, for the overview's "waiting on you" tile. */
export async function countWaitingApplications(actor: Actor): Promise<number> {
  assertCan(actor, "platform.manageUsers");
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendorApplications)
    .where(eq(vendorApplications.status, "submitted"));
  return row?.n ?? 0;
}

/* --------------------------------------------------------------- helpers --- */

/** The row as the pure rules expect it. */
function toShared(row: Row): SellerApplication {
  return {
    storeName: row.storeName,
    storeNameAr: row.storeNameAr,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    governorate: row.governorate,
    addressLine: row.addressLine,
    licenceNumber: row.licenceNumber,
    licenceExpiresAt: row.licenceExpiresAt,
    licenceDocUrl: row.licenceDocUrl,
    identityDocUrl: row.identityDocUrl,
    payoutIban: row.payoutIban,
    underPlatformLicence: row.underPlatformLicence,
    agreementVersion: row.agreementVersion,
    proposedCommissionPercent: row.proposedCommissionPercent,
    commissionNote: row.commissionNote,
  };
}

/** A slug nothing has taken, from one that may be taken. */
async function freeSlug(
  db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">,
  base: string,
): Promise<string> {
  const taken = await db
    .select({ slug: vendors.slug })
    .from(vendors)
    .where(sql`${vendors.slug} like ${base + "%"}`);
  if (!taken.some(row => row.slug === base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.some(row => row.slug === candidate)) return candidate;
  }
}
