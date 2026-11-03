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
import { RETURN_WINDOW_DAYS } from "./commerce/returns.js";

export type SettingSpec = {
  /** What it is when nobody has set it. */
  defaultValue: string;
  /** The lowest and highest an administrator may set, inclusive. */
  min: number;
  max: number;
  /** A percentage with up to two decimals, or a whole number of days. */
  unit: "percent" | "days";
};

/**
 * The referral programme's two rates (3.1.14, 3.1.15), each a percentage of
 * **NetLet's own commission** on a line — never of the price, so a referral can
 * never cost more than NetLet earned and the seller's net is never touched.
 * Capped at fifty each, so both together cannot exceed what NetLet took.
 */
export const SETTINGS = {
  "referral.productPercent": { defaultValue: "20.00", min: 0, max: 50, unit: "percent" },
  "referral.invitePercent": { defaultValue: "10.00", min: 0, max: 50, unit: "percent" },
  /**
   * How many days after delivery a return or refund may be asked for, on the
   * owner's word: "the date will be controlled by super admin, like 14 days".
   * Past it, Request a refund leaves the order. At least one day, because a
   * window of none would take away a return the law gives for a faulty item;
   * at most ninety, past which an order's points would be held for a season.
   */
  "returns.windowDays": { defaultValue: String(RETURN_WINDOW_DAYS), min: 1, max: 90, unit: "days" },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/**
 * The value in its key's shape, inside its range — or null. A percentage
 * keeps two decimals; a number of days is whole.
 */
export function normaliseSetting(key: SettingKey, value: string): string | null {
  const trimmed = value.trim();
  const spec: SettingSpec = SETTINGS[key];
  const shape = spec.unit === "days" ? /^\d{1,3}$/ : /^\d{1,3}(\.\d{1,2})?$/;
  if (!shape.test(trimmed)) return null;
  const number = Number(trimmed);
  if (!Number.isFinite(number) || number < spec.min || number > spec.max) return null;
  return spec.unit === "days" ? String(number) : number.toFixed(2);
}

/** The return window in days, from the folded settings. */
export function returnWindowDaysOf(values: Pick<Record<SettingKey, string>, "returns.windowDays">): number {
  const days = Number(values["returns.windowDays"]);
  return Number.isInteger(days) && days >= SETTINGS["returns.windowDays"].min ? days : RETURN_WINDOW_DAYS;
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
