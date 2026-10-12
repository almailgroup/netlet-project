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
import { eq, isNotNull, sql } from "drizzle-orm";
import { ENV } from "./_core/env.js";
import type { MessageKey } from "../shared/i18n/dictionary.js";
import { featureSwitches, orderItems, users } from "../drizzle/schema.js";
import { FEATURE_KEYS, FEATURES, resolveStates, type FeatureKey, type FeatureStates } from "../shared/features.js";
import { assertCan, type Actor } from "../shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

/** Every feature's state, the stored rows folded over the defaults. */
export async function featureStates(): Promise<FeatureStates> {
  const db = await getDb();
  if (!db) return resolveStates([]);
  const rows = await db.select({ key: featureSwitches.key, enabled: featureSwitches.enabled }).from(featureSwitches);
  return resolveStates(rows);
}

/** Whether one feature is on: its stored row, or its default. */
export async function featureOn(key: FeatureKey): Promise<boolean> {
  const db = await getDb();
  if (!db) return FEATURES[key].defaultOn;
  const [row] = await db.select({ enabled: featureSwitches.enabled }).from(featureSwitches).where(eq(featureSwitches.key, key)).limit(1);
  return row?.enabled ?? FEATURES[key].defaultOn;
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
  const enabled = (key: FeatureKey) => byKey.get(key)?.enabled ?? FEATURES[key].defaultOn;
  const readiness = await readinessOf(enabled);
  /* In the order the shared list gives, so the page does not reshuffle as
     switches are written. */
  return FEATURE_KEYS.map(key => {
    const row = byKey.get(key);
    return {
      key,
      enabled: enabled(key),
      updatedAt: row?.updatedAt ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
      /* Why a feature that is on may still draw nothing, or where it shows. */
      why: readiness[key] ?? null,
    };
  });
}

/**
 * What else a feature needs before a shopper sees it, said to the
 * administrator who switched it on.
 *
 * "On" was answered with nothing on the shop for four of them — the assistant
 * and photo search with no model key, "bought together" with no orders yet,
 * "picked for you" on a page nobody had looked at — and a switch that is on
 * and visibly does nothing reads as broken. `blocked` is something missing;
 * `note` is where the feature appears and what it waits for.
 */
type Readiness = { kind: "blocked" | "note"; reason: MessageKey };

async function readinessOf(enabled: (key: FeatureKey) => boolean): Promise<Partial<Record<FeatureKey, Readiness>>> {
  const keyed = Boolean(ENV.mistralApiKey);
  const modelReady = (): Readiness | null =>
    !keyed ? { kind: "blocked", reason: "features.why.noAiKey" } : !enabled("ai") ? { kind: "blocked", reason: "features.why.aiOff" } : null;
  const out: Partial<Record<FeatureKey, Readiness>> = {};
  if (!keyed) out.ai = { kind: "blocked", reason: "features.why.noAiKey" };
  const assistant = modelReady();
  if (assistant) out.assistant = assistant;
  const photo = modelReady();
  if (photo) out.photoSearch = photo;
  out.recommendations = { kind: "note", reason: "features.why.recommendationsWhere" };
  out.voiceSearch = { kind: "note", reason: "features.why.voiceBrowser" };
  /* "Bought together" is drawn from orders that held two different products. */
  const db = await getDb();
  if (db) {
    const baskets = await db
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(isNotNull(orderItems.productId))
      .groupBy(orderItems.orderId)
      .having(sql`count(distinct ${orderItems.productId}) > 1`)
      .limit(1);
    if (baskets.length === 0) out.boughtTogether = { kind: "blocked", reason: "features.why.noPairs" };
  }
  return out;
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
