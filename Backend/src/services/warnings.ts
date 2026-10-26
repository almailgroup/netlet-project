/**
 * Warnings NetLet gives a store (3.3.18), the database half. The rules are
 * `Shared/inventory/warnings.ts`.
 *
 * An administrator issues one with a reason the store reads, optionally
 * naming one of its products; every member of the store is told at once
 * (`seller_warning`), and the third warning still standing suspends the store
 * in the same transaction, audited as an automatic `vendor.setStatus` with the
 * warnings that did it. Withdrawing one takes it out of the count and does not
 * reinstate a store — reinstating is its own decision, and it restarts the
 * count (`vendors.warnings_since`, in `setVendorStatus`).
 *
 * Outside `db.ts` for the reason `orders.ts` is: functions there call its
 * module-local `getDb`, which nothing outside can point at a test database.
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { products, users, vendors, vendorWarnings } from "../../database/schema.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import {
  SUSPEND_AT_WARNINGS,
  standingCount,
  suspends,
  warningExpiry,
  warningReasonProblem,
  warningState,
  type WarningState,
} from "../../../Shared/inventory/warnings.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";
import { notifyStore } from "./notifications.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** A refusal somebody can act on, as a message key. */
export class WarningRefused extends Error {
  constructor(readonly reason: "warnings.needsReason" | "warnings.tooLong" | "warnings.notFound" | "warnings.notTheirs" | "warnings.alreadyWithdrawn") {
    super(reason);
    this.name = "WarningRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

export type WarningRow = {
  id: number;
  reason: string;
  productId: number | null;
  productTitle: string | null;
  productTitleAr: string | null;
  createdAt: Date;
  expiresAt: Date;
  withdrawnAt: Date | null;
  state: WarningState;
  /** Who issued it — shown to NetLet's own people only, never to the store. */
  issuedBy: string | null;
};

export type WarningsSummary = { rows: WarningRow[]; standing: number; suspendAt: number; since: Date | null };

async function standingFor(db: Db, vendorId: number, now = new Date()) {
  const [store] = await db.select({ since: vendors.warningsSince }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  const rows = await db
    .select({ createdAt: vendorWarnings.createdAt, expiresAt: vendorWarnings.expiresAt, withdrawnAt: vendorWarnings.withdrawnAt })
    .from(vendorWarnings)
    .where(eq(vendorWarnings.vendorId, vendorId));
  return standingCount(rows, store?.since ?? null, now);
}

/** A store's warnings, newest first: NetLet's people, and the store's own. */
export async function listWarnings(actor: Actor, vendorId?: number): Promise<WarningsSummary> {
  const scope = actor.kind === "vendor" ? actor.vendorId : vendorId;
  if (scope === undefined) return { rows: [], standing: 0, suspendAt: SUSPEND_AT_WARNINGS, since: null };
  assertCan(actor, "product.view", scope);
  const db = await handle();
  const [store] = await db.select({ since: vendors.warningsSince }).from(vendors).where(eq(vendors.id, scope)).limit(1);
  const since = store?.since ?? null;
  const rows = await db
    .select({
      id: vendorWarnings.id,
      reason: vendorWarnings.reason,
      productId: vendorWarnings.productId,
      productTitle: products.title,
      productTitleAr: products.titleAr,
      createdAt: vendorWarnings.createdAt,
      expiresAt: vendorWarnings.expiresAt,
      withdrawnAt: vendorWarnings.withdrawnAt,
      issuedBy: users.email,
    })
    .from(vendorWarnings)
    .leftJoin(products, eq(products.id, vendorWarnings.productId))
    .leftJoin(users, eq(users.id, vendorWarnings.issuedBy))
    .where(eq(vendorWarnings.vendorId, scope))
    .orderBy(desc(vendorWarnings.createdAt), desc(vendorWarnings.id))
    .limit(100);
  const now = new Date();
  const shaped = rows.map(row => ({
    ...row,
    state: warningState(row, since, now),
    issuedBy: actor.kind === "admin" ? row.issuedBy : null,
  }));
  return { rows: shaped, standing: standingCount(rows, since, now), suspendAt: SUSPEND_AT_WARNINGS, since };
}

/**
 * Issues a warning, tells the store, and suspends it if this is the third
 * standing. Returns the count after it and whether it suspended.
 */
export async function issueWarning(actor: Actor, input: { vendorId: number; productId?: number | null; reason: string }) {
  assertCan(actor, "vendor.approve");
  const problem = warningReasonProblem(input.reason);
  if (problem) throw new WarningRefused(problem);
  const reason = input.reason.trim();
  const db = await handle();
  const who = await auditActor(actor);

  const result = await db.transaction(async tx => {
    /* The store's row is locked, so two administrators warning at once count
       each other's warning and suspend once. */
    const [store] = await tx.select().from(vendors).where(eq(vendors.id, input.vendorId)).for("update").limit(1);
    if (!store) throw new WarningRefused("warnings.notFound");
    let product: { id: number; title: string; titleAr: string | null } | null = null;
    if (input.productId) {
      const [row] = await tx
        .select({ id: products.id, title: products.title, titleAr: products.titleAr, vendorId: products.vendorId })
        .from(products)
        .where(eq(products.id, input.productId))
        .limit(1);
      if (!row || row.vendorId !== store.id) throw new WarningRefused("warnings.notTheirs");
      product = row;
    }
    const now = new Date();
    const [warning] = await tx
      .insert(vendorWarnings)
      .values({ vendorId: store.id, productId: product?.id ?? null, reason, issuedBy: actor.userId, expiresAt: warningExpiry(now) })
      .returning();
    const standing = await standingFor(tx as unknown as Db, store.id, now);
    const suspend = suspends(standing) && store.status !== "suspended";
    if (suspend) await tx.update(vendors).set({ status: "suspended" }).where(and(eq(vendors.id, store.id), ne(vendors.status, "suspended")));
    return { warning, store, product, standing, suspend };
  });

  await recordAudit(who, {
    action: "vendor.warn",
    subjectType: "vendor",
    subjectId: result.store.id,
    subjectLabel: result.store.name,
    vendorId: result.store.id,
    after: { warningId: result.warning.id, reason, productId: result.product?.id ?? null, standing: result.standing },
  });
  if (result.suspend) {
    await recordAudit({ id: null, email: null }, {
      action: "vendor.setStatus",
      subjectType: "vendor",
      subjectId: result.store.id,
      subjectLabel: result.store.name,
      vendorId: result.store.id,
      before: { status: result.store.status },
      after: { status: "suspended", automatic: true, reason: "three-warnings", standing: result.standing },
    });
  }

  await notifyStore(result.store.id, {
    kind: result.suspend ? "seller_suspended" : "seller_warning",
    params: {
      reason,
      count: result.standing,
      suspendAt: SUSPEND_AT_WARNINGS,
      product: result.product?.title ?? "",
      productAr: result.product?.titleAr ?? result.product?.title ?? "",
    },
    link: "/admin",
    dedupe: `warning:${result.warning.id}${result.suspend ? ":suspended" : ""}`,
  });

  return { id: result.warning.id, standing: result.standing, suspended: result.suspend };
}

/** Takes a warning out of the count. It does not reinstate a suspended store: that is its own decision. */
export async function withdrawWarning(actor: Actor, warningId: number) {
  assertCan(actor, "vendor.approve");
  const db = await handle();
  const [was] = await db
    .select({ id: vendorWarnings.id, vendorId: vendorWarnings.vendorId, reason: vendorWarnings.reason, name: vendors.name })
    .from(vendorWarnings)
    .innerJoin(vendors, eq(vendors.id, vendorWarnings.vendorId))
    .where(eq(vendorWarnings.id, warningId))
    .limit(1);
  if (!was) throw new WarningRefused("warnings.notFound");
  const [row] = await db
    .update(vendorWarnings)
    .set({ withdrawnAt: new Date(), withdrawnBy: actor.userId })
    .where(and(eq(vendorWarnings.id, warningId), isNull(vendorWarnings.withdrawnAt)))
    .returning({ id: vendorWarnings.id });
  if (!row) throw new WarningRefused("warnings.alreadyWithdrawn");
  const standing = await standingFor(db, was.vendorId);
  await recordAudit(await auditActor(actor), {
    action: "vendor.withdrawWarning",
    subjectType: "vendor",
    subjectId: was.vendorId,
    subjectLabel: was.name,
    vendorId: was.vendorId,
    after: { warningId, reason: was.reason, standing },
  });
  return { standing };
}

/** The standing count alone, for the store's health score. */
export async function standingWarnings(vendorId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return standingFor(db, vendorId);
}
