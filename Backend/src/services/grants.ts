/**
 * One capability granted to one account (3.3.9), the database half. Which
 * capabilities may be granted is `GRANTABLE` in
 * `Shared/inventory/permissions.ts` — today, setting commission.
 *
 * Granting is administering NetLet (`platform.manageUsers`), so only an
 * administrator grants, and the grant records which one: that is the "which
 * admin granted that employee this specific permission" the audit trail's
 * chain then names on every commission the employee sets.
 */
import { and, eq } from "drizzle-orm";
import { staffGrants, users } from "../../database/schema.js";
import { assertCan, GRANTABLE, type Actor, type Capability } from "../../../Shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

/** Refused for a reason an administrator can act on. */
export class GrantRefused extends Error {
  constructor(readonly reason: "grants.notGrantable" | "grants.isAdmin" | "admin.noSuchAccount") {
    super(reason);
    this.name = "GrantRefused";
  }
}

/**
 * Grant one capability, or take it back. An administrator already holds every
 * capability, so a grant to one would be a row that means nothing until they
 * are demoted — and then something nobody decided; it is refused instead.
 */
export async function setGrant(actor: Actor, userId: number, capability: Capability, granted: boolean): Promise<void> {
  assertCan(actor, "platform.manageUsers");
  if (!GRANTABLE.includes(capability)) throw new GrantRefused("grants.notGrantable");
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [person] = await db.select({ email: users.email, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!person) throw new GrantRefused("admin.noSuchAccount");
  if (granted && person.role === "admin") throw new GrantRefused("grants.isAdmin");

  if (granted) {
    const inserted = await db.insert(staffGrants).values({ userId, capability, grantedBy: actor.userId }).onConflictDoNothing().returning({ userId: staffGrants.userId });
    if (!inserted.length) return;
  } else {
    const removed = await db.delete(staffGrants).where(and(eq(staffGrants.userId, userId), eq(staffGrants.capability, capability))).returning({ userId: staffGrants.userId });
    if (!removed.length) return;
  }
  await recordAudit(await auditActor(actor), {
    action: granted ? "user.grant" : "user.revokeGrant",
    subjectType: "user",
    subjectId: userId,
    subjectLabel: person.email,
    before: { [capability]: !granted },
    after: { [capability]: granted },
  });
}
