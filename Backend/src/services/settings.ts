/**
 * The administrator's numbers, the database half (`platform_settings`). The
 * keys, their defaults and their ranges are `Shared/settings.ts`.
 *
 * **Read per call, never cached in the process**, for the reason the feature
 * switches are: one cache per short-lived instance would leave a new rate on
 * the instance that wrote it and the old one everywhere else. The read is one
 * small table and happens only where money is decided — an order being placed
 * or its cash being collected — never while browsing.
 *
 * **With no database, every setting is its default**, which is what `pnpm dev`
 * with nothing configured has always meant.
 */
import { eq } from "drizzle-orm";
import { platformSettings, users } from "../../database/schema.js";
import { normaliseSetting, resolveSettings, SETTING_KEYS, SETTINGS, type SettingKey } from "../../../Shared/settings.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { recordAudit } from "./audit.js";
import { auditActor } from "./inventory.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Every setting, the stored rows folded over the defaults. */
export async function settingValues(db?: Db | null): Promise<Record<SettingKey, string>> {
  const handle = db ?? (await getDb());
  if (!handle) return resolveSettings([]);
  const rows = await handle.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings);
  return resolveSettings(rows);
}

/** One setting: its stored value if it reads as its shape, otherwise its default. */
export async function settingValue(key: SettingKey, db?: Db | null): Promise<string> {
  const handle = db ?? (await getDb());
  if (!handle) return SETTINGS[key].defaultValue;
  const [row] = await handle.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  return row ? normaliseSetting(key, row.value) ?? SETTINGS[key].defaultValue : SETTINGS[key].defaultValue;
}

/** The settings as an administrator sees them: the value, its range, and who last set it. */
export async function listSettings(actor: Actor) {
  assertCan(actor, "platform.configure");
  const db = await getDb();
  const rows = db
    ? await db
        .select({ key: platformSettings.key, value: platformSettings.value, updatedAt: platformSettings.updatedAt, updatedByEmail: users.email })
        .from(platformSettings)
        .leftJoin(users, eq(users.id, platformSettings.updatedBy))
    : [];
  const values = resolveSettings(rows);
  const byKey = new Map(rows.map(row => [row.key, row]));
  return SETTING_KEYS.map(key => ({
    key,
    value: values[key],
    defaultValue: SETTINGS[key].defaultValue,
    min: SETTINGS[key].min,
    max: SETTINGS[key].max,
    updatedAt: byKey.get(key)?.updatedAt ?? null,
    updatedByEmail: byKey.get(key)?.updatedByEmail ?? null,
  }));
}

/** A value outside a setting's shape or range. */
export class SettingRefused extends Error {
  constructor() {
    super("settings.badValue");
    this.name = "SettingRefused";
  }
}

/**
 * Set one, and record who did and what it was before — a rate is money NetLet
 * pays, and the trail is where "since when, and who decided" is answered.
 */
export async function setSetting(actor: Actor, key: SettingKey, value: string): Promise<string> {
  assertCan(actor, "platform.configure");
  const normalised = normaliseSetting(key, value);
  if (normalised === null) throw new SettingRefused();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const before = await settingValue(key, db);
  const now = new Date();
  await db
    .insert(platformSettings)
    .values({ key, value: normalised, updatedBy: actor.userId, updatedAt: now })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: normalised, updatedBy: actor.userId, updatedAt: now } });
  await recordAudit(await auditActor(actor), {
    action: "platform.setSetting",
    subjectType: "setting",
    subjectLabel: key,
    before: { value: before },
    after: { value: normalised },
  });
  return normalised;
}
