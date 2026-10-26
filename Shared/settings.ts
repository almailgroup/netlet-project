/**
 * Numbers an administrator sets without a deploy — the feature switches'
 * sibling (`platform_settings`, migration 0062).
 *
 * Pure and imported by both sides, for the switchboard's reason: the page
 * offers exactly the range the server accepts. A key nobody has written reads
 * as its default, so a fresh database behaves as the code always did.
 *
 * **Every value is text in the table and a decided shape here.** A setting the
 * server cannot read as its shape falls back to the default rather than
 * failing whatever reads it — a rate somebody mistyped by hand in the
 * dashboard costs a referral its custom figure, never a checkout.
 */

export type SettingSpec = {
  /** What it is when nobody has set it. */
  defaultValue: string;
  /** The lowest and highest an administrator may set, inclusive. */
  min: number;
  max: number;
};

/**
 * The referral programme's two rates (3.1.14, 3.1.15), each a percentage of
 * **NetLet's own commission** on a line — never of the price, so a referral can
 * never cost more than NetLet earned and the seller's net is never touched.
 * Capped at fifty each, so both together cannot exceed what NetLet took.
 */
export const SETTINGS = {
  "referral.productPercent": { defaultValue: "20.00", min: 0, max: 50 },
  "referral.invitePercent": { defaultValue: "10.00", min: 0, max: 50 },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** A percentage with at most two decimals, inside the key's range — or null. */
export function normaliseSetting(key: SettingKey, value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  const spec: SettingSpec = SETTINGS[key];
  if (!Number.isFinite(number) || number < spec.min || number > spec.max) return null;
  return number.toFixed(2);
}

/** The stored rows folded over the defaults, an unreadable row reading as its default. */
export function resolveSettings(rows: readonly { key: string; value: string }[]): Record<SettingKey, string> {
  const out = Object.fromEntries(SETTING_KEYS.map(key => [key, SETTINGS[key].defaultValue])) as Record<SettingKey, string>;
  for (const row of rows) {
    if (!(row.key in SETTINGS)) continue;
    const key = row.key as SettingKey;
    out[key] = normaliseSetting(key, row.value) ?? SETTINGS[key].defaultValue;
  }
  return out;
}
