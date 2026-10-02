/**
 * The feature switchboard's database half (2.3). The rules are in
 * `shared/features.ts`; this reads and writes the switches.
 *
 * **Read on every guarded call, never cached in the process.** NetLet runs as
 * a pool of short-lived instances, so a cache here would be one per instance:
 * an administrator turning chat off would see it off on the instance that
 * served them and on for a while everywhere else, which is the same mistake
 * `server/rateLimit.ts` exists to avoid. The read is one primary-key-sized
 * table and only happens on an entry path or a model call, never on browsing.
 *
 * **With no database, everything is on**, which is what `pnpm dev` with
 * nothing configured has always meant.
 */
import { eq } from "drizzle-orm";
import { featureSwitches, users } from "../drizzle/schema.js";
import { FEATURE_KEYS, resolveStates, type FeatureKey, type FeatureStates } from "../shared/features.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

/** Every feature's state, the stored rows folded over "on". */
export async function featureStates(): Promise<FeatureStates> {
  const db = await getDb();
  if (!db) return resolveStates([]);
  const rows = await db.select({ key: featureSwitches.key, enabled: featureSwitches.enabled }).from(featureSwitches);
  return resolveStates(rows);
}

/** Whether one feature is on. */
export async function featureOn(key: FeatureKey): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const [row] = await db.select({ enabled: featureSwitches.enabled }).from(featureSwitches).where(eq(featureSwitches.key, key)).limit(1);
  return row?.enabled ?? true;
}

/** The switchboard as an administrator sees it: state, and who last moved it. */
export async function listSwitches(actor: Actor) {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  const rows = db
    ? await db
        .select({ key: featureSwitches.key, enabled: featureSwitches.enabled, updatedAt: featureSwitches.updatedAt, updatedByEmail: users.email })
        .from(featureSwitches)
        .leftJoin(users, eq(users.id, featureSwitches.updatedBy))
    : [];
  const byKey = new Map(rows.map(row => [row.key, row]));
  /* In the order the shared list gives, so the page does not reshuffle as
     switches are written. */
  return FEATURE_KEYS.map(key => {
    const row = byKey.get(key);
    return { key, enabled: row?.enabled ?? true, updatedAt: row?.updatedAt ?? null, updatedByEmail: row?.updatedByEmail ?? null };
  });
}

/**
 * Turn one feature on or off for the whole shop, and record who did.
 *
 * An upsert, so pressing it twice is pressing it once. Writing the same state
 * that is already stored still refreshes who and when, which is accurate:
 * somebody did decide it, just now.
 */
export async function setFeature(actor: Actor, key: FeatureKey, enabled: boolean): Promise<void> {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const before = await featureOn(key);
  await db
    .insert(featureSwitches)
    .values({ key, enabled, updatedBy: actor.userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: featureSwitches.key, set: { enabled, updatedBy: actor.userId, updatedAt: new Date() } });
  await recordAudit(await auditActor(actor), {
    action: "platform.setFeature",
    subjectType: "feature",
    subjectLabel: key,
    before: { enabled: before },
    after: { enabled },
  });
}
